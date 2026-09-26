import "../shared/map.css";
import "../shared/nav";
import "../shared/story.css";
import "./kissimmee.css";
import gaugeConfig from "../../config/gauges.json";
import { CreekLayer } from "../rain/creeks";
import { InfoCard } from "../shared/card";
import { loadData, showLoadError } from "../shared/data";
import { locate, nearestDistance, pointAt, polyline, project, ringsPath, unpackRings, type Polyline, type XY } from "../shared/geo";
import { renderHistory } from "../shared/history";
import { drawJournal, hitSighting, loadJournalOverlay, sightingCard, type JournalOverlay } from "../shared/journal-overlay";
import { decodeLakes, drawLakeLabels, drawLakes } from "../shared/lakes";
import { STALE_MS, fetchCwms, fmtCfs } from "../shared/live";
import { StreakLayer, fadeLayer } from "../shared/streaks";
import { cssVar, fontsReady, isDark, onColorSchemeChange } from "../shared/theme";
import { KISS_CLASSES, KISS_KEYS, type GaugeConfig, type KissClass, type KissFlows, type KissKey, type KissStructure, type KissimmeeFile, type LakesFile, type Snapshot } from "../shared/types";
import { Viewport, startLoop } from "../shared/viewport";
import { glintAlpha, placeGlints } from "../springs/glints";
import { CLASS_TEXT, FLOODPLAIN_TEXT, HISTORY, ISTOKPOGA_TEXT, OLD_CHANNEL_TEXT, STRUCTURE_TEXT, TOWNS, VIEWS } from "./content";

/** Drops spawned per cfs per second. */
const K = 0.022;
const MAX_DROPS = 6000;
/** Visual speed by what the river is there (km a second): fast down the canal, slow through the bends, slower still spreading over the floodplain. */
const KMS: Record<KissClass, number> = { canal: 3.2, river: 1.3, filled: 0.9 };
/** How far drops spread off the line (map units): a little in the river's bends, far across the floodplain where the canal was filled. */
const SPREAD: Record<KissClass, number> = { canal: 0, river: 0.0012, filled: 0.012 };
/** Readings are drawn on the map only at this zoom (pixels per map unit) or closer. */
const LABEL_SCALE = 1200;
/** The floodplain glints this many times as densely as the springs map's wetlands. */
const GLINT_DENSITY = 4;

interface Gauge extends GaugeConfig {
  key: KissKey;
  cfs: number | null;
  xy: XY;
}

interface Drop {
  line: Polyline;
  /** The river's classes per vertex, or null on C-41A (all canal). */
  cls: number[] | null;
  d: number;
  /** Which side it spreads to, and how far (0 to 1 of the reach's spread). */
  side: number;
  /** Its spread right now, eased toward the reach's, so drops drift out and back. */
  off: number;
  prev: XY | null;
}

const timeFmt = (d: Date) => d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

async function main() {
  const [data, snapshot] = await Promise.all([loadData<KissimmeeFile>("kissimmee.json"), loadData<Snapshot>("snapshot.json"), fontsReady()]);
  const { coordOrigin, coordScale } = data.meta;
  const unpackLine = (flat: number[]): XY[] => unpackRings([flat], coordOrigin, coordScale)[0];
  const water = decodeLakes({ meta: data.meta, bodies: data.water } as LakesFile);
  const floodRings = unpackRings(data.floodplain, coordOrigin, coordScale);
  const floodPath = ringsPath(floodRings);
  const glints = placeGlints([{ km2: data.floodplainKm2 * GLINT_DENSITY, rings: floodRings }]);
  const river = polyline(unpackLine(data.river.p));
  const cls = data.river.c;
  const clsAt = (d: number) => cls[locate(river, d).lo];
  const istokpoga = polyline(unpackLine(data.istokpoga));
  const filled = data.filled.map(unpackLine);
  const oldChannel = data.oldChannel.map(unpackLine);
  const linePath = (lines: XY[][]) => {
    const p = new Path2D();
    for (const l of lines) l.forEach((q, i) => (i ? p.lineTo(q[0], q[1]) : p.moveTo(q[0], q[1])));
    return p;
  };
  const filledPath = linePath(filled);
  const istokpogaPath = linePath([istokpoga.pts]);
  const oldPath = linePath(oldChannel);
  // The river as one path per class, built once in map units: the base redraws on every pan and zoom frame.
  const classPaths = KISS_CLASSES.map(() => new Path2D());
  for (let i = 0; i < river.pts.length - 1; i++) {
    const p = classPaths[cls[i]];
    p.moveTo(...river.pts[i]);
    p.lineTo(...river.pts[i + 1]);
  }
  const structures = data.structures.map((s) => ({ ...s, xy: project(s.lon, s.lat) }));

  // ---------- gauges ----------
  const gauges: Gauge[] = (gaugeConfig as GaugeConfig[])
    .filter((g): g is GaugeConfig & { key: KissKey } => g.page === "kissimmee")
    .map((g) => ({ ...g, cfs: null, xy: project(g.lon, g.lat) }));
  const G = (k: KissKey) => gauges.find((g) => g.key === k)!;
  const current = Object.fromEntries(KISS_KEYS.map((k) => [k, snapshot.cfs[k] ?? null])) as KissFlows;
  const liveMeta = new Map<string, { time: Date; stale: boolean }>();
  let liveTime: Date | null = null;
  const setFlows = (f: KissFlows) => {
    for (const g of gauges) g.cfs = f[g.key];
  };

  // ---------- map ----------
  let C: Record<string, string> = {};
  let glow = true;
  const readColors = () => {
    C = Object.fromEntries(["bg", "ink", "muted", "tannin", "sea", "lake", "shore", "marsh", "stream", "glint", "line", "spring"].map((n) => [n, cssVar(`--${n}`)]));
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
    // The floodplain: the marsh the river spills over.
    c.fillStyle = C.marsh;
    c.globalAlpha = 0.75;
    c.fill(floodPath, "evenodd");
    c.globalAlpha = 1;
    creeks.update([-tx / s, -ty / s, (W - tx) / s, (H - ty) / s], s);
    c.strokeStyle = C.stream;
    c.globalAlpha = 0.7;
    creeks.draw(c, s);
    c.globalAlpha = 1;
    c.lineCap = "round";
    c.lineJoin = "round";
    // The old channel, the filled canal's ghost, then the river: canal, bends, filled stretch.
    c.strokeStyle = C.stream;
    c.lineWidth = 1.6 / s;
    c.stroke(oldPath);
    c.strokeStyle = C.muted;
    c.lineWidth = 1.2 / s;
    c.setLineDash([5 / s, 4 / s]);
    c.stroke(filledPath);
    c.stroke(classPaths[2]);
    c.setLineDash([]);
    c.strokeStyle = C.muted;
    c.lineWidth = 3.2 / s;
    c.lineCap = "butt";
    c.stroke(classPaths[0]);
    // C-41A is a side canal: quieter than the river's.
    c.lineWidth = 1.5 / s;
    c.globalAlpha = 0.7;
    c.stroke(istokpogaPath);
    c.globalAlpha = 1;
    c.lineCap = "round";
    c.strokeStyle = C.tannin;
    c.lineWidth = 2.4 / s;
    c.stroke(classPaths[1]);
    c.restore();

    c.font = "500 12px 'Barlow Semi Condensed',sans-serif";
    c.fillStyle = C.muted;
    for (const [n, lon, lat, east] of TOWNS) {
      const p = project(lon, lat);
      c.textAlign = east ? "left" : "right";
      c.fillText(n, X(p[0]) + (east ? 5 : -5), Y(p[1]) + 4);
    }
    c.textAlign = "left";
    // Lakes are named once zoomed in: the river is the story, and on a phone the names crowd the legend.
    if (view.scale > 1600) drawLakeLabels(c, water, X, Y, view.scale, C.muted, view.keyBoxes());
    if (journal) drawJournal(c, journal, X, Y, [], C.ink, glow);

    // Structures: squares; the removed ones hollow and crossed out.
    c.font = "600 12px 'Barlow Semi Condensed',sans-serif";
    for (const st of structures) {
      const [x, y] = [X(st.xy[0]), Y(st.xy[1])];
      c.lineWidth = 1.4;
      c.strokeStyle = st.role === "removed" ? C.muted : C.ink;
      c.fillStyle = C.bg;
      c.beginPath();
      c.rect(x - 4, y - 4, 8, 8);
      c.fill();
      c.stroke();
      if (st.role === "removed") {
        c.beginPath();
        c.moveTo(x - 4, y - 4);
        c.lineTo(x + 4, y + 4);
        c.moveTo(x + 4, y - 4);
        c.lineTo(x - 4, y + 4);
        c.stroke();
      }
      c.fillStyle = st.role === "removed" ? C.muted : C.ink;
      const g = gauges.find((q) => q.id === st.name.replace("-", ""));
      const reading = g && g.cfs != null && view.scale >= LABEL_SCALE ? ` · ${fmtCfs(g.cfs)} cfs` : "";
      c.fillText(`${st.name}${reading}`, x + 8, y + 4);
    }
  }

  // ---------- drops ----------
  const drops: Drop[] = [];
  const acc = { river: Math.random(), ist: Math.random() };
  const speedAt = (p: Drop) => KMS[p.cls ? KISS_CLASSES[clsAt(p.d)] : "canal"] / 111;
  /** A point off the line by `off`, perpendicular to it. */
  function offset(line: Polyline, d: number, off: number): XY {
    const a = pointAt(line, d);
    if (!off) return a;
    const b = pointAt(line, Math.min(line.len, d + 0.002));
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    const n = Math.hypot(dx, dy) || 1;
    return [a[0] - (dy / n) * off, a[1] + (dx / n) * off];
  }

  function step(dt: number) {
    const emit = (key: keyof typeof acc, perSecond: number, f: () => void) => {
      acc[key] += perSecond * dt;
      while (acc[key] >= 1) {
        acc[key] -= 1;
        if (drops.length < MAX_DROPS) f();
      }
    };
    const s65e = G("S65E").cfs;
    const s68 = G("S68").cfs;
    if (s65e && s65e > 0) emit("river", s65e * K, () => drops.push({ line: river, cls, d: 0, side: (Math.random() - 0.5) * 2, off: 0, prev: null }));
    if (s68 && s68 > 0) emit("ist", s68 * K, () => drops.push({ line: istokpoga, cls: null, d: 0, side: 0, off: 0, prev: null }));
    for (let n = drops.length - 1; n >= 0; n--) {
      const p = drops[n];
      p.d += speedAt(p) * dt;
      if (p.d >= p.line.len) {
        drops.splice(n, 1);
        continue;
      }
      // Ease the spread toward this reach's, so water drifts out over the floodplain and back.
      const want = p.cls ? SPREAD[KISS_CLASSES[clsAt(p.d)]] * p.side : 0;
      p.off += (want - p.off) * Math.min(1, dt * 0.5);
    }
  }

  const streaks = new StreakLayer();
  function draw() {
    const c = view.fctx;
    const { W, H } = view;
    const sc = view.scale;
    c.setTransform(view.DPR, 0, 0, view.DPR, 0, 0);
    fadeLayer(c, W, H, Math.min(0.55, Math.max(0.2, 0.2 * Math.sqrt(sc / 1000))));
    const now = performance.now() / 1000;
    // Floodplain glints: sun on the water in the marsh.
    const size = Math.min(2.4, Math.max(1.1, Math.sqrt(sc / 700)));
    const lit = new Path2D();
    for (const g of glints) {
      const a = glintAlpha(g, now);
      if (a < 0.5) continue;
      const x = X(g.xy[0]);
      const y = Y(g.xy[1]);
      if (x < -4 || y < -4 || x > W + 4 || y > H + 4) continue;
      lit.rect(x - size / 2, y - size / 2, size, size);
    }
    c.fillStyle = C.glint;
    c.globalAlpha = 0.8;
    c.fill(lit);
    c.globalAlpha = 1;
    const z = Math.min(2.4, Math.max(1, sc / 1500));
    streaks.style(0, C.tannin, glow ? 0.5 : 0.85, z);
    streaks.begin();
    for (const p of drops) {
      const at = offset(p.line, p.d, p.off);
      const [x, y] = [X(at[0]), Y(at[1])];
      const [px, py] = p.prev ? [X(p.prev[0]), Y(p.prev[1])] : [x - 0.8, y - 0.8];
      p.prev = at;
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
    for (const st of structures) test(st.xy, () => showStructure(st));
    if (best) return (best as () => void)();
    const m: XY = [(x - view.cam.tx) / view.cam.s, (y - view.cam.ty) / view.cam.s];
    const near = 14 / view.cam.s;
    if (nearestDistance(river, ...m) < near) {
      const d = nearestAlong(river, m);
      const k = KISS_CLASSES[clsAt(d)];
      return card.show({ title: CLASS_TEXT[k].title, kind: "Kissimmee River", body: CLASS_TEXT[k].body });
    }
    if (nearestDistance(istokpoga, ...m) < near) return card.show({ title: "Canal C-41A", kind: "Canal", body: ISTOKPOGA_TEXT });
    if (oldChannel.some((l) => nearestDistance(polyline(l), ...m) < near)) return card.show({ title: "The old channel", kind: "Kissimmee River", body: OLD_CHANNEL_TEXT });
    if (probe.isPointInPath(floodPath, m[0], m[1], "evenodd")) return card.show({ title: "The floodplain", kind: "Marsh", body: FLOODPLAIN_TEXT });
    card.hide();
  }
  /** Distance along a line to the vertex nearest a point. */
  function nearestAlong(line: Polyline, m: XY): number {
    let best = 0;
    let bd = Infinity;
    line.pts.forEach((q, i) => {
      const d = (q[0] - m[0]) ** 2 + (q[1] - m[1]) ** 2;
      if (d < bd) {
        bd = d;
        best = line.cum[i];
      }
    });
    return best;
  }

  function showStructure(st: KissStructure) {
    const g = gauges.find((q) => q.id === st.name.replace("-", ""));
    let body = STRUCTURE_TEXT[st.role];
    if (g) {
      const meta = liveMeta.get(g.key);
      const when = meta ? `, ${timeFmt(meta.time)}` : "";
      body = g.cfs == null ? `No recent reading. ${body}` : `<b>${fmtCfs(g.cfs)} cfs</b>${when}. ${body}`;
      if (meta?.stale) body += " This reading is old.";
    }
    card.show({ title: st.name, kind: st.role === "removed" ? "Removed structure" : "Water control structure", body });
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
        view.flyTo(g.xy, 9000);
        const st = structures.find((s) => s.name.replace("-", "") === g.id);
        if (st) showStructure(st);
      });
      el.appendChild(b);
    }
  }

  const snapLabel = timeFmt(new Date(snapshot.time));
  function renderCopy(state: "checking" | "live" | "snapshot") {
    const into = G("S65E").cfs;
    document.getElementById("lede")!.innerHTML =
      `The Kissimmee used to wind <b>${HISTORY.milesBefore} miles</b> from Lake Kissimmee to Lake Okeechobee, spilling over a wide marsh for months each year. ` +
      `From ${HISTORY.dug[0]} to ${HISTORY.dug[1]} it was dug into C-38, a canal <b>${HISTORY.canalMiles} miles</b> long, and the marsh dried out. ` +
      `Filling ${HISTORY.filledMiles} miles of the canal, finished in ${HISTORY.done}, gave the river <b>${HISTORY.channelMiles} miles</b> of its bends back. ` +
      (into != null ? `Right now <b>${fmtCfs(into)} cfs</b> is reaching Lake Okeechobee. ` : "") +
      "Tap anything on the map.";
    const tail = "Flow is in cubic feet per second (cfs), from SFWMD's structures through the Corps of Engineers' CWMS.";
    const credits = "River and floodplain: USGS NHD. Filled canal: OpenStreetMap contributors.";
    document.getElementById("status")!.textContent =
      state === "live" ? `Live readings, updated ${timeFmt(liveTime!)}. ${tail} ${credits}`
      : state === "checking" ? `Readings from ${snapLabel}. Checking for live readings… ${tail} ${credits}`
      : `Readings from ${snapLabel}. Live readings didn't load, so this is a saved snapshot. ${tail} ${credits}`;
  }

  // ---------- flow since 1929 ----------
  const hist = data.history;
  function renderHist() {
    const known = hist.years.map((y, i) => [y, hist.S65E[i]] as const).filter((r): r is readonly [number, number] => r[1] != null);
    const wettest = known.reduce((a, b) => (b[1] > a[1] ? b : a));
    const driest = known.reduce((a, b) => (b[1] < a[1] ? b : a));
    document.getElementById("histRead")!.innerHTML =
      `How much comes down swings with the rain, from <b>${fmtCfs(driest[1])} cfs</b> in ${driest[0]} to <b>${fmtCfs(wettest[1])} cfs</b> in ${wettest[0]}. ` +
      "The canal didn't change how much rain the basin gets. It changed where the water went: straight to the lake, instead of spreading across the marsh for months on the way.";
    renderHistory(document.getElementById("histChart")!, hist.years, [{ name: "Kissimmee River at S-65E", color: "--chart-tannin", values: hist.S65E }]);
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
    const flows = await fetchCwms(gauges.filter((g) => g.ts).map((g) => ({ id: g.id, ts: g.ts! })));
    let latest: Date | null = null;
    for (const g of gauges) {
      const r = flows.get(g.id);
      if (!r) continue;
      current[g.key] = r.cfs;
      liveMeta.set(g.key, { time: r.time, stale: Date.now() - r.time.getTime() > STALE_MS });
      if (!latest || r.time > latest) latest = r.time;
    }
    if (!latest) throw new Error("CWMS returned no readings");
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
  document.getElementById("bRestored")!.addEventListener("click", () => view.fit(VIEWS.restored, true));
  document.getElementById("bLower")!.addEventListener("click", () => view.fit(VIEWS.lower, true));

  readColors();
  setFlows(current);
  renderProfile();
  renderCopy("checking");
  view.resize();
  view.fit(VIEWS.all);
  refill(40, 0.1);
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
    console.warn("Live CWMS readings unavailable; using snapshot.", err);
    renderCopy("snapshot");
  });
}

main().catch(showLoadError);
