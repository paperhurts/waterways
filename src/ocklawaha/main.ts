import "../shared/map.css";
import "../shared/nav";
import "../shared/story.css";
import "./ocklawaha.css";
import gaugeConfig from "../../config/gauges.json";
import { CreekLayer } from "../rain/creeks";
import { InfoCard } from "../shared/card";
import { loadData, showLoadError } from "../shared/data";
import { locate, nearestDistance, pointAt, polyline, project, ringsPath, unpackRings, type Polyline, type XY } from "../shared/geo";
import { renderHistory } from "../shared/history";
import { drawJournal, hitSighting, journalCardHtml, loadJournalOverlay, sightingCard, type JournalOverlay } from "../shared/journal-overlay";
import { decodeLakes, drawLakeLabels, drawLakes } from "../shared/lakes";
import { STALE_MS, fetchLatest, fmtCfs } from "../shared/live";
import { StreakLayer, fadeLayer } from "../shared/streaks";
import { cssVar, fontsReady, isDark, onColorSchemeChange } from "../shared/theme";
import { OCK_KEYS, type GaugeConfig, type LakesFile, type OckFlows, type OckKey, type OckStructure, type OcklawahaFile, type Snapshot } from "../shared/types";
import { Viewport, startLoop } from "../shared/viewport";
import { CANAL_TEXT, DROWNED_TEXT, FACTS, RESERVOIR_TEXT, RIVER_TEXT, SILVER_TEXT, STRUCTURE_TEXT, TOWNS, VIEWS } from "./content";

/** Drops spawned per cfs per second. */
const K = 0.05;
const MAX_DROPS = 8000;
/** Visual speed (km a second): down the river, and across the reservoir, where it barely moves. */
const RIVER_KMS = 1.8;
const RESERVOIR_KMS = 0.4;
/** How far drops spread across the reservoir (map units, ~400 m): its narrow southern arm sets the limit. */
const SPREAD = 0.004;
const LABEL_SCALE = 1500;

type Stream = "ock" | "silver" | "orange";

interface Gauge extends GaugeConfig {
  key: OckKey;
  cfs: number | null;
  xy: XY;
}

interface Drop {
  on: Stream;
  d: number;
  side: number;
  off: number;
  spring: boolean;
  prev: XY | null;
}

const timeFmt = (d: Date) => d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

async function main() {
  const [data, snapshot] = await Promise.all([loadData<OcklawahaFile>("ocklawaha.json"), loadData<Snapshot>("snapshot.json"), fontsReady()]);
  const { coordOrigin, coordScale } = data.meta;
  const unpackLine = (flat: number[]): XY[] => unpackRings([flat], coordOrigin, coordScale)[0];
  const water = decodeLakes({ meta: data.meta, bodies: data.water } as LakesFile);
  // The reservoir is named in the legend and its card; an L-shaped lake's label lands off it.
  for (const b of water) if (b.name === "Lake Ocklawaha") b.name = null;
  const reservoirPath = ringsPath(unpackRings(data.reservoir, coordOrigin, coordScale));
  const lines: Record<Stream, Polyline> = {
    ock: polyline(unpackLine(data.rivers["Ocklawaha River"].p)),
    silver: polyline(unpackLine(data.rivers["Silver River"].p)),
    orange: polyline(unpackLine(data.rivers["Orange Creek"].p)),
  };
  const res = data.rivers["Ocklawaha River"].res;
  const inReservoir = (d: number) => res[locate(lines.ock, d).lo] === 1;
  /** Where each tributary's water joins the Ocklawaha: the distance down it nearest the tributary's end. */
  const joinAt = (l: Polyline) => {
    const end = l.pts[l.pts.length - 1];
    let best = 0;
    let bd = Infinity;
    lines.ock.pts.forEach((q, i) => {
      const d = (q[0] - end[0]) ** 2 + (q[1] - end[1]) ** 2;
      if (d < bd) {
        bd = d;
        best = lines.ock.cum[i];
      }
    });
    return best;
  };
  const joins = { silver: joinAt(lines.silver), orange: joinAt(lines.orange) };
  const toPath = (pts: XY[][]) => {
    const p = new Path2D();
    for (const l of pts) l.forEach((q, i) => (i ? p.lineTo(q[0], q[1]) : p.moveTo(q[0], q[1])));
    return p;
  };
  // The Ocklawaha as two paths, free and drowned, built once in map units.
  const free = new Path2D();
  const drowned = new Path2D();
  for (let i = 0; i < lines.ock.pts.length - 1; i++) {
    const p = res[i] ? drowned : free;
    p.moveTo(...lines.ock.pts[i]);
    p.lineTo(...lines.ock.pts[i + 1]);
  }
  const silverPath = toPath([lines.silver.pts]);
  const orangePath = toPath([lines.orange.pts]);
  const canals = data.canal.map((c) => polyline(unpackLine(c)));
  const canalPath = toPath(canals.map((c) => c.pts));
  const springs = data.drowned.map(([id, name, lon, lat, mag]) => ({ id, name, lon, lat, mag, xy: project(lon, lat) }));
  const structures = data.structures.map((s) => ({ ...s, xy: project(s.lon, s.lat) }));

  // ---------- gauges ----------
  const gauges: Gauge[] = (gaugeConfig as GaugeConfig[])
    .filter((g): g is GaugeConfig & { key: OckKey } => g.page === "ocklawaha")
    .map((g) => ({ ...g, cfs: null, xy: project(g.lon, g.lat) }));
  const G = (k: OckKey) => gauges.find((g) => g.key === k)!;
  const current = Object.fromEntries(OCK_KEYS.map((k) => [k, snapshot.cfs[k] ?? null])) as OckFlows;
  const liveMeta = new Map<string, { time: Date; stale: boolean }>();
  let liveTime: Date | null = null;
  const setFlows = (f: OckFlows) => {
    for (const g of gauges) g.cfs = f[g.key];
  };

  // ---------- map ----------
  let C: Record<string, string> = {};
  let glow = true;
  const readColors = () => {
    C = Object.fromEntries(["bg", "ink", "muted", "tannin", "spring", "under", "sea", "lake", "shore", "marsh", "stream"].map((n) => [n, cssVar(`--${n}`)]));
    glow = isDark();
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
    drawLakes(c, water, X, Y, view.cam, { sea: C.sea, lake: C.lake, shore: C.shore, marsh: C.marsh, label: C.muted });
    c.save();
    c.setTransform(view.DPR * s, 0, 0, view.DPR * s, view.DPR * tx, view.DPR * ty);
    // The reservoir: the drowned valley, set apart from the lakes.
    c.fillStyle = C.under;
    c.globalAlpha = glow ? 0.18 : 0.22;
    c.fill(reservoirPath, "evenodd");
    c.globalAlpha = 0.8;
    c.strokeStyle = C.under;
    c.lineWidth = 1.2 / s;
    c.stroke(reservoirPath);
    c.globalAlpha = 1;
    creeks.update([-tx / s, -ty / s, (W - tx) / s, (H - ty) / s], s);
    c.strokeStyle = C.stream;
    c.globalAlpha = 0.7;
    creeks.draw(c, s);
    c.globalAlpha = 1;
    c.lineCap = "round";
    c.lineJoin = "round";
    // The canal, the river, and the river's old course under the reservoir.
    c.strokeStyle = C.muted;
    c.lineWidth = 3 / s;
    c.lineCap = "butt";
    c.stroke(canalPath);
    c.lineCap = "round";
    c.strokeStyle = C.tannin;
    c.lineWidth = 2.4 / s;
    c.stroke(free);
    c.stroke(orangePath);
    c.lineWidth = 1.3 / s;
    c.setLineDash([5 / s, 4 / s]);
    c.stroke(drowned);
    c.setLineDash([]);
    c.strokeStyle = C.spring;
    c.lineWidth = 2.4 / s;
    c.stroke(silverPath);
    c.restore();

    c.font = "500 12px 'Barlow Semi Condensed',sans-serif";
    c.fillStyle = C.muted;
    for (const [n, lon, lat, east] of TOWNS) {
      const p = project(lon, lat);
      c.textAlign = east ? "left" : "right";
      c.fillText(n, X(p[0]) + (east ? 5 : -5), Y(p[1]) + 4);
    }
    c.textAlign = "left";
    if (view.scale > 1600) drawLakeLabels(c, water, X, Y, view.scale, C.muted);
    // The drowned springs: rings, hollow, under the water.
    c.strokeStyle = C.spring;
    c.lineWidth = 1.4;
    c.globalAlpha = 0.85;
    for (const sp of springs) {
      c.beginPath();
      c.arc(X(sp.xy[0]), Y(sp.xy[1]), 3.5, 0, 7);
      c.stroke();
    }
    c.globalAlpha = 1;
    if (journal) drawJournal(c, journal, X, Y, [], C.ink, glow);
    // Structures, and the gauges' readings once zoomed in.
    c.font = "600 12px 'Barlow Semi Condensed',sans-serif";
    for (const st of structures) {
      const [x, y] = [X(st.xy[0]), Y(st.xy[1])];
      c.lineWidth = 1.6;
      c.strokeStyle = C.ink;
      c.fillStyle = st.role === "unfinished" ? C.bg : C.ink;
      c.beginPath();
      c.rect(x - 4.5, y - 4.5, 9, 9);
      c.fill();
      c.stroke();
      c.fillStyle = C.ink;
      c.fillText(st.name, x + 9, y + 4);
    }
    const readable = view.scale >= LABEL_SCALE;
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
  const acc = { ock: Math.random(), silver: Math.random(), orange: Math.random() };
  function offset(line: Polyline, d: number, off: number): XY {
    const a = pointAt(line, d);
    if (!off) return a;
    const b = pointAt(line, Math.min(line.len, d + 0.002));
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    const n = Math.hypot(dx, dy) || 1;
    return [a[0] - (dy / n) * off, a[1] + (dx / n) * off];
  }
  const newDrop = (on: Stream, spring: boolean): Drop => ({ on, d: 0, side: (Math.random() - 0.5) * 2, off: 0, spring, prev: null });

  function step(dt: number) {
    const emit = (key: Stream, perSecond: number, f: () => void) => {
      acc[key] += perSecond * dt;
      while (acc[key] >= 1) {
        acc[key] -= 1;
        if (drops.length < MAX_DROPS) f();
      }
    };
    const mb = G("MB").cfs;
    const silv = G("SILV").cfs;
    const orc = G("ORC").cfs;
    if (mb && mb > 0) emit("ock", mb * K, () => drops.push(newDrop("ock", false)));
    if (silv && silv > 0) emit("silver", silv * K, () => drops.push(newDrop("silver", true)));
    if (orc && orc > 0) emit("orange", orc * K, () => drops.push(newDrop("orange", false)));
    for (let n = drops.length - 1; n >= 0; n--) {
      const p = drops[n];
      const wet = p.on === "ock" && inReservoir(p.d);
      p.d += ((wet ? RESERVOIR_KMS : RIVER_KMS) / 111) * dt;
      const line = lines[p.on];
      if (p.d >= line.len) {
        if (p.on === "ock") {
          drops.splice(n, 1);
          continue;
        }
        // A tributary's water carries on down the Ocklawaha.
        p.d = joins[p.on];
        p.on = "ock";
      }
      const want = wet ? SPREAD * p.side : 0;
      p.off += (want - p.off) * Math.min(1, dt * 0.4);
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
    streaks.style(1, C.spring, glow ? 0.45 : 0.8, z);
    streaks.begin();
    for (const p of drops) {
      const at = offset(lines[p.on], p.d, p.off);
      const [x, y] = [X(at[0]), Y(at[1])];
      const [px, py] = p.prev ? [X(p.prev[0]), Y(p.prev[1])] : [x - 0.8, y - 0.8];
      p.prev = at;
      if (x < -10 || y < -10 || x > W + 10 || y > H + 10) continue;
      streaks.add(p.spring ? 1 : 0, px, py, x, y);
    }
    streaks.flush(c, glow);
  }

  function refill(seconds: number, dt: number) {
    drops.length = 0;
    for (let t = 0; t < seconds; t += dt) step(dt);
    for (const p of drops) p.prev = null;
    view.clearFx();
  }

  // ---------- cards ----------
  const probe = document.createElement("canvas").getContext("2d")!;
  function tap(x: number, y: number) {
    if (journal) {
      const seen = hitSighting(journal, X, Y, x, y);
      if (seen) return card.show(sightingCard(seen));
    }
    let best: (() => void) | null = null;
    let bd = 18 * 18;
    const test = (xy: XY, f: () => void) => {
      const d = (X(xy[0]) - x) ** 2 + (Y(xy[1]) - y) ** 2;
      if (d < bd) {
        bd = d;
        best = f;
      }
    };
    for (const st of structures) test(st.xy, () => showStructure(st));
    for (const g of gauges) test(g.xy, () => showGauge(g));
    for (const sp of springs) test(sp.xy, () => card.show({ title: sp.name, kind: "Spring under the reservoir", body: `${DROWNED_TEXT}${journal ? ` ${journalCardHtml(journal, sp.id)}` : ""}` }));
    if (best) return (best as () => void)();
    const m: XY = [(x - view.cam.tx) / view.cam.s, (y - view.cam.ty) / view.cam.s];
    const near = 14 / view.cam.s;
    if (nearestDistance(lines.silver, ...m) < near) return card.show({ title: "Silver River", kind: "Spring run", body: SILVER_TEXT });
    if (canals.some((l) => nearestDistance(l, ...m) < near)) return card.show({ title: "Cross Florida Barge Canal", kind: "Canal", body: CANAL_TEXT });
    if (probe.isPointInPath(reservoirPath, m[0], m[1], "evenodd")) return card.show({ title: "Rodman Reservoir", kind: "Reservoir", body: RESERVOIR_TEXT });
    if (nearestDistance(lines.ock, ...m) < near || nearestDistance(lines.orange, ...m) < near) return card.show({ title: "Ocklawaha River", kind: "River", body: RIVER_TEXT });
    card.hide();
  }

  function showStructure(st: OckStructure) {
    card.show({ title: st.name, kind: st.role === "unfinished" ? "Lock and dam, never finished" : st.role === "lock" ? "Lock" : "Dam", body: STRUCTURE_TEXT[st.role] });
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
    const silv = G("SILV").cfs;
    const rod = G("ROD").cfs;
    document.getElementById("lede")!.innerHTML =
      "The Ocklawaha runs from Lake Griffin and Silver Springs north to the St. Johns. " +
      `In ${FACTS.damBuilt} a dam was built across it for the Cross Florida Barge Canal, flooding <b>${FACTS.reservoirMiles} miles</b> of the river, ${FACTS.forestAcres.toLocaleString()} acres of floodplain forest, and about <b>${FACTS.springs} springs</b>. ` +
      `The canal was stopped in ${FACTS.halted} and never finished. The dam still stands. ` +
      (silv != null && rod != null ? `Right now Silver Springs is sending <b>${fmtCfs(silv)} cfs</b> down its river, and <b>${fmtCfs(rod)} cfs</b> is leaving the dam. ` : "") +
      "Tap anything on the map.";
    const tail = "Flow is in cubic feet per second (cfs). River, reservoir, and canal: USGS NHD. Springs: FDEP.";
    document.getElementById("status")!.textContent =
      state === "live" ? `Live USGS readings, updated ${timeFmt(liveTime!)}. ${tail}`
      : state === "checking" ? `USGS readings from ${snapLabel}. Checking for live readings… ${tail}`
      : `USGS readings from ${snapLabel}. Live readings didn't load, so this is a saved snapshot. ${tail}`;
  }

  // ---------- Silver Springs since 1933 ----------
  const hist = data.history;
  function renderHist() {
    const mean = (from: number, to: number) => {
      const vs = hist.years.map((y, i) => (y >= from && y <= to ? hist.SILV[i] : null)).filter((v): v is number => v != null);
      return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null;
    };
    const first = hist.years[hist.SILV.findIndex((v) => v != null)];
    const last = hist.years[hist.years.length - 1];
    const early = mean(first, first + 19);
    const late = mean(last - 9, last);
    const drop = early && late ? Math.round((1 - late / early) * 100) : null;
    document.getElementById("histRead")!.innerHTML =
      `Silver Springs put out <b>${fmtCfs(early)} cfs</b> a year on average in its first 20 years on record (${first}–${first + 19}), and <b>${fmtCfs(late)} cfs</b> in the last 10` +
      (drop != null && drop > 0 ? `, about <b>${drop}%</b> less` : "") +
      ". Studies tie the drop to drier years and to groundwater pumped from its springshed. The Ocklawaha at Eureka, above the reservoir, carries the springs' water with the rest of the river's.";
    renderHistory(document.getElementById("histChart")!, hist.years, [
      { name: "Silver River (Silver Springs)", color: "--chart-spring", values: hist.SILV },
      { name: "Ocklawaha at Eureka", color: "--chart-tannin", values: hist.EUR },
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
  document.getElementById("bReservoir")!.addEventListener("click", () => view.fit(VIEWS.reservoir, true));
  document.getElementById("bMouth")!.addEventListener("click", () => view.fit(VIEWS.mouth, true));

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

