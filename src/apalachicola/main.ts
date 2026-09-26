import "../shared/map.css";
import "../shared/nav";
import "../shared/story.css";
import "./apalachicola.css";
import gaugeConfig from "../../config/gauges.json";
import { InfoCard } from "../shared/card";
import { loadData, showLoadError } from "../shared/data";
import { locate, nearestDistance, pointAt, polyline, project, ringsPath, unpackRings, type Polyline, type XY } from "../shared/geo";
import { renderHistory } from "../shared/history";
import { drawJournal, hitSighting, loadJournalOverlay, sightingCard, type JournalOverlay } from "../shared/journal-overlay";
import { decodeLakes, drawLakeLabels, drawLakes } from "../shared/lakes";
import { STALE_MS, fetchLatest, fmtCfs } from "../shared/live";
import { StreakLayer, fadeLayer } from "../shared/streaks";
import { cssVar, fontsReady, isDark, onColorSchemeChange } from "../shared/theme";
import { AP_KEYS, AP_RIVERS, type ApFlows, type ApKey, type ApRiver, type ApStructure, type ApalachicolaFile, type GaugeConfig, type LakesFile, type Snapshot } from "../shared/types";
import { Viewport, startLoop } from "../shared/viewport";
import { CITIES, COURT_TEXT, DAM_TEXT, FACTS, OYSTER_TEXT, RIVER_TEXT, VIEWS } from "./content";

/** Drops spawned per cfs per second. */
const K = 0.0035;
const MAX_DROPS = 9000;
/** Visual speed (km a second): down the rivers, and through the reservoirs behind the dams. */
const RIVER_KMS = 9;
const POOL_KMS = 2;
/** Drops spread this far across a reservoir (map units, ~500 m). */
const POOL_SPREAD = 0.005;
const LABEL_SCALE = 900;
/** Line width by river, at the whole-basin view. */
const WIDTH: Record<ApRiver, number> = { "Chattahoochee River": 2, "Flint River": 1.8, "Apalachicola River": 2.8, "Chipola River": 1.4 };
const STATES: [name: string, lon: number, lat: number][] = [["GEORGIA", -84.2, 32.3], ["ALABAMA", -85.4, 32.1], ["FLORIDA", -84.6, 30.25]];

interface Gauge extends GaugeConfig {
  key: ApKey;
  cfs: number | null;
  xy: XY;
}

interface Drop {
  on: ApRiver;
  d: number;
  side: number;
  off: number;
  prev: XY | null;
}

/** Water entering a river along a stretch of it: `rate` cfs spread evenly from `from` to `to` (map units along it). */
interface Inflow {
  on: ApRiver;
  from: number;
  to: number;
  rate: () => number;
  acc: number;
}

const timeFmt = (d: Date) => d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

async function main() {
  const [data, snapshot] = await Promise.all([loadData<ApalachicolaFile>("apalachicola.json"), loadData<Snapshot>("snapshot.json"), fontsReady()]);
  const { coordOrigin, coordScale } = data.meta;
  const unpackLine = (flat: number[]): XY[] => unpackRings([flat], coordOrigin, coordScale)[0];
  const water = decodeLakes({ meta: data.meta, bodies: data.water } as LakesFile);
  const lines = Object.fromEntries(AP_RIVERS.map((n) => [n, polyline(unpackLine(data.rivers[n].p))])) as Record<ApRiver, Polyline>;
  const pooled = (on: ApRiver, d: number) => data.rivers[on].pool[locate(lines[on], d).lo] === 1;
  const toPath = (pts: XY[][]) => {
    const p = new Path2D();
    for (const l of pts) l.forEach((q, i) => (i ? p.lineTo(q[0], q[1]) : p.moveTo(q[0], q[1])));
    return p;
  };
  const riverPaths = Object.fromEntries(AP_RIVERS.map((n) => [n, toPath([lines[n].pts])])) as Record<ApRiver, Path2D>;
  const contextPath = toPath(data.context.map(unpackLine));
  const borderPath = toPath(data.borders.map(unpackLine));
  const oysterPath = ringsPath(unpackRings(data.oysters, coordOrigin, coordScale));
  const structures = data.structures.map((s) => ({ ...s, xy: project(s.lon, s.lat) }));
  /** Distance along a line to its vertex nearest a point. */
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

  // ---------- gauges and where water joins ----------
  const gauges: Gauge[] = (gaugeConfig as GaugeConfig[])
    .filter((g): g is GaugeConfig & { key: ApKey } => g.page === "apalachicola")
    .map((g) => ({ ...g, cfs: null, xy: project(g.lon, g.lat) }));
  const G = (k: ApKey) => gauges.find((g) => g.key === k)!;
  const q = (k: ApKey) => G(k).cfs ?? 0;
  const at = (on: ApRiver, k: ApKey) => along(lines[on], G(k).xy);
  const CH: ApRiver = "Chattahoochee River";
  const FL: ApRiver = "Flint River";
  const AP: ApRiver = "Apalachicola River";
  const CP: ApRiver = "Chipola River";
  const dATL = at(CH, "ATL");
  const dCOL = at(CH, "COL");
  const dBAIN = at(FL, "BAIN");
  const dBLT = at(AP, "BLT");
  const dSUM = at(AP, "SUM");
  const joinChipola = along(lines[AP], lines[CP].pts[lines[CP].pts.length - 1]);
  // Water spawns where the gauges say it's gained: each gauge's gain over the ones above it, spread along the stretch it came in on.
  const pos = (v: number) => Math.max(0, v);
  const inflows: Inflow[] = [
    { on: CH, from: 0, to: 0, rate: () => q("BUF"), acc: Math.random() },
    { on: CH, from: 0, to: dATL, rate: () => pos(q("ATL") - q("BUF")), acc: Math.random() },
    { on: CH, from: dATL, to: dCOL, rate: () => pos(q("COL") - q("ATL")), acc: Math.random() },
    { on: CH, from: dCOL, to: lines[CH].len, rate: () => pos(q("CHAT") - q("COL") - q("BAIN")), acc: Math.random() },
    { on: FL, from: 0, to: dBAIN, rate: () => q("BAIN"), acc: Math.random() },
    { on: AP, from: 0, to: dBLT, rate: () => pos(q("BLT") - q("CHAT")), acc: Math.random() },
    { on: CP, from: 0, to: 0, rate: () => q("ALT"), acc: Math.random() },
    { on: AP, from: dBLT, to: dSUM, rate: () => pos(q("SUM") - q("BLT") - q("ALT")), acc: Math.random() },
  ];
  /** Where each river's water goes at its end: the Apalachicola, at a distance down it, or the bay. */
  const next: Record<ApRiver, [ApRiver, number] | null> = { [CH]: [AP, 0], [FL]: [AP, 0], [CP]: [AP, joinChipola], [AP]: null } as Record<ApRiver, [ApRiver, number] | null>;

  const current = Object.fromEntries(AP_KEYS.map((k) => [k, snapshot.cfs[k] ?? null])) as ApFlows;
  const liveMeta = new Map<string, { time: Date; stale: boolean }>();
  let liveTime: Date | null = null;
  const setFlows = (f: ApFlows) => {
    for (const g of gauges) g.cfs = f[g.key];
  };

  // ---------- map ----------
  let C: Record<string, string> = {};
  let glow = true;
  const readColors = () => {
    C = Object.fromEntries(["bg", "ink", "muted", "tannin", "sea", "lake", "shore", "marsh", "stream", "line"].map((n) => [n, cssVar(`--${n}`)]));
    glow = isDark();
  };
  let histMode = false;
  const card = new InfoCard();
  const view = new Viewport({
    minScale: 60,
    maxScale: 40000,
    padding: (w) => (w < 600 ? { x: 14, top: histMode ? 14 : 70, bottom: 16 } : { x: 60, top: 50, bottom: 40 }),
    drawBase,
    onTap: tap,
  });
  const { X, Y } = view;
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
    c.lineCap = "round";
    c.lineJoin = "round";
    // State lines, then the basin's other streams, then the four rivers.
    c.strokeStyle = C.muted;
    c.globalAlpha = 0.7;
    c.lineWidth = 1 / s;
    c.setLineDash([6 / s, 4 / s]);
    c.stroke(borderPath);
    c.setLineDash([]);
    c.strokeStyle = C.stream;
    c.globalAlpha = 0.8;
    c.lineWidth = 0.9 / s;
    c.stroke(contextPath);
    c.globalAlpha = 1;
    c.strokeStyle = C.tannin;
    for (const n of AP_RIVERS) {
      c.lineWidth = (WIDTH[n] * Math.min(1.6, Math.max(1, Math.sqrt(s / 400)))) / s;
      c.stroke(riverPaths[n]);
    }
    // Oyster beds, pale as shell.
    c.fillStyle = C.ink;
    c.globalAlpha = glow ? 0.55 : 0.45;
    c.fill(oysterPath, "evenodd");
    c.globalAlpha = 1;
    c.restore();

    c.font = "600 12px 'Barlow Semi Condensed',sans-serif";
    c.fillStyle = C.muted;
    c.globalAlpha = 0.6;
    c.textAlign = "center";
    for (const [n, lon, lat] of STATES) {
      const p = project(lon, lat);
      c.fillText(n, X(p[0]), Y(p[1]));
    }
    c.globalAlpha = 1;
    c.font = "500 12px 'Barlow Semi Condensed',sans-serif";
    for (const [n, lon, lat, east] of CITIES) {
      const p = project(lon, lat);
      c.textAlign = east ? "left" : "right";
      c.fillText(n, X(p[0]) + (east ? 5 : -5), Y(p[1]) + 4);
    }
    c.textAlign = "left";
    if (view.scale > 900) drawLakeLabels(c, water, X, Y, view.scale, C.muted, view.keyBoxes());
    if (journal) drawJournal(c, journal, X, Y, [], C.ink, glow);
    // Dams, and the gauges with their readings once zoomed in.
    c.font = "600 12px 'Barlow Semi Condensed',sans-serif";
    for (const st of structures) {
      const [x, y] = [X(st.xy[0]), Y(st.xy[1])];
      c.lineWidth = 1.4;
      c.strokeStyle = C.bg;
      c.fillStyle = C.ink;
      c.beginPath();
      c.rect(x - 4.5, y - 4.5, 9, 9);
      c.fill();
      c.stroke();
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
  function offset(line: Polyline, d: number, off: number): XY {
    const a = pointAt(line, d);
    if (!off) return a;
    const b = pointAt(line, Math.min(line.len, d + 0.004));
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    const n = Math.hypot(dx, dy) || 1;
    return [a[0] - (dy / n) * off, a[1] + (dx / n) * off];
  }

  function step(dt: number) {
    for (const f of inflows) {
      f.acc += f.rate() * K * dt;
      while (f.acc >= 1) {
        f.acc -= 1;
        if (drops.length < MAX_DROPS) drops.push({ on: f.on, d: f.from + Math.random() * (f.to - f.from), side: (Math.random() - 0.5) * 2, off: 0, prev: null });
      }
    }
    for (let n = drops.length - 1; n >= 0; n--) {
      const p = drops[n];
      const wet = pooled(p.on, p.d);
      p.d += ((wet ? POOL_KMS : RIVER_KMS) / 111) * dt;
      if (p.d >= lines[p.on].len) {
        const to = next[p.on];
        if (!to) {
          drops.splice(n, 1);
          continue;
        }
        [p.on, p.d] = to;
        p.prev = null;
      }
      const want = wet ? POOL_SPREAD * p.side : 0;
      p.off += (want - p.off) * Math.min(1, dt * 0.5);
    }
  }

  const streaks = new StreakLayer();
  function draw() {
    const c = view.fctx;
    const { W, H } = view;
    const sc = view.scale;
    c.setTransform(view.DPR, 0, 0, view.DPR, 0, 0);
    fadeLayer(c, W, H, Math.min(0.55, Math.max(0.2, 0.2 * Math.sqrt(sc / 700))));
    const z = Math.min(2.4, Math.max(1, sc / 900));
    streaks.style(0, C.tannin, glow ? 0.5 : 0.85, z);
    streaks.begin();
    for (const p of drops) {
      const a = offset(lines[p.on], p.d, p.off);
      const [x, y] = [X(a[0]), Y(a[1])];
      const [px, py] = p.prev ? [X(p.prev[0]), Y(p.prev[1])] : [x - 0.8, y - 0.8];
      p.prev = a;
      if (x < -10 || y < -10 || x > W + 10 || y > H + 10) continue;
      streaks.add(0, px, py, x, y);
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
    for (const st of structures) test(st.xy, () => showDam(st));
    for (const g of gauges) test(g.xy, () => showGauge(g));
    if (best) return (best as () => void)();
    const m: XY = [(x - view.cam.tx) / view.cam.s, (y - view.cam.ty) / view.cam.s];
    if (probe.isPointInPath(oysterPath, m[0], m[1], "evenodd")) return card.show({ title: "Oyster beds", kind: "Apalachicola Bay", body: OYSTER_TEXT });
    const near = 14 / view.cam.s;
    const river = AP_RIVERS.map((n) => [n, nearestDistance(lines[n], ...m)] as const).filter(([, d]) => d < near).sort((a, b) => a[1] - b[1])[0];
    if (river) return card.show({ title: river[0], kind: "River", body: RIVER_TEXT[river[0]] });
    const bay = water.find((b) => b.kind === "sea");
    if (bay && m[1] > project(0, 30.0)[1] && probe.isPointInPath(ringsPath(bay.rings), m[0], m[1], "evenodd")) return card.show({ title: "Apalachicola Bay", kind: "Bay", body: `${OYSTER_TEXT} ${COURT_TEXT}` });
    card.hide();
  }

  function showDam(st: ApStructure) {
    card.show({ title: st.name, kind: `Dam · ${st.lake}`, body: DAM_TEXT(st.lake, st.built) });
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
        view.flyTo(g.xy, 3500);
        showGauge(g);
      });
      el.appendChild(b);
    }
  }

  const snapLabel = timeFmt(new Date(snapshot.time));
  function renderCopy(state: "checking" | "live" | "snapshot") {
    const chat = G("CHAT").cfs;
    document.getElementById("lede")!.innerHTML =
      "The Apalachicola carries more water than any other river in Florida, but it starts at a dam on the Georgia line, where the Chattahoochee and the Flint meet. " +
      "By then Atlanta has drawn its water from the Chattahoochee, and farms have irrigated from the Flint. " +
      `Florida sued Georgia over it and lost in ${FACTS.courtYear}. ` +
      (chat != null ? `Right now <b>${fmtCfs(chat)} cfs</b> is crossing into Florida below Jim Woodruff Dam. ` : "") +
      "Tap anything on the map.";
    const tail = "Flow is in cubic feet per second (cfs). Rivers and lakes: USGS NHD. Oyster beds: FWC. Coastline and state lines: US Census Bureau.";
    document.getElementById("status")!.textContent =
      state === "live" ? `Live USGS readings, updated ${timeFmt(liveTime!)}. ${tail}`
      : state === "checking" ? `USGS readings from ${snapLabel}. Checking for live readings… ${tail}`
      : `USGS readings from ${snapLabel}. Live readings didn't load, so this is a saved snapshot. ${tail}`;
  }

  // ---------- flow into Florida since 1923 ----------
  const hist = data.history;
  function renderHist() {
    const known = hist.years.map((y, i) => [y, hist.CHAT[i]] as const).filter((r): r is readonly [number, number] => r[1] != null);
    const lowest = [...known].sort((a, b) => a[1] - b[1]).slice(0, 3);
    const mean = known.reduce((a, r) => a + r[1], 0) / known.length;
    document.getElementById("histRead")!.innerHTML =
      `The river has averaged <b>${fmtCfs(mean)} cfs</b> at the Florida line since ${known[0][0]}. Its lowest years: ${lowest.map(([y, v]) => `<b>${y}</b> (${fmtCfs(v)} cfs)`).join(", ")}. ` +
      `The bay's oysters collapsed in ${FACTS.collapse}, after the droughts. ${COURT_TEXT}`;
    renderHistory(document.getElementById("histChart")!, hist.years, [{ name: "Apalachicola at Chattahoochee", color: "--chart-tannin", values: hist.CHAT }]);
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
  document.getElementById("bGeorgia")!.addEventListener("click", () => view.fit(VIEWS.georgia, true));
  document.getElementById("bLine")!.addEventListener("click", () => view.fit(VIEWS.line, true));
  document.getElementById("bBay")!.addEventListener("click", () => view.fit(VIEWS.bay, true));

  readColors();
  setFlows(current);
  renderProfile();
  renderCopy("checking");
  view.resize();
  view.fit(VIEWS.all);
  refill(90, 0.2);
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
