import "../shared/map.css";
import "../shared/nav";
import "../shared/story.css";
import "./indian-river.css";
import gaugeConfig from "../../config/gauges.json";
import { CreekLayer } from "../rain/creeks";
import { InfoCard } from "../shared/card";
import { loadData, showLoadError } from "../shared/data";
import { pointAt, polyline, project, ringsPath, unpackRings, type Polyline, type XY } from "../shared/geo";
import { renderHistory } from "../shared/history";
import { drawJournal, hitSighting, loadJournalOverlay, sightingCard, type JournalOverlay } from "../shared/journal-overlay";
import { decodeLakes, drawLakeLabels, drawLakes } from "../shared/lakes";
import { STALE_MS, fetchLatest, fmtCfs } from "../shared/live";
import { StreakLayer, fadeLayer } from "../shared/streaks";
import { cssVar, fontsReady, isDark, onColorSchemeChange } from "../shared/theme";
import type { GaugeConfig, IndianRiverFile, IrlFlows, IrlKey, LakesFile, Snapshot } from "../shared/types";
import { Viewport, startLoop } from "../shared/viewport";
import { CANAL_KEYS, HAULOVER_TEXT, LAGOON, STREAM_TEXT, TOWNS, VIEWS, WATERS, inletText, lagoonText } from "./content";
import { FlushGrid, NOT_LAGOON } from "./grid";

/** Fresh drops spawned per cfs per second, and seawater drops per inlet per second. */
const K = 0.06;
const SEA_RATE = 5;
const MAX_DROPS = 8000;
/** Haulover Canal's drops stop growing past this many cfs. */
const HAUL_CAP = 800;
/** Readings are drawn on the map only at this zoom (pixels per map unit) or closer. */
const LABEL_SCALE = 1500;
/** Visual speeds, in km per second: down a creek, and through the lagoon near an inlet (it slows with distance). */
const STREAM_KMS = 2.5;
const LAGOON_KMS = 1.4;
/** How fast the lagoon's drift fades with distance from an inlet (km). */
const FLUSH_KM = 10;
/** A wander added to every drop in the lagoon, so they spread instead of marching single file (km/s). */
const WANDER_KMS = 0.35;
/** Fresh water fades into the lagoon over this many seconds. */
const FRESH_LIFE = [7, 14];
/** Seawater gets this far in (km) before the tide turns it back. */
const SEA_REACH = [2, 9];
const KM_PER_DEG_LAT = 110.57;
const MILES_PER_KM = 0.621;

type Mode = "stream" | "lagoon" | "haul";
interface Drop {
  kind: "fresh" | "sea" | "haul";
  mode: Mode;
  /** Stream and Haulover drops: the path and how far along it. */
  path?: Polyline;
  d: number;
  dir: 1 | -1;
  /** Lagoon drops: where they are. */
  lon: number;
  lat: number;
  age: number;
  life: number;
  /** Seawater: km it goes in before turning back, and km it has gone. */
  reach: number;
  gone: number;
  back: boolean;
  off: number;
}

interface Gauge extends GaugeConfig {
  key: IrlKey;
  cfs: number | null;
  xy: XY;
  /** Its path into the lagoon, in map units and in lon/lat. */
  path: Polyline;
  ends: [number, number];
}

const timeFmt = (d: Date) => d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const kmToDeg = (km: number, lat: number): [number, number] => [km / (111.32 * Math.cos((lat * Math.PI) / 180)), km / KM_PER_DEG_LAT];

async function main() {
  const [data, snapshot] = await Promise.all([loadData<IndianRiverFile>("indian-river.json"), loadData<Snapshot>("snapshot.json"), fontsReady()]);
  const { coordOrigin, coordScale } = data.meta;
  const water = decodeLakes({ meta: data.meta, bodies: data.water } as LakesFile);
  const lagoonPath = ringsPath(unpackRings(data.lagoon, coordOrigin, coordScale));
  const grid = new FlushGrid(data.grid);
  const inlets = data.inlets.map((i) => ({ ...i, xy: project(i.lon, i.lat) }));

  // ---------- gauges and their paths ----------
  const unpackLine = (flat: number[]): [number, number][] => {
    const out: [number, number][] = [];
    for (let i = 0; i < flat.length; i += 2) out.push([flat[i] / coordScale + coordOrigin[0], flat[i + 1] / coordScale + coordOrigin[1]]);
    return out;
  };
  const gauges: Gauge[] = (gaugeConfig as GaugeConfig[])
    .filter((g): g is GaugeConfig & { key: IrlKey } => g.page === "indian-river")
    .map((g) => {
      const ll = unpackLine(data.streams[g.key]);
      return { ...g, cfs: null, xy: project(g.lon, g.lat), path: polyline(ll.map(([x, y]) => project(x, y))), ends: ll[ll.length - 1] };
    });
  const current = Object.fromEntries(gauges.map((g) => [g.key, snapshot.cfs[g.key] ?? null])) as IrlFlows;
  const liveMeta = new Map<string, { time: Date; stale: boolean }>();
  let liveTime: Date | null = null;
  const setFlows = (f: IrlFlows) => {
    for (const g of gauges) g.cfs = f[g.key];
  };

  // ---------- colors and the flushing image ----------
  let C: Record<string, string> = {};
  let glow = true;
  const heat = document.createElement("canvas");
  heat.width = grid.nx;
  heat.height = grid.ny;
  /** Opacity of the near-an-inlet color at a distance: strong at the inlets, faint far away. */
  const heatAlpha = (km: number) => 0.1 + 0.75 * (1 - Math.min(1, km / grid.farthest)) ** 1.7;
  function paintHeat() {
    const ctx = heat.getContext("2d")!;
    const img = ctx.createImageData(grid.nx, grid.ny);
    const hex = C.atl.replace("#", "");
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
    for (let row = 0; row < grid.ny; row++) {
      for (let col = 0; col < grid.nx; col++) {
        const km = grid.cell(col, row);
        if (km === NOT_LAGOON) continue;
        // Image rows run north to south; the grid's row 0 is south.
        const o = ((grid.ny - 1 - row) * grid.nx + col) * 4;
        img.data.set([r, g, b, Math.round(heatAlpha(km) * 255)], o);
      }
    }
    ctx.putImageData(img, 0, 0);
  }
  const readColors = () => {
    C = Object.fromEntries(["bg", "ink", "muted", "tannin", "atl", "river", "sea", "lake", "shore", "marsh", "stream"].map((n) => [n, cssVar(`--${n}`)]));
    glow = isDark();
    paintHeat();
  };
  const [hx0, hyTop] = project(grid.lon0, grid.lat0 + grid.ny * grid.res);
  const [hx1, hyBottom] = project(grid.lon0 + grid.nx * grid.res, grid.lat0);

  // ---------- map ----------
  let histMode = false;
  const card = new InfoCard();
  const view = new Viewport({
    minScale: 120,
    maxScale: 60000,
    padding: (w) => (w < 600 ? { x: 14, top: histMode ? 14 : 70, bottom: 16 } : { x: 60, top: 50, bottom: 40 }),
    drawBase,
    onTap: tap,
  });
  const { X, Y } = view;
  const creeks = new CreekLayer(() => view.redraw());
  let journal: JournalOverlay | null = null;
  let showJournal = true;

  function drawBase() {
    const c = view.bctx;
    const { W, H } = view;
    const { s, tx, ty } = view.cam;
    c.setTransform(view.DPR, 0, 0, view.DPR, 0, 0);
    c.fillStyle = C.bg;
    c.fillRect(0, 0, W, H);
    drawLakes(c, water, X, Y, view.cam, { sea: C.sea, lake: C.lake, shore: C.shore, marsh: C.marsh, label: C.muted });
    // The lagoon, colored by how far its water is from an inlet, and the creeks around it.
    c.save();
    c.setTransform(view.DPR * s, 0, 0, view.DPR * s, view.DPR * tx, view.DPR * ty);
    c.save();
    c.clip(lagoonPath, "evenodd");
    c.imageSmoothingEnabled = true;
    c.drawImage(heat, hx0, hyTop, hx1 - hx0, hyBottom - hyTop);
    c.restore();
    creeks.update([-tx / s, -ty / s, (W - tx) / s, (H - ty) / s], s);
    c.strokeStyle = C.stream;
    c.globalAlpha = 0.8;
    creeks.draw(c, s);
    c.restore();

    c.lineCap = "round";
    c.lineJoin = "round";
    c.strokeStyle = C.river;
    c.lineWidth = 2;
    for (const g of gauges) {
      c.beginPath();
      g.path.pts.forEach((q, i) => (i ? c.lineTo(X(q[0]), Y(q[1])) : c.moveTo(X(q[0]), Y(q[1]))));
      c.stroke();
    }

    // Towns sit on the mainland shore, so they're named to the west, clear of the inlets'
    // names out on the sea side. Lakes are named only once zoomed in: the lagoon is the story.
    c.font = "500 12px 'Barlow Semi Condensed',sans-serif";
    c.fillStyle = C.muted;
    for (const [n, lon, lat, east] of TOWNS) {
      const p = project(lon, lat);
      c.textAlign = east ? "left" : "right";
      if (Y(p[1]) > 60) c.fillText(n, X(p[0]) + (east ? 5 : -5), Y(p[1]) + 4);
    }
    c.textAlign = "left";
    if (view.scale > 2500) drawLakeLabels(c, water, X, Y, view.scale, C.muted);
    c.font = "italic 400 14px 'Spectral',serif";
    for (const [n, lon, lat] of WATERS) {
      const p = project(lon, lat);
      c.fillStyle = C.atl;
      c.fillText(n, X(p[0]), Y(p[1]));
    }
    if (journal && showJournal) drawJournal(c, journal, X, Y, [], C.ink, glow);

    // Inlets: a ring on the barrier island's gap, named out on the sea side.
    c.font = "600 12px 'Barlow Semi Condensed',sans-serif";
    for (const i of inlets) {
      const x = X(i.xy[0]);
      const y = Y(i.xy[1]);
      c.strokeStyle = C.atl;
      c.lineWidth = 2;
      c.beginPath();
      c.arc(x, y, 6, 0, Math.PI * 2);
      c.stroke();
      c.fillStyle = C.ink;
      c.fillText(i.name, x + 10, y + 4);
    }
    const readable = view.scale >= LABEL_SCALE;
    for (const g of gauges) {
      const [x, y] = [X(g.xy[0]), Y(g.xy[1])];
      c.fillStyle = C.bg;
      c.strokeStyle = C.ink;
      c.lineWidth = 1.4;
      c.beginPath();
      c.rect(x - 4, y - 4, 8, 8);
      c.fill();
      c.stroke();
      if (!readable || g.cfs == null) continue;
      c.fillStyle = liveMeta.get(g.key)?.stale ? C.muted : C.ink;
      c.textAlign = "right";
      c.fillText(`${fmtCfs(g.cfs)} cfs`, x - 8, y + 4);
      c.textAlign = "left";
    }
  }

  // ---------- drops ----------
  const drops: Drop[] = [];
  const acc: Record<string, number> = {};
  const blank = (): Omit<Drop, "kind" | "mode"> => ({ d: 0, dir: 1, lon: 0, lat: 0, age: 0, life: Infinity, reach: 0, gone: 0, back: false, off: Math.random() - 0.5 });

  /** Move a drop through the lagoon by `km` along a unit step; it stays put where that leaves the lagoon. */
  function nudge(p: Drop, step: [number, number] | null, km: number) {
    const [wx, wy] = kmToDeg(WANDER_KMS * km, p.lat);
    const a = Math.random() * Math.PI * 2;
    let lon = p.lon + Math.cos(a) * wx;
    let lat = p.lat + Math.sin(a) * wy;
    if (step) {
      const [sx, sy] = kmToDeg(km, p.lat);
      lon += step[0] * sx;
      lat += step[1] * sy;
    }
    if (grid.at(lon, lat) !== NOT_LAGOON) {
      p.lon = lon;
      p.lat = lat;
    }
  }

  function step(dt: number) {
    const emit = (key: string, perSecond: number, f: () => void) => {
      acc[key] = (acc[key] ?? Math.random()) + perSecond * dt;
      while (acc[key] >= 1) {
        acc[key] -= 1;
        if (drops.length < MAX_DROPS) f();
      }
    };
    for (const g of gauges) {
      if (g.cfs == null || g.cfs === 0) continue;
      if (g.key === "HAUL") {
        const dir: 1 | -1 = g.cfs > 0 ? 1 : -1;
        // Wind can drive thousands of cfs through the canal; past HAUL_CAP the drops just stay dense.
        emit(g.key, Math.min(Math.abs(g.cfs), HAUL_CAP) * K, () => drops.push({ ...blank(), kind: "haul", mode: "haul", path: g.path, d: dir > 0 ? 0 : g.path.len, dir }));
      } else if (g.cfs > 0) {
        emit(g.key, g.cfs * K, () => drops.push({ ...blank(), kind: "fresh", mode: "stream", path: g.path, life: FRESH_LIFE[0] + Math.random() * (FRESH_LIFE[1] - FRESH_LIFE[0]) }));
      }
    }
    for (const i of inlets) {
      emit(i.name, SEA_RATE, () => drops.push({ ...blank(), kind: "sea", mode: "lagoon", lon: i.lon, lat: i.lat, reach: SEA_REACH[0] + Math.random() * (SEA_REACH[1] - SEA_REACH[0]) }));
    }
    const streamSpeed = STREAM_KMS / 111;
    for (let n = drops.length - 1; n >= 0; n--) {
      const p = drops[n];
      p.age += dt;
      if (p.mode === "haul") {
        p.d += p.dir * streamSpeed * dt;
        if (p.d < 0 || p.d > p.path!.len) drops.splice(n, 1);
        continue;
      }
      if (p.mode === "stream") {
        p.d += streamSpeed * dt;
        if (p.d >= p.path!.len) {
          const g = gauges.find((q) => q.path === p.path)!;
          p.mode = "lagoon";
          [p.lon, p.lat] = g.ends;
          p.age = 0;
        }
        continue;
      }
      const here = grid.at(p.lon, p.lat);
      const km = here === NOT_LAGOON ? 0 : here;
      // The lagoon moves water fastest near an inlet, and hardly at all far from one.
      const speed = LAGOON_KMS * Math.exp(-km / FLUSH_KM) * dt;
      if (p.kind === "sea") {
        if (!p.back) {
          nudge(p, grid.uphill(p.lon, p.lat, Math.random()), speed + 0.02);
          p.gone += speed + 0.02;
          if (p.gone >= p.reach) p.back = true;
        } else {
          nudge(p, grid.downhill(p.lon, p.lat), speed + 0.05);
          if (km === 0 || p.age > 30) drops.splice(n, 1);
        }
        continue;
      }
      nudge(p, grid.downhill(p.lon, p.lat), speed);
      if (p.age > p.life || km === 0) drops.splice(n, 1);
    }
  }

  const streaks = new StreakLayer();
  const GROUP = { fresh: 0, sea: 1, haul: 2 } as const;
  function draw() {
    const c = view.fctx;
    const { W, H } = view;
    const sc = view.scale;
    c.setTransform(view.DPR, 0, 0, view.DPR, 0, 0);
    fadeLayer(c, W, H, Math.min(0.55, Math.max(0.2, 0.2 * Math.sqrt(sc / 1000))));
    const z = Math.min(2.4, Math.max(1, sc / 1500));
    streaks.style(GROUP.fresh, C.tannin, glow ? 0.45 : 0.85, z);
    streaks.style(GROUP.sea, C.atl, glow ? 0.35 : 0.7, z);
    streaks.style(GROUP.haul, C.ink, glow ? 0.25 : 0.5, z);
    streaks.begin();
    for (const p of drops) {
      let x: number;
      let y: number;
      let tx: number;
      let ty: number;
      if (p.mode === "lagoon") {
        const xy = project(p.lon, p.lat);
        x = X(xy[0]) + p.off * 2;
        y = Y(xy[1]) + p.off * 2;
        tx = x - 0.8;
        ty = y - 0.8;
      } else {
        const head = pointAt(p.path!, p.d);
        const tail = pointAt(p.path!, p.d - (p.dir * Math.min(6, Math.max(1.2, (STREAM_KMS / 111) * sc * 0.12))) / sc);
        [x, y, tx, ty] = [X(head[0]), Y(head[1]), X(tail[0]), Y(tail[1])];
      }
      if (x < -10 || y < -10 || x > W + 10 || y > H + 10) continue;
      streaks.add(GROUP[p.kind], tx, ty, x, y);
    }
    streaks.flush(c, glow);
  }

  function refill(seconds: number, dt: number) {
    drops.length = 0;
    for (let t = 0; t < seconds; t += dt) step(dt);
    view.clearFx();
  }

  // ---------- cards ----------
  const probe = document.createElement("canvas").getContext("2d")!;
  function nearestInlet(lon: number, lat: number) {
    const [ilon, ilat] = grid.toInlet(lon, lat) ?? [lon, lat];
    return inlets.reduce((a, b) => (Math.hypot(b.lon - ilon, b.lat - ilat) < Math.hypot(a.lon - ilon, a.lat - ilat) ? b : a));
  }
  function tap(x: number, y: number) {
    const seen = journal && showJournal ? hitSighting(journal, X, Y, x, y) : null;
    if (seen) return card.show(sightingCard(seen));
    let best: (() => void) | null = null;
    let bd = 20 * 20;
    const test = (xy: XY, f: () => void) => {
      const d = (X(xy[0]) - x) ** 2 + (Y(xy[1]) - y) ** 2;
      if (d < bd) {
        bd = d;
        best = f;
      }
    };
    for (const g of gauges) test(g.xy, () => showGauge(g));
    for (const i of inlets) test(i.xy, () => card.show({ title: i.name, kind: i.cut ? `Inlet, dug ${i.cut}` : "Inlet", body: inletText(i.cut) }));
    if (best) return (best as () => void)();
    const m: XY = [(x - view.cam.tx) / view.cam.s, (y - view.cam.ty) / view.cam.s];
    if (probe.isPointInPath(lagoonPath, m[0], m[1], "evenodd")) {
      // Map units back to lon/lat.
      const lon = m[0] / Math.cos((29.8 * Math.PI) / 180) - 82.6;
      const lat = 29.8 - m[1];
      const km = grid.at(lon, lat);
      const inlet = nearestInlet(lon, lat);
      return card.show({ title: "Indian River Lagoon", kind: "Lagoon", body: lagoonText(km === NOT_LAGOON ? 0 : km * MILES_PER_KM, inlet.name) });
    }
    card.hide();
  }

  function showGauge(g: Gauge) {
    const title = g.name ?? g.short;
    const kind = `USGS gauge ${g.id}`;
    const meta = liveMeta.get(g.key);
    const when = meta ? `, ${timeFmt(meta.time)}` : "";
    let body: string;
    if (g.cfs == null) body = "No recent reading at this gauge.";
    else if (g.key === "HAUL") {
      body = g.cfs === 0
        ? `Still right now${when}.`
        : `<b>${fmtCfs(Math.abs(g.cfs))} cfs</b>${when}, from ${g.cfs > 0 ? "the Indian River into Mosquito Lagoon" : "Mosquito Lagoon into the Indian River"}.`;
      body += ` ${HAULOVER_TEXT}`;
    } else {
      body = `<b>${fmtCfs(g.cfs)} cfs</b> into the lagoon${when}. ${STREAM_TEXT[g.key as Exclude<IrlKey, "HAUL">]}`;
    }
    if (meta?.stale) body += " This gauge hasn't reported recently, so treat it as old.";
    card.show({ title, kind, body });
  }

  // ---------- gauge strip + copy ----------
  function renderProfile() {
    const el = document.getElementById("profile")!;
    el.replaceChildren();
    for (const g of gauges) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `gauge${liveMeta.get(g.key)?.stale ? " stale" : ""}`;
      const v = document.createElement("div");
      v.className = "v";
      // Haulover runs either way: its size, and which way in words.
      v.textContent = fmtCfs(g.key === "HAUL" && g.cfs != null ? Math.abs(g.cfs) : g.cfs);
      const u = document.createElement("small");
      u.textContent = "cfs";
      v.appendChild(u);
      const n = document.createElement("div");
      n.className = "n";
      n.textContent = g.key === "HAUL" && g.cfs ? `Haulover, into ${g.cfs > 0 ? "Mosquito" : "Indian R."}` : g.short;
      b.append(v, n);
      b.addEventListener("click", () => {
        view.flyTo(g.xy, 3000);
        showGauge(g);
      });
      el.appendChild(b);
    }
  }

  const snapLabel = new Date(snapshot.time).toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  function renderCopy(state: "checking" | "live" | "snapshot") {
    const into = gauges.filter((g) => g.key !== "HAUL" && g.cfs != null && g.cfs > 0);
    const total = into.reduce((a, g) => a + g.cfs!, 0);
    const canals = into.filter((g) => CANAL_KEYS.includes(g.key)).reduce((a, g) => a + g.cfs!, 0);
    document.getElementById("lede")!.innerHTML =
      `The lagoon runs ${LAGOON.length} miles behind the barrier islands, about ${LAGOON.depthFt} feet deep, and trades water with the Atlantic through just five inlets. ` +
      `Near an inlet the tide flushes it. Far from one the water sits: half of the northern lagoon's is still there after about ${LAGOON.northDays} days, and at its far north end after ${LAGOON.farNorthDays}. ` +
      (total > 0 ? `Right now the gauged creeks and canals are pouring in <b>${fmtCfs(total)} cfs</b>, <b>${Math.round((canals / total) * 100)}%</b> of it from drainage canals. ` : "") +
      "Tap anything on the map.";
    const tail = "Flow is in cubic feet per second (cfs).";
    document.getElementById("status")!.textContent =
      state === "live" ? `Live USGS readings, updated ${timeFmt(liveTime!)}. ${tail} Lagoon, creeks, and distances: USGS NHD. Coastline: US Census Bureau.`
      : state === "checking" ? `USGS readings from ${snapLabel}. Checking for live readings… ${tail}`
      : `USGS readings from ${snapLabel}. Live readings didn't load, so this is a saved snapshot. ${tail}`;
  }

  // ---------- freshwater since the 1990s ----------
  const hist = data.history;
  function renderHist() {
    const mean = (vs: (number | null)[]) => {
      const ok = vs.filter((v): v is number => v != null);
      return ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : null;
    };
    const firstOf = (vs: (number | null)[]) => hist.years[vs.findIndex((v) => v != null)];
    const canals = mean(hist.canals);
    const creeks = mean(hist.creeks);
    document.getElementById("histRead")!.innerHTML =
      `The four gauged drainage canals have poured in <b>${fmtCfs(canals)} cfs</b> a year on average since ${firstOf(hist.canals)}; the five gauged creeks and rivers, <b>${fmtCfs(creeks)} cfs</b> since ${firstOf(hist.creeks)}. ` +
      `Drainage more than doubled the lagoon's watershed from 1913 to 2013, from ${(LAGOON.shedBefore / 1000).toFixed(0)},000 acres to ${(LAGOON.shedAfter / 1e6).toFixed(1)} million, and what runs off it carries fertilizer and silt.`;
    renderHistory(document.getElementById("histChart")!, hist.years, [
      { name: "Drainage canals", color: "--chart-tannin", values: hist.canals },
      { name: "Creeks and rivers", color: "--chart-estuary", values: hist.creeks },
    ]);
  }
  const bHist = document.getElementById("bHist")!;
  bHist.addEventListener("click", () => {
    histMode = !histMode;
    bHist.setAttribute("aria-pressed", String(histMode));
    document.getElementById("hist")!.classList.toggle("on", histMode);
    document.body.classList.toggle("hist", histMode);
    card.hide();
    requestAnimationFrame(() => {
      view.resize();
      view.fit(VIEWS.all);
      if (histMode) renderHist();
    });
  });

  // ---------- live readings ----------
  async function tryLive() {
    const signed = new Set(gauges.filter((g) => g.signed).map((g) => g.id));
    const flows = await fetchLatest(gauges.map((g) => g.id), signed);
    let latest: Date | null = null;
    for (const g of gauges) {
      const r = flows.get(g.id);
      if (!r) continue;
      current[g.key] = r.cfs;
      liveMeta.set(g.key, { time: r.time, stale: Date.now() - r.time.getTime() > STALE_MS });
      if (!latest || r.time > latest) latest = r.time;
    }
    if (!latest) throw new Error("USGS returned no readings");
    liveTime = latest;
    setFlows(current);
    renderProfile();
    renderCopy("live");
    drawBase();
  }

  // ---------- boot ----------
  let paused = false;
  const bp = document.getElementById("bPause")!;
  const setPaused = (p: boolean) => {
    paused = p;
    bp.textContent = p ? "Play" : "Pause";
    bp.setAttribute("aria-pressed", String(p));
  };
  bp.addEventListener("click", () => setPaused(!paused));
  document.getElementById("bAll")!.addEventListener("click", () => view.fit(VIEWS.all, true));
  document.getElementById("bNorth")!.addEventListener("click", () => view.fit(VIEWS.north, true));
  document.getElementById("bMiddle")!.addEventListener("click", () => view.fit(VIEWS.middle, true));
  document.getElementById("bSouth")!.addEventListener("click", () => view.fit(VIEWS.south, true));

  readColors();
  setFlows(current);
  renderProfile();
  renderCopy("checking");
  view.resize();
  view.fit(VIEWS.all);
  refill(20, 0.1);
  if (view.reduceMotion) {
    draw();
    setPaused(true);
  }
  startLoop((dt, t) => {
    view.tick(t);
    if (!paused) {
      step(dt);
      draw();
    }
  });
  addEventListener("resize", () => {
    view.resize();
    view.fit(VIEWS.all);
    if (histMode) renderHist();
  });
  onColorSchemeChange(() => {
    readColors();
    view.redraw();
  });
  void creeks.load().catch((err) => console.warn("Creeks unavailable", err));
  void loadJournalOverlay().then((o) => {
    if (!o) return;
    journal = o;
    const chip = document.createElement("button");
    chip.type = "button";
    chip.textContent = "Journal marks";
    chip.setAttribute("aria-pressed", "true");
    chip.addEventListener("click", () => {
      showJournal = !showJournal;
      chip.setAttribute("aria-pressed", String(showJournal));
      drawBase();
    });
    bp.after(chip);
    drawBase();
  });
  tryLive().catch((err) => {
    console.warn("Live USGS readings unavailable; using snapshot.", err);
    renderCopy("snapshot");
  });
}

main().catch(showLoadError);
