import "../shared/map.css";
import "../shared/nav";
import "../shared/story.css";
import "./stjohns.css";
import gaugeConfig from "../../config/gauges.json";
import { CreekLayer } from "../rain/creeks";
import { InfoCard } from "../shared/card";
import { loadData, showLoadError } from "../shared/data";
import { nearestDistance, pointAt, polyline, project, ringsPath, unpackRings, type Polyline, type XY } from "../shared/geo";
import { renderHistory, type Measure } from "../shared/history";
import { drawJournal, hitSighting, journalCardHtml, loadJournalOverlay, sightingCard, type JournalOverlay } from "../shared/journal-overlay";
import { decodeLakes, drawLakeLabels, drawLakes } from "../shared/lakes";
import { STALE_MS, fetchLatest, fmtCfs } from "../shared/live";
import { MAG_TEXT } from "../shared/magnitude";
import { StreakLayer, drawBoil, fadeLayer } from "../shared/streaks";
import { cssVar, fontsReady, isDark, onColorSchemeChange } from "../shared/theme";
import { SJ_KEYS, type GaugeConfig, type LakesFile, type SjFlows, type SjKey, type Snapshot, type StJohnsFile } from "../shared/types";
import { Viewport, startLoop } from "../shared/viewport";
import { FACTS, HEAD_TEXT, LAKE_GEORGE_TEXT, RIVER_TEXT, TIDE_TEXT, TOWNS, VIEWS } from "./content";

/** Drops spawned per cfs per second. */
const K = 0.02;
const MAX_DROPS = 8000;
/** The river's own visual speed north (km a second), and the tide's pull at the mouth, which fades to nothing by Lake George. */
const RIVER_KMS = 2.4;
const TIDE_KMS = 6;
const TIDE_S = 16;
const LABEL_SCALE = 1200;
/** The profile chart: feet above sea level by river mile. */
const PROFILE: Measure = { unit: "ft above sea level", format: (v) => (v == null ? "—" : v.toFixed(1)), year: "Mile", what: "the river's height above sea level by mile from the sea", xStep: 50 };

interface Gauge extends GaugeConfig {
  key: SjKey;
  cfs: number | null;
  xy: XY;
}

interface Drop {
  d: number;
  prev: XY | null;
}

const timeFmt = (d: Date) => d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

async function main() {
  const [data, snapshot] = await Promise.all([loadData<StJohnsFile>("stjohns.json"), loadData<Snapshot>("snapshot.json"), fontsReady()]);
  const { coordOrigin, coordScale } = data.meta;
  const water = decodeLakes({ meta: data.meta, bodies: data.water } as LakesFile);
  const river: Polyline = polyline(unpackRings([data.river.p], coordOrigin, coordScale)[0]);
  const riverPath = new Path2D();
  river.pts.forEach((q, i) => (i ? riverPath.lineTo(q[0], q[1]) : riverPath.moveTo(q[0], q[1])));
  /** Miles from the sea at a distance down the path (map units): the path's length is the river's miles in the view. */
  const milesToSea = (d: number) => ((river.len - d) / river.len) * data.river.miles;
  const springs = data.springs.map(([id, name, lon, lat, mag], i) => ({ id, name, lon, lat, mag, xy: project(lon, lat), phase: (i * 0.618) % 1 }));
  const along = (xy: XY) => {
    let best = 0;
    let bd = Infinity;
    river.pts.forEach((q, i) => {
      const d = (q[0] - xy[0]) ** 2 + (q[1] - xy[1]) ** 2;
      if (d < bd) {
        bd = d;
        best = river.cum[i];
      }
    });
    return best;
  };

  // ---------- gauges, and where the river gains ----------
  const gauges: Gauge[] = (gaugeConfig as GaugeConfig[])
    .filter((g): g is GaugeConfig & { key: SjKey } => g.page === "stjohns")
    .map((g) => ({ ...g, cfs: null, xy: project(g.lon, g.lat) }));
  const G = (k: SjKey) => gauges.find((g) => g.key === k)!;
  const q = (k: SjKey) => G(k).cfs ?? 0;
  // Water spawns where each gauge says the river gained on the one above it; the tidal gauges' flows swing too far to use.
  const steady: SjKey[] = ["SJMEL", "SJCOC", "SJCHR", "SJGEN", "SJSAN", "SJDEL", "SJAST"];
  const stretches = steady.map((k, i) => ({
    from: i ? along(G(steady[i - 1]).xy) : 0,
    to: along(G(k).xy),
    rate: () => Math.max(0, q(k) - (i ? q(steady[i - 1]) : 0)),
    acc: Math.random(),
  }));

  const current = Object.fromEntries(SJ_KEYS.map((k) => [k, snapshot.cfs[k] ?? null])) as SjFlows;
  const liveMeta = new Map<string, { time: Date; stale: boolean }>();
  let liveTime: Date | null = null;
  const setFlows = (f: SjFlows) => {
    for (const g of gauges) g.cfs = f[g.key];
  };

  // ---------- map ----------
  let C: Record<string, string> = {};
  let glow = true;
  const readColors = () => {
    C = Object.fromEntries(["bg", "ink", "muted", "tannin", "spring", "atl", "sea", "lake", "shore", "marsh", "stream"].map((n) => [n, cssVar(`--${n}`)]));
    glow = isDark();
  };
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
    creeks.update([-tx / s, -ty / s, (W - tx) / s, (H - ty) / s], s);
    c.strokeStyle = C.stream;
    c.globalAlpha = 0.7;
    creeks.draw(c, s);
    c.globalAlpha = 1;
    c.lineCap = "round";
    c.lineJoin = "round";
    c.strokeStyle = C.tannin;
    c.lineWidth = 2.6 / s;
    c.stroke(riverPath);
    c.restore();

    c.font = "500 12px 'Barlow Semi Condensed',sans-serif";
    c.fillStyle = C.muted;
    for (const [n, lon, lat, east] of TOWNS) {
      const p = project(lon, lat);
      c.textAlign = east ? "left" : "right";
      c.fillText(n, X(p[0]) + (east ? 5 : -5), Y(p[1]) + 4);
    }
    c.textAlign = "left";
    if (view.scale > 700) drawLakeLabels(c, water, X, Y, view.scale, C.muted);
    // How far the tide reaches, and the springs that feed the river.
    const tideAt = pointAt(river, river.len * (1 - FACTS.tideMiles / data.river.miles));
    const [tx0, ty0] = [X(tideAt[0]), Y(tideAt[1])];
    c.strokeStyle = C.atl;
    c.lineWidth = 1.4;
    c.setLineDash([4, 3]);
    c.beginPath();
    c.moveTo(tx0 - 14, ty0);
    c.lineTo(tx0 + 14, ty0);
    c.stroke();
    c.setLineDash([]);
    c.font = "italic 400 12.5px 'Spectral',serif";
    c.fillStyle = C.atl;
    c.fillText("the tide reaches this far", tx0 + 18, ty0 + 4);
    c.fillStyle = C.spring;
    for (const sp of springs) {
      if (sp.mag === 1) continue;
      c.beginPath();
      c.arc(X(sp.xy[0]), Y(sp.xy[1]), 2.6, 0, 7);
      c.fill();
    }
    if (journal) drawJournal(c, journal, X, Y, springs, C.ink, glow);
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
  let tideT = 0;
  /** The tide's pull (km a second, toward the head when positive) at a distance down the river. */
  const tidePull = (d: number) => {
    const m = milesToSea(d);
    if (m >= FACTS.tideMiles) return 0;
    const reach = (1 - m / FACTS.tideMiles) ** 2;
    return TIDE_KMS * reach * Math.sin((2 * Math.PI * tideT) / TIDE_S - m * 0.03);
  };
  function step(dt: number) {
    tideT += dt;
    for (const f of stretches) {
      f.acc += f.rate() * K * dt;
      while (f.acc >= 1) {
        f.acc -= 1;
        if (drops.length < MAX_DROPS) drops.push({ d: f.from + Math.random() * (f.to - f.from), prev: null });
      }
    }
    for (let n = drops.length - 1; n >= 0; n--) {
      const p = drops[n];
      p.d = Math.max(0, p.d + ((RIVER_KMS - tidePull(p.d)) / 111) * dt);
      if (p.d >= river.len) drops.splice(n, 1);
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
    // Water the tide is pushing back upstream shows in the tide's color.
    streaks.style(0, C.tannin, glow ? 0.5 : 0.85, z);
    streaks.style(1, C.atl, glow ? 0.5 : 0.85, z);
    streaks.begin();
    for (const p of drops) {
      const a = pointAt(river, p.d);
      const [x, y] = [X(a[0]), Y(a[1])];
      const [px, py] = p.prev ? [X(p.prev[0]), Y(p.prev[1])] : [x - 0.8, y - 0.8];
      p.prev = a;
      if (x < -10 || y < -10 || x > W + 10 || y > H + 10) continue;
      streaks.add(tidePull(p.d) > RIVER_KMS ? 1 : 0, px, py, x, y);
    }
    streaks.flush(c, glow);
    const now = performance.now() / 1000;
    for (const sp of springs) {
      if (sp.mag !== 1) continue;
      drawBoil(c, X(sp.xy[0]), Y(sp.xy[1]), 3.6 * Math.min(2, Math.max(1, Math.sqrt(sc / 700))), sp.phase, now, C.spring);
    }
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
    let bd = 16 * 16;
    const test = (xy: XY, f: () => void) => {
      const d = (X(xy[0]) - x) ** 2 + (Y(xy[1]) - y) ** 2;
      if (d < bd) {
        bd = d;
        best = f;
      }
    };
    for (const g of gauges) test(g.xy, () => showGauge(g));
    for (const sp of springs) test(sp.xy, () => card.show({ title: sp.name, kind: "Spring", body: `${MAG_TEXT[sp.mag] ?? ""}It feeds the St. Johns.${journal ? ` ${journalCardHtml(journal, sp.id)}` : ""}` }));
    if (best) return (best as () => void)();
    const m: XY = [(x - view.cam.tx) / view.cam.s, (y - view.cam.ty) / view.cam.s];
    const lake = water.find((b) => b.kind === "lake" && b.name === "Lake George" && probe.isPointInPath(ringsPath(b.rings), m[0], m[1], "evenodd"));
    if (lake) return card.show({ title: "Lake George", kind: "Lake", body: LAKE_GEORGE_TEXT });
    if (nearestDistance(river, ...m) < 14 / view.cam.s) {
      const mi = milesToSea(along(m));
      const extra = mi < FACTS.tideMiles ? TIDE_TEXT : mi > data.river.miles - 30 ? HEAD_TEXT : "";
      return card.show({ title: "St. Johns River", kind: `About ${Math.round(mi)} miles from the sea`, body: `${RIVER_TEXT} ${extra}`.trim() });
    }
    card.hide();
  }

  function showGauge(g: Gauge) {
    const meta = liveMeta.get(g.key);
    const when = meta ? `, ${timeFmt(meta.time)}` : "";
    let body = g.cfs == null ? "No recent reading at this gauge." : `<b>${fmtCfs(Math.abs(g.cfs))} cfs</b>${when}${g.signed && g.cfs < 0 ? ", running upstream: the tide is pushing the river back" : ""}.`;
    if (g.signed) body += ` ${TIDE_TEXT}`;
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
      n.textContent = g.signed && g.cfs != null && g.cfs < 0 ? `${g.short}, upstream` : g.short;
      b.append(v, n);
      b.addEventListener("click", () => {
        view.flyTo(g.xy, 5000);
        showGauge(g);
      });
      el.appendChild(b);
    }
  }

  const snapLabel = timeFmt(new Date(snapshot.time));
  function renderCopy(state: "checking" | "live" | "snapshot") {
    const del = G("SJDEL").cfs;
    const buf = G("SJBUF").cfs;
    const upstream = buf != null && buf < 0;
    document.getElementById("lede")!.innerHTML =
      `The St. Johns runs north for <b>${FACTS.miles} miles</b> and falls less than <b>${FACTS.fallFt} feet</b>, about an inch a mile. ` +
      `Most of that fall comes early, out of the marshes; below Lake Monroe it's within about three feet of sea level, and the tide reaches ${FACTS.tideMiles} miles upstream, to Lake George. ` +
      (del != null ? `Right now <b>${fmtCfs(del)} cfs</b> passes DeLand` : "") +
      (buf != null ? `${del != null ? ", and" : "Right now"} at Buffalo Bluff the river is running ${upstream ? `<b>upstream</b>, ${fmtCfs(Math.abs(buf))} cfs pushed back by the tide` : `downstream at ${fmtCfs(buf)} cfs`}. ` : del != null ? ". " : "") +
      "Tap anything on the map.";
    const tail = "Flow is in cubic feet per second (cfs); at the tidal gauges it swings both ways. River, lakes, and elevations: USGS NHD.";
    document.getElementById("status")!.textContent =
      state === "live" ? `Live USGS readings, updated ${timeFmt(liveTime!)}. ${tail}`
      : state === "checking" ? `USGS readings from ${snapLabel}. Checking for live readings… ${tail}`
      : `USGS readings from ${snapLabel}. Live readings didn't load, so this is a saved snapshot. ${tail}`;
  }

  // ---------- the river's fall ----------
  function renderHist() {
    const miles = data.profile.map(([m]) => m);
    const feet = data.profile.map(([, f]) => f);
    const top = data.profile[0];
    const monroe = data.profile.find(([, f]) => f <= 3);
    document.getElementById("histRead")!.innerHTML =
      `On NHD's smoothed elevations the river starts about <b>${top[1].toFixed(0)} feet</b> above sea level where its name begins, ${top[0]} miles from the sea (its marshes rise a little higher upstream). ` +
      (monroe ? `By mile ${monroe[0]} it's within three feet of the sea, and it stays there the rest of the way: that's why the tide can push it back so far.` : "");
    renderHistory(document.getElementById("histChart")!, miles, [{ name: "The St. Johns' water surface", color: "--chart-tannin", values: feet }], PROFILE);
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
  document.getElementById("bUpper")!.addEventListener("click", () => view.fit(VIEWS.upper, true));
  document.getElementById("bMiddle")!.addEventListener("click", () => view.fit(VIEWS.middle, true));
  document.getElementById("bLower")!.addEventListener("click", () => view.fit(VIEWS.lower, true));

  readColors();
  setFlows(current);
  renderProfile();
  renderCopy("checking");
  view.resize();
  view.fit(VIEWS.all);
  refill(80, 0.1);
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
