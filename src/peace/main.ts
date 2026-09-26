import "../shared/map.css";
import "../shared/nav";
import "../shared/story.css";
import "./peace.css";
import gaugeConfig from "../../config/gauges.json";
import { CreekLayer } from "../rain/creeks";
import { InfoCard } from "../shared/card";
import { loadData, showLoadError } from "../shared/data";
import { nearestDistance, pointAt, polyline, project, ringsPath, unpackRings, type Polyline, type XY } from "../shared/geo";
import { renderHistory } from "../shared/history";
import { drawJournal, hitSighting, journalCardHtml, loadJournalOverlay, sightingCard, type JournalOverlay } from "../shared/journal-overlay";
import { decodeLakes, drawLakeLabels, drawLakes } from "../shared/lakes";
import { STALE_MS, fetchLatest, fmtCfs } from "../shared/live";
import { StreakLayer, fadeLayer } from "../shared/streaks";
import { cssVar, fontsReady, isDark, onColorSchemeChange } from "../shared/theme";
import { PEACE_KEYS, PEACE_RIVERS, type GaugeConfig, type LakesFile, type PeaceFile, type PeaceFlows, type PeaceKey, type PeaceRiver, type Snapshot } from "../shared/types";
import { Viewport, startLoop } from "../shared/viewport";
import { AQUIFER_TEXT, KISSENGEN, KISSENGEN_TEXT, MINE_TEXT, RIVER_TEXT, SINK_TEXT, TOWNS, VIEWS } from "./content";

/** Drops spawned per cfs per second. */
const K = 0.03;
const MAX_DROPS = 8000;
/** Visual speed down the rivers (km a second). */
const KMS = 2.2;
const LABEL_SCALE = 1500;
/** The drawdown shade is strongest at this many feet. It glows around the river and its
 * creeks, fading with distance from them (map units, ~25 km), so the grid never shows as a
 * box, and fades out over EDGE_CELLS at the grid's edges besides. */
const FULL_FT = 35;
const GLOW_UNITS = 0.22;
const EDGE_CELLS = 12;

interface Gauge extends GaugeConfig {
  key: PeaceKey;
  cfs: number | null;
  xy: XY;
}

interface Drop {
  on: PeaceRiver;
  d: number;
  /** Where it sinks into the riverbed, if it does. */
  sink: number | null;
  prev: XY | null;
}

interface Inflow {
  on: PeaceRiver;
  from: number;
  to: number;
  rate: () => number;
  acc: number;
}

const timeFmt = (d: Date) => d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

async function main() {
  const [data, snapshot] = await Promise.all([loadData<PeaceFile>("peace.json"), loadData<Snapshot>("snapshot.json"), fontsReady()]);
  const { coordOrigin, coordScale } = data.meta;
  const unpackLine = (flat: number[]): XY[] => unpackRings([flat], coordOrigin, coordScale)[0];
  const water = decodeLakes({ meta: data.meta, bodies: data.water } as LakesFile);
  const lines = Object.fromEntries(PEACE_RIVERS.map((n) => [n, polyline(unpackLine(data.rivers[n]))])) as Record<PeaceRiver, Polyline>;
  const toPath = (pts: XY[][]) => {
    const p = new Path2D();
    for (const l of pts) l.forEach((q, i) => (i ? p.lineTo(q[0], q[1]) : p.moveTo(q[0], q[1])));
    return p;
  };
  const riverPaths = Object.fromEntries(PEACE_RIVERS.map((n) => [n, toPath([lines[n].pts])])) as Record<PeaceRiver, Path2D>;
  const minePath = ringsPath(unpackRings(data.mines, coordOrigin, coordScale));
  const kissengen = project(...data.kissengen);
  const sinks = data.sinks.map(([name, lon, lat]) => ({ name, xy: project(lon, lat) }));
  const PR: PeaceRiver = "Peace River";
  const along = (l: Polyline, xy: XY) => {
    let best = 0;
    let bd = Infinity;
    l.pts.forEach((q, i) => {
      const d = (q[0] - xy[0]) ** 2 + (q[1] - xy[1]) ** 2;
      if (d < bd) {
        bd = d;
        best = l.cum[i];
      }
    });
    return best;
  };

  // ---------- the aquifer's fall ----------
  const aq = data.aquifer;
  const bytes = (b64: string) => Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
  const fallNow = bytes(aq.now);
  const fallDry = bytes(aq.dry);
  const cellAt = (lon: number, lat: number) => {
    const col = Math.floor((lon - aq.lon0) / aq.res + 0.5);
    const row = Math.floor((lat - aq.lat0) / aq.res + 0.5);
    return col < 0 || row < 0 || col >= aq.nx || row >= aq.ny ? -1 : row * aq.nx + col;
  };
  const shade = document.createElement("canvas");
  shade.width = aq.nx;
  shade.height = aq.ny;
  // How much each cell glows: near the river and its creeks, measured on thinned copies of
  // them, once, since there are tens of thousands of cells.
  const thin = PEACE_RIVERS.map((n) => polyline(lines[n].pts.filter((_, i, a) => i % 4 === 0 || i === a.length - 1)));
  const glowAt = new Float32Array(aq.nx * aq.ny);
  for (let row = 0; row < aq.ny; row++) {
    for (let col = 0; col < aq.nx; col++) {
      const [x, y] = project(aq.lon0 + col * aq.res, aq.lat0 + row * aq.res);
      const d = Math.min(...thin.map((l) => nearestDistance(l, x, y)));
      const edge = Math.min(1, Math.min(col, row, aq.nx - 1 - col, aq.ny - 1 - row) / EDGE_CELLS);
      glowAt[row * aq.nx + col] = Math.exp(-((d / GLOW_UNITS) ** 2)) * edge;
    }
  }
  const [sx0, syTop] = project(aq.lon0 - aq.res / 2, aq.lat0 + (aq.ny - 0.5) * aq.res);
  const [sx1, syBottom] = project(aq.lon0 + (aq.nx - 0.5) * aq.res, aq.lat0 - aq.res / 2);

  // ---------- gauges and where water comes and goes ----------
  const gauges: Gauge[] = (gaugeConfig as GaugeConfig[])
    .filter((g): g is GaugeConfig & { key: PeaceKey } => g.page === "peace")
    .map((g) => ({ ...g, cfs: null, xy: project(g.lon, g.lat) }));
  const G = (k: PeaceKey) => gauges.find((g) => g.key === k)!;
  const q = (k: PeaceKey) => G(k).cfs ?? 0;
  const at = (on: PeaceRiver, k: PeaceKey) => along(lines[on], G(k).xy);
  const pos = (v: number) => Math.max(0, v);
  const dBAR = at(PR, "BAR");
  const dFTM = at(PR, "FTM");
  const dZOL = at(PR, "ZOL");
  const dARC = at(PR, "ARC");
  /** The sinks below the Bartow gauge, by distance down the river: where its lost water goes. */
  const sinkAt = sinks.map((s) => along(lines[PR], s.xy)).filter((d) => d > dBAR).sort((a, b) => a - b);
  const inflows: Inflow[] = [
    { on: PR, from: dBAR, to: dBAR, rate: () => q("BAR"), acc: Math.random() },
    // Below the sinks the river gains again, from its tributaries and the ground.
    { on: PR, from: dFTM, to: dZOL, rate: () => pos(q("ZOL") - q("FTM")), acc: Math.random() },
    { on: PR, from: dZOL, to: dARC, rate: () => pos(q("ARC") - q("ZOL") - q("CHR")), acc: Math.random() },
  ];
  for (const [name, key] of Object.entries(data.tributaries) as [PeaceRiver, PeaceKey | null][]) {
    if (!key) continue;
    const d0 = at(name, key);
    inflows.push({ on: name, from: d0, to: d0, rate: () => q(key), acc: Math.random() });
  }
  const joins = Object.fromEntries(PEACE_RIVERS.filter((n) => n !== PR).map((n) => [n, along(lines[PR], lines[n].pts[lines[n].pts.length - 1])])) as Record<PeaceRiver, number>;
  /** The share of Bartow's water the sinks take before Fort Meade. */
  const lostShare = () => {
    const bar = q("BAR");
    return bar > 0 ? Math.min(0.98, pos(bar - q("FTM")) / bar) : 0;
  };

  const current = Object.fromEntries(PEACE_KEYS.map((k) => [k, snapshot.cfs[k] ?? null])) as PeaceFlows;
  const liveMeta = new Map<string, { time: Date; stale: boolean }>();
  let liveTime: Date | null = null;
  const setFlows = (f: PeaceFlows) => {
    for (const g of gauges) g.cfs = f[g.key];
  };

  // ---------- map ----------
  let C: Record<string, string> = {};
  let glow = true;
  const readColors = () => {
    C = Object.fromEntries(["bg", "ink", "muted", "tannin", "spring", "under", "sea", "lake", "shore", "marsh", "stream", "line"].map((n) => [n, cssVar(`--${n}`)]));
    glow = isDark();
    const ctx = shade.getContext("2d")!;
    const img = ctx.createImageData(aq.nx, aq.ny);
    const hex = C.under.replace("#", "");
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
    for (let row = 0; row < aq.ny; row++) {
      for (let col = 0; col < aq.nx; col++) {
        const i = row * aq.nx + col;
        const o = ((aq.ny - 1 - row) * aq.nx + col) * 4;
        img.data.set([r, g, b, Math.round(Math.min(1, fallNow[i] / FULL_FT) * glowAt[i] * (glow ? 120 : 130))], o);
      }
    }
    ctx.putImageData(img, 0, 0);
  };
  let histMode = false;
  const card = new InfoCard();
  const view = new Viewport({
    minScale: 150,
    maxScale: 60000,
    padding: (w) => (w < 600 ? { x: 14, top: histMode ? 14 : 70, bottom: 16 } : { x: 60, top: 50, bottom: 40 }),
    drawBase,
    onTap: tap,
  });
  const { X, Y } = view;
  const creeks = new CreekLayer(() => view.redraw());
  let journal: JournalOverlay | null = null;

  function drawBase() {
    const c = view.bctx;
    const { W, H } = view;
    const { s, tx, ty } = view.cam;
    c.setTransform(view.DPR, 0, 0, view.DPR, 0, 0);
    c.fillStyle = C.bg;
    c.fillRect(0, 0, W, H);
    c.save();
    c.setTransform(view.DPR * s, 0, 0, view.DPR * s, view.DPR * tx, view.DPR * ty);
    // How far the aquifer has fallen, under everything.
    c.imageSmoothingEnabled = true;
    c.drawImage(shade, sx0, syTop, sx1 - sx0, syBottom - syTop);
    c.restore();
    drawLakes(c, water, X, Y, view.cam, { sea: C.sea, lake: C.lake, shore: C.shore, marsh: C.marsh, label: C.muted });
    c.save();
    c.setTransform(view.DPR * s, 0, 0, view.DPR * s, view.DPR * tx, view.DPR * ty);
    // Mined land.
    c.fillStyle = C.muted;
    c.globalAlpha = glow ? 0.22 : 0.3;
    c.fill(minePath, "evenodd");
    c.globalAlpha = 0.6;
    c.strokeStyle = C.muted;
    c.lineWidth = 0.8 / s;
    c.stroke(minePath);
    c.globalAlpha = 1;
    creeks.update([-tx / s, -ty / s, (W - tx) / s, (H - ty) / s], s);
    c.strokeStyle = C.stream;
    c.globalAlpha = 0.7;
    creeks.draw(c, s);
    c.globalAlpha = 1;
    c.lineCap = "round";
    c.lineJoin = "round";
    c.strokeStyle = C.tannin;
    for (const n of PEACE_RIVERS) {
      c.lineWidth = (n === PR ? 2.6 : 1.5) / s;
      c.stroke(riverPaths[n]);
    }
    c.restore();

    c.font = "500 12px 'Barlow Semi Condensed',sans-serif";
    c.fillStyle = C.muted;
    for (const [n, lon, lat, east] of TOWNS) {
      const p = project(lon, lat);
      c.textAlign = east ? "left" : "right";
      c.fillText(n, X(p[0]) + (east ? 5 : -5), Y(p[1]) + 4);
    }
    c.textAlign = "left";
    if (view.scale > 2000) drawLakeLabels(c, water, X, Y, view.scale, C.muted, view.keyBoxes());
    // The sinks, and Kissengen Spring's dry pool.
    c.fillStyle = C.under;
    for (const sk of sinks) {
      c.beginPath();
      c.arc(X(sk.xy[0]), Y(sk.xy[1]), 2.6, 0, 7);
      c.fill();
    }
    const [kx, ky] = [X(kissengen[0]), Y(kissengen[1])];
    c.strokeStyle = C.spring;
    c.lineWidth = 1.6;
    c.setLineDash([3, 2.5]);
    c.beginPath();
    c.arc(kx, ky, 6, 0, 7);
    c.stroke();
    c.setLineDash([]);
    c.font = "italic 400 13px 'Spectral',serif";
    c.fillStyle = C.spring;
    c.fillText(`Kissengen Spring, dry since ${KISSENGEN.dry}`, kx + 10, ky + 4);
    if (journal) drawJournal(c, journal, X, Y, [], C.ink, glow);
    const readable = view.scale >= LABEL_SCALE;
    c.font = "600 12px 'Barlow Semi Condensed',sans-serif";
    for (const g of gauges) {
      const [x, y] = [X(g.xy[0]), Y(g.xy[1])];
      c.fillStyle = C.bg;
      c.strokeStyle = C.ink;
      c.lineWidth = 1.2;
      c.beginPath();
      c.arc(x, y, 3.5, 0, 7);
      c.fill();
      c.stroke();
      if (!readable || g.cfs == null) continue;
      c.fillStyle = liveMeta.get(g.key)?.stale ? C.muted : C.ink;
      c.textAlign = "right";
      c.fillText(`${fmtCfs(g.cfs)} cfs`, x - 7, y + 4);
      c.textAlign = "left";
    }
  }

  // ---------- drops ----------
  const drops: Drop[] = [];
  /** Water going down a sink: a shrinking ring where it vanishes. */
  const swirls: { xy: XY; t: number }[] = [];
  function step(dt: number) {
    const share = lostShare();
    for (const f of inflows) {
      f.acc += f.rate() * K * dt;
      while (f.acc >= 1) {
        f.acc -= 1;
        if (drops.length >= MAX_DROPS) continue;
        const d = f.from + Math.random() * (f.to - f.from);
        // Bartow's water is what the sinks take from, by the share the gauges say.
        const sink = f.on === PR && d <= dBAR + 1e-9 && sinkAt.length && Math.random() < share ? sinkAt[Math.floor(Math.random() * sinkAt.length)] : null;
        drops.push({ on: f.on, d, sink, prev: null });
      }
    }
    for (let n = drops.length - 1; n >= 0; n--) {
      const p = drops[n];
      p.d += (KMS / 111) * dt;
      if (p.sink != null && p.on === PR && p.d >= p.sink) {
        if (swirls.length < 60) swirls.push({ xy: pointAt(lines[PR], p.sink), t: 0 });
        drops.splice(n, 1);
        continue;
      }
      if (p.d >= lines[p.on].len) {
        if (p.on === PR) {
          drops.splice(n, 1);
          continue;
        }
        p.d = joins[p.on];
        p.on = PR;
        p.prev = null;
      }
    }
    for (let i = swirls.length - 1; i >= 0; i--) {
      swirls[i].t += dt;
      if (swirls[i].t > 1.2) swirls.splice(i, 1);
    }
  }

  const streaks = new StreakLayer();
  function draw() {
    const c = view.fctx;
    const { W, H } = view;
    const sc = view.scale;
    c.setTransform(view.DPR, 0, 0, view.DPR, 0, 0);
    fadeLayer(c, W, H, Math.min(0.55, Math.max(0.2, 0.2 * Math.sqrt(sc / 1000))));
    const z = Math.min(2.4, Math.max(1, sc / 1500));
    streaks.style(0, C.tannin, glow ? 0.5 : 0.85, z);
    streaks.begin();
    for (const p of drops) {
      const a = pointAt(lines[p.on], p.d);
      const [x, y] = [X(a[0]), Y(a[1])];
      const [px, py] = p.prev ? [X(p.prev[0]), Y(p.prev[1])] : [x - 0.8, y - 0.8];
      p.prev = a;
      if (x < -10 || y < -10 || x > W + 10 || y > H + 10) continue;
      streaks.add(0, px, py, x, y);
    }
    streaks.flush(c, glow);
    // Rings closing in where water goes down a sink.
    c.strokeStyle = C.under;
    c.lineWidth = 1.2;
    for (const sw of swirls) {
      const k = sw.t / 1.2;
      c.globalAlpha = (1 - k) * 0.9;
      c.beginPath();
      c.arc(X(sw.xy[0]), Y(sw.xy[1]), 1 + (1 - k) * 6 * z, 0, 7);
      c.stroke();
    }
    c.globalAlpha = 1;
  }

  function refill(seconds: number, dt: number) {
    drops.length = 0;
    for (let t = 0; t < seconds; t += dt) step(dt);
    for (const p of drops) p.prev = null;
    swirls.length = 0;
    view.clearFx();
  }

  // ---------- cards ----------
  const probe = document.createElement("canvas").getContext("2d")!;
  const toLonLat = (m: XY): [number, number] => [m[0] / Math.cos((29.8 * Math.PI) / 180) - 82.6, 29.8 - m[1]];
  function tap(x: number, y: number) {
    if (journal) {
      const seen = hitSighting(journal, X, Y, x, y);
      if (seen) return card.show(sightingCard(seen));
    }
    let best: (() => void) | null = null;
    let bd = 16 * 16;
    const test = (xy: XY, f: () => void) => {
      const d = (X(xy[0]) - x) ** 2 + (Y(xy[1]) - y) ** 2;
      if (d < bd) {
        bd = d;
        best = f;
      }
    };
    test(kissengen, () => card.show({ title: "Kissengen Spring", kind: `Spring, dry since ${KISSENGEN.dry}`, body: `${KISSENGEN_TEXT}${journal ? ` ${journalCardHtml(journal, "kissengen-spring--polk")}` : ""}` }));
    for (const g of gauges) test(g.xy, () => showGauge(g));
    for (const sk of sinks) test(sk.xy, () => card.show({ title: sk.name ?? "A sink", kind: "Sink in the riverbed", body: SINK_TEXT }));
    if (best) return (best as () => void)();
    const m: XY = [(x - view.cam.tx) / view.cam.s, (y - view.cam.ty) / view.cam.s];
    const [lon, lat] = toLonLat(m);
    const cell = cellAt(lon, lat);
    const fall = cell >= 0 ? AQUIFER_TEXT(fallNow[cell], fallDry[cell], aq.months) : "";
    const near = 14 / view.cam.s;
    const river = PEACE_RIVERS.map((n) => [n, nearestDistance(lines[n], ...m)] as const).filter(([, d]) => d < near).sort((a, b) => a[1] - b[1])[0];
    if (river) return card.show({ title: river[0], kind: "River", body: `${river[0] === PR ? RIVER_TEXT : ""} ${fall}`.trim() });
    if (probe.isPointInPath(minePath, m[0], m[1], "evenodd")) return card.show({ title: "Mined land", kind: "Phosphate", body: `${MINE_TEXT(data.minesKm2)} ${fall}` });
    if (fall) return card.show({ title: "The aquifer below", kind: "Upper Floridan aquifer", body: fall });
    card.hide();
  }

  function showGauge(g: Gauge) {
    const meta = liveMeta.get(g.key);
    const when = meta ? `, ${timeFmt(meta.time)}` : "";
    let body = g.cfs == null ? "No recent reading at this gauge." : `<b>${fmtCfs(g.cfs)} cfs</b>${when}.`;
    if (meta?.stale) body += " This gauge hasn't reported recently, so treat it as old.";
    card.show({ title: g.name ?? g.short, kind: `USGS gauge ${g.id}`, body });
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
      v.textContent = fmtCfs(g.cfs);
      const u = document.createElement("small");
      u.textContent = "cfs";
      v.appendChild(u);
      const n = document.createElement("div");
      n.className = "n";
      n.textContent = g.short;
      b.append(v, n);
      b.addEventListener("click", () => {
        view.flyTo(g.xy, 7000);
        showGauge(g);
      });
      el.appendChild(b);
    }
  }

  const snapLabel = timeFmt(new Date(snapshot.time));
  function renderCopy(state: "checking" | "live" | "snapshot") {
    const bar = G("BAR").cfs;
    const ftm = G("FTM").cfs;
    const lost = bar != null && ftm != null && bar > ftm ? bar - ftm : null;
    document.getElementById("lede")!.innerHTML =
      `Kissengen Spring poured about ${KISSENGEN.mgd} million gallons a day into the Peace River until ${KISSENGEN.dry}, when it went dry: the first big spring in Florida lost to pumping. ` +
      `Wells for phosphate mines and farms had drawn the aquifer down, and it's still <b>${aq.nowMax} feet</b> lower in places than before them. The upper river now leaks into sinks instead of being fed from below. ` +
      (bar != null && ftm != null ? `Right now <b>${fmtCfs(bar)} cfs</b> passes Bartow and <b>${fmtCfs(ftm)} cfs</b> reaches Fort Meade${lost ? `, ${fmtCfs(lost)} cfs lost on the way` : ""}. ` : "") +
      "Tap anything on the map.";
    const tail = "Flow is in cubic feet per second (cfs). Rivers: USGS NHD. Aquifer: FGS potentiometric surfaces. Sinks: FGS. Mined land: FDEP.";
    document.getElementById("status")!.textContent =
      state === "live" ? `Live USGS readings, updated ${timeFmt(liveTime!)}. ${tail}`
      : state === "checking" ? `USGS readings from ${snapLabel}. Checking for live readings… ${tail}`
      : `USGS readings from ${snapLabel}. Live readings didn't load, so this is a saved snapshot. ${tail}`;
  }

  // ---------- flow since the 1930s ----------
  const hist = data.history;
  function renderHist() {
    const mean = (vs: (number | null)[], from: number, to: number) => {
      const ok = hist.years.map((y, i) => (y >= from && y <= to ? vs[i] : null)).filter((v): v is number => v != null);
      return ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : null;
    };
    const firstBar = hist.years[hist.BAR.findIndex((v) => v != null)];
    const last = hist.years[hist.years.length - 1];
    const early = mean(hist.BAR, firstBar, firstBar + 19);
    const late = mean(hist.BAR, last - 19, last);
    document.getElementById("histRead")!.innerHTML =
      `At Bartow the Peace averaged <b>${fmtCfs(early)} cfs</b> in its first 20 years on record (${firstBar}–${firstBar + 19}) and <b>${fmtCfs(late)} cfs</b> in the last 20. ` +
      "Rain swings it year to year, and a drawn-down aquifer takes its share on the way; downstream at Arcadia, the tributaries make up much of the difference.";
    renderHistory(document.getElementById("histChart")!, hist.years, [
      { name: "Peace at Bartow", color: "--chart-tannin", values: hist.BAR },
      { name: "Peace at Arcadia", color: "--chart-estuary", values: hist.ARC },
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

  async function tryLive() {
    const flows = await fetchLatest(gauges.map((g) => g.id));
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
  document.getElementById("bUpper")!.addEventListener("click", () => view.fit(VIEWS.upper, true));
  document.getElementById("bMines")!.addEventListener("click", () => view.fit(VIEWS.mines, true));
  document.getElementById("bHarbor")!.addEventListener("click", () => view.fit(VIEWS.harbor, true));

  readColors();
  setFlows(current);
  renderProfile();
  renderCopy("checking");
  view.resize();
  view.fit(VIEWS.all);
  refill(60, 0.1);
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
    drawBase();
  });
  tryLive().catch((err) => {
    console.warn("Live USGS readings unavailable; using snapshot.", err);
    renderCopy("snapshot");
  });
}

main().catch(showLoadError);
