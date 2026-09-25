import "../shared/map.css";
import "../shared/nav";
import "../shared/story.css";
import "./st-lucie.css";
import gaugeConfig from "../../config/gauges.json";
import salinityConfig from "../../config/salinity.json";
import { InfoCard } from "../shared/card";
import { loadData, showLoadError } from "../shared/data";
import { KM_PER_UNIT, nearestDistance, pointAt, polyline, project, ringsPath, type Polyline, type XY } from "../shared/geo";
import { renderHistory } from "../shared/history";
import { drawJournal, hitSighting, loadJournalOverlay, sightingCard, type JournalOverlay } from "../shared/journal-overlay";
import { decodeLakes, drawLakeLabels, drawLakes } from "../shared/lakes";
import { STALE_MS, fetchLatest, fetchSalinity, fmtCfs } from "../shared/live";
import { StreakLayer, fadeLayer } from "../shared/streaks";
import { cssVar, fontsReady, isDark, onColorSchemeChange } from "../shared/theme";
import type { GaugeConfig, LakesFile, Salinity, SalinityStation, Snapshot, StLucieFile, StLucieFlows, StLucieKey } from "../shared/types";
import { Viewport, startLoop } from "../shared/viewport";
import { C23_TEXT, ESTUARY_TEXT, INLET, LAGOON_TEXT, LAKE, NORTH_FORK_TEXT, SALINITY_NOTE, SOUTH_FORK_TEXT, TOWNS, VIEWS, canalText, type Place } from "./content";
import { MODERN, SEAWATER, canalModel, mgd, reach, saltProfile, stationSalinity, summarize, type CanalModel, type Knot } from "./flow";

/** Drops spawned per cfs per second. */
const K = 0.035;
const MAX_DROPS = 20000;
/** Seawater drops sent up the estuary per second. The tide isn't gauged, so this is just enough to draw the salt. */
const SEA_RATE = 20;
/** Readings are drawn on the map only at this zoom (pixels per map unit) or closer. */
const LABEL_SCALE = 900;
/** A drop fades in over this much of the lake before Port Mayaca, and out past the inlet (map units, ~3 km). */
const FADE = 0.03;
/** Where drops leaving the inlet head out to sea. */
const OFFSHORE: [number, number] = [-80.115, 27.16];
/** How close (in map units, ~1 km) a station must sit to a salt path to shape its profile. */
const ON_PATH = 0.01;
/** Where each reading sits relative to its marker: [dx, dy, align]. */
const LABEL_AT: Record<string, [number, number, CanvasTextAlign]> = {
  S308: [8, 16, "left"],
  S80: [8, 4, "left"],
  SP: [-9, -7, "right"],
  SS: [9, 14, "left"],
};

type Line = Polyline & { name: string };
type Color = "l" | "b" | "s";

interface Drop {
  /** Distance along MAIN (fresh water) or along a salt path (seawater). */
  d: number;
  col: Color;
  off: number;
  /** -1: canal water running back to the lake. */
  dir: 1 | -1;
  /** Seawater only: its path, and how far up it gets before the tide turns it back. */
  salt?: SaltPath;
  turn?: number;
  back?: boolean;
}

interface SaltPath extends Polyline {
  /** Distance of the inlet along the path (the path starts offshore). */
  inlet: number;
  knots: Knot[];
}

interface Gauge extends GaugeConfig {
  key: StLucieKey;
  cfs: number | null;
  xy: XY;
}

interface Station extends SalinityStation {
  ppt: Salinity;
  xy: XY;
}

const timeFmt = (d: Date) => d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const fmtPpt = (n: number | null | undefined) => (n == null ? "—" : n.toFixed(n < 10 ? 1 : 0));
const reversed = (pts: XY[]) => [...pts].reverse();

async function main() {
  const [data, snapshot] = await Promise.all([loadData<StLucieFile>("st-lucie.json"), loadData<Snapshot>("snapshot.json"), fontsReady()]);
  const water = decodeLakes({ meta: data.meta, bodies: data.water } as LakesFile);

  // ---------- geometry ----------
  const pts = (name: string): XY[] => data.rivers[name].p.map(([x, y]) => project(x, y));
  const line = (name: string): Line => ({ ...polyline(pts(name)), name });
  const CANAL = line("Saint Lucie Canal");
  const SF = line("South Fork Saint Lucie River");
  const NF = line("North Fork Saint Lucie River");
  const EST = line("Saint Lucie River");
  const C23 = line("County Line Canal");
  const IRL = line("Indian River");
  const offshore = project(...OFFSHORE);
  const between = (l: Polyline, d0: number, d1: number): XY[] => [pointAt(l, d0), ...l.pts.filter((_, i) => l.cum[i] > d0 && l.cum[i] < d1), pointAt(l, d1)];
  // Fresh water's route: out of the lake, down the canal, into the South Fork where the
  // canal joins it, through the estuary, and out the inlet to sea.
  const joinSF = nearestDistance(SF, ...CANAL.pts[CANAL.pts.length - 1]);
  const MAIN = polyline([...CANAL.pts, ...between(SF, joinSF, SF.len).slice(1), ...EST.pts.slice(1), offshore]);

  const gauges: Gauge[] = (gaugeConfig as GaugeConfig[])
    .filter((g): g is GaugeConfig & { key: StLucieKey } => g.page === "st-lucie")
    .map((g) => ({ ...g, cfs: null, xy: project(g.lon, g.lat) }));
  const G = (key: StLucieKey) => gauges.find((g) => g.key === key)!;
  const stations: Station[] = (salinityConfig as SalinityStation[]).map((s) => ({ ...s, ppt: snapshot.ppt?.[s.key] ?? { top: null, bottom: null }, xy: project(s.lon, s.lat) }));

  const d308 = nearestDistance(MAIN, ...G("S308").xy);
  const d80 = nearestDistance(MAIN, ...G("S80").xy);
  const dInlet = nearestDistance(MAIN, ...project(INLET.lon, INLET.lat));
  /** Where the South Fork meets the North Fork and the estuary begins. */
  const dEstuary = nearestDistance(MAIN, ...EST.pts[0]);
  const canalMiles = Math.round((d80 - d308) * KM_PER_UNIT * 0.621);
  // NHD carries the canal's path on across Lake Okeechobee; draw it from the shore.
  const canalDrawn = between(CANAL, nearestDistance(CANAL, ...G("S308").xy), CANAL.len);

  // Seawater's routes in: from offshore through the inlet, up the estuary, then up either fork.
  const salt = (p: XY[]): SaltPath => {
    const l = polyline(p);
    return { ...l, inlet: nearestDistance(l, ...project(INLET.lon, INLET.lat)), knots: [] };
  };
  // Salt reaches up the North Fork only as far as its tidal water: stop at the first vertex,
  // going upstream from its mouth, that's outside the sea polygon. The South Fork's limit
  // is the lock.
  const probe = document.createElement("canvas").getContext("2d")!;
  const tidal = ringsPath(water.filter((b) => b.kind === "sea").flatMap((b) => b.rings));
  const upNF = reversed(NF.pts);
  const nfTide = upNF.findIndex((q, i) => i > 0 && !probe.isPointInPath(tidal, q[0], q[1], "evenodd"));
  const SALT_S = salt(reversed(between(MAIN, d80, MAIN.len)));
  const SALT_N = salt([...reversed(between(MAIN, dEstuary, MAIN.len)), ...upNF.slice(0, nfTide < 0 ? upNF.length : nfTide + 1)]);
  const SALT = [SALT_S, SALT_N];
  const offPath = (p: Polyline, xy: XY) => Math.min(...p.pts.map((q) => Math.hypot(q[0] - xy[0], q[1] - xy[1])));

  function setProfiles() {
    for (const p of SALT) {
      const at = stations.filter((s) => offPath(p, s.xy) < ON_PATH).map((s) => ({ d: nearestDistance(p, ...s.xy) - p.inlet, ppt: stationSalinity(s.ppt) }));
      p.knots = saltProfile(at, p.len - p.inlet);
    }
  }

  // ---------- flows ----------
  const current: StLucieFlows = { S308: snapshot.cfs.S308 ?? null, S80: snapshot.cfs.S80 ?? null };
  let liveTime: Date | null = null;
  const liveMeta = new Map<string, { time: Date; stale: boolean }>();
  let model: CanalModel = canalModel(current.S308, current.S80);
  /** Share of the drops reaching the lock that go through it; the rest are held in the canal. */
  let pass = 1;
  const acc = { l: Math.random(), b: Math.random(), bw: Math.random(), s: Math.random() };

  function setFlows(f: StLucieFlows) {
    for (const g of gauges) g.cfs = f[g.key];
    model = canalModel(f.S308, f.S80);
    const east = model.fromLake + model.basin * (1 - model.divide);
    pass = east > 0 ? Math.min(1, model.toEstuary / east) : 1;
    setProfiles();
  }

  // ---------- rendering ----------
  let C: Record<string, string> = {};
  let glow = true;
  const readColors = () => {
    C = Object.fromEntries(["bg", "ink", "muted", "tannin", "lakewater", "atl", "river", "sea", "lake", "shore", "marsh"].map((n) => [n, cssVar(`--${n}`)]));
    C.l = C.lakewater;
    C.b = C.tannin;
    C.s = C.atl;
    glow = isDark();
  };

  let histMode = false;
  const card = new InfoCard();
  const view = new Viewport({
    minScale: 150,
    maxScale: 60000,
    padding: (w) => (w < 600 ? { x: 14, top: histMode ? 14 : 70, bottom: 16 } : { x: 60, top: 60, bottom: 50 }),
    drawBase,
    onTap: tap,
  });
  const { X, Y } = view;
  const path = (c: CanvasRenderingContext2D, p: XY[]) => {
    c.beginPath();
    p.forEach((q, i) => (i ? c.lineTo(X(q[0]), Y(q[1])) : c.moveTo(X(q[0]), Y(q[1]))));
  };

  let journal: JournalOverlay | null = null;
  let showJournal = true;

  function drawBase() {
    const c = view.bctx;
    const { W, H } = view;
    c.setTransform(view.DPR, 0, 0, view.DPR, 0, 0);
    c.fillStyle = C.bg;
    c.fillRect(0, 0, W, H);
    drawLakes(c, water, X, Y, view.cam, { sea: C.sea, lake: C.lake, shore: C.shore, marsh: C.marsh, label: C.muted });

    c.lineCap = "round";
    c.lineJoin = "round";
    c.strokeStyle = C.river;
    for (const [p, w] of [[C23.pts, 1.3], [NF.pts, 1.6], [SF.pts, 1.8], [canalDrawn, 2.6]] as const) {
      c.lineWidth = w;
      path(c, p);
      c.stroke();
    }

    c.font = "500 12px 'Barlow Semi Condensed',sans-serif";
    for (const [n, lon, lat] of TOWNS) {
      const p = project(lon, lat);
      const y = Y(p[1]);
      if (y < 70) continue;
      c.fillStyle = C.muted;
      c.globalAlpha = 0.9;
      c.fillText(n, X(p[0]) + 4, y);
      c.globalAlpha = 1;
    }
    const label = (t: string, lon: number, lat: number, col: string, font = "italic 400 14px 'Spectral',serif") => {
      const p = project(lon, lat);
      c.font = font;
      c.fillStyle = col;
      c.fillText(t, X(p[0]), Y(p[1]));
    };
    /** A label for water that runs off the screen: slid along its row to stay in view. */
    const regionLabel = (t: string, lon: number, lat: number, col: string) => {
      const p = project(lon, lat);
      c.font = "italic 400 14px 'Spectral',serif";
      c.fillStyle = col;
      c.fillText(t, Math.max(10, Math.min(W - c.measureText(t).width - 10, X(p[0]))), Y(p[1]));
    };
    if (journal && showJournal) drawJournal(c, journal, X, Y, [], C.ink, glow);
    // Lake Okeechobee gets its own label, in the lake water's color.
    drawLakeLabels(c, water.filter((l) => l.name !== LAKE.name), X, Y, view.scale, C.muted);
    regionLabel(LAKE.name, -80.9, 26.95, C.l);
    label("St. Lucie Canal", -80.44, 27.0, C.muted, "italic 400 13px 'Spectral',serif");
    regionLabel("Atlantic Ocean", -80.16, 27.33, C.s);
    if (view.scale > 1500) {
      label("North Fork", -80.335, 27.25, C.muted, "italic 400 12px 'Spectral',serif");
      label("South Fork", -80.3, 27.14, C.muted, "italic 400 12px 'Spectral',serif");
      label("Indian River Lagoon", -80.245, 27.3, C.muted, "italic 400 12px 'Spectral',serif");
      label("St. Lucie Inlet", -80.2, 27.155, C.muted, "italic 400 12px 'Spectral',serif");
    }

    const readable = view.scale >= LABEL_SCALE;
    const readingAt = (key: string, text: string, x: number, y: number) => {
      const [dx, dy, align] = LABEL_AT[key];
      c.font = "600 12px 'Barlow Semi Condensed',sans-serif";
      c.fillStyle = liveMeta.get(key)?.stale ? C.muted : C.ink;
      c.textAlign = align;
      c.fillText(text, x + dx, y + dy);
      c.textAlign = "left";
    };
    for (const g of gauges) {
      const x = X(g.xy[0]);
      const y = Y(g.xy[1]);
      c.fillStyle = C.bg;
      c.strokeStyle = C.ink;
      c.lineWidth = 1.4;
      c.beginPath();
      c.rect(x - 4, y - 4, 8, 8);
      c.fill();
      c.stroke();
      if (!readable || g.cfs == null) continue;
      readingAt(g.key, `${fmtCfs(g.cfs)} cfs`, x, y);
    }
    for (const s of stations) {
      const x = X(s.xy[0]);
      const y = Y(s.xy[1]);
      const v = stationSalinity(s.ppt);
      c.fillStyle = C.bg;
      c.beginPath();
      c.arc(x, y, 5, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = C.s;
      c.globalAlpha = v == null ? 0 : 0.25 + 0.75 * Math.min(1, v / SEAWATER);
      c.fill();
      c.globalAlpha = 1;
      c.strokeStyle = C.ink;
      c.lineWidth = 1.4;
      c.stroke();
      if (!readable || v == null) continue;
      readingAt(s.key, `${fmtPpt(s.ppt.top ?? s.ppt.bottom)} ppt`, x, y);
    }
  }

  // ---------- drops ----------
  const drops: Drop[] = [];
  const SPEED = MAIN.len / 50;
  const SEA_SPEED = SPEED * 0.6;

  function spawn(col: Color, d: number, dir: 1 | -1) {
    if (drops.length < MAX_DROPS) drops.push({ d, col, dir, off: Math.random() - 0.5 });
  }
  function spawnSea() {
    if (drops.length >= MAX_DROPS) return;
    const p = SALT[Math.random() < 0.5 ? 0 : 1];
    drops.push({ d: 0, col: "s", dir: 1, off: Math.random() - 0.5, salt: p, turn: p.inlet + reach(p.knots, Math.random()) });
  }

  function step(dt: number) {
    const west = d308 + model.divide * (d80 - d308);
    const emit = (k: keyof typeof acc, cfs: number, f: () => void) => {
      acc[k] += cfs * K * dt;
      while (acc[k] >= 1) {
        acc[k] -= 1;
        f();
      }
    };
    emit("l", model.fromLake, () => spawn("l", Math.max(0, d308 - FADE) + Math.random() * SPEED * 0.05, 1));
    emit("b", model.basin * (1 - model.divide), () => spawn("b", west + Math.random() * (d80 - west), 1));
    emit("bw", model.basin * model.divide, () => spawn("b", d308 + Math.random() * (west - d308), -1));
    acc.s += SEA_RATE * dt;
    while (acc.s >= 1) {
      acc.s -= 1;
      spawnSea();
    }
    for (let i = drops.length - 1; i >= 0; i--) {
      const p = drops[i];
      if (p.salt) {
        p.d += (p.back ? -1 : 1) * SEA_SPEED * dt;
        if (!p.back && p.d >= p.turn!) p.back = true;
        if (p.back && p.d < 0) drops.splice(i, 1);
        continue;
      }
      const before = p.d;
      p.d += p.dir * SPEED * dt;
      // Some of what reaches a nearly closed lock stays in the canal.
      const held = p.dir > 0 && before < d80 && p.d >= d80 && Math.random() > pass;
      if (held || p.d > MAIN.len || p.d < Math.max(0, d308 - FADE)) drops.splice(i, 1);
    }
  }

  const alphaOf = (p: Drop) => {
    if (p.salt) return Math.min(1, p.d / Math.max(p.salt.inlet, 1e-4));
    if (p.d < d308) return Math.max(0, 1 - (d308 - p.d) / FADE);
    if (p.d > dInlet) return Math.max(0, 1 - (p.d - dInlet) / (MAIN.len - dInlet));
    return 1;
  };

  const streaks = new StreakLayer();
  const GROUP = { l: 0, b: 1, s: 2 } as const;
  function draw() {
    const c = view.fctx;
    const { W, H } = view;
    const sc = view.scale;
    c.setTransform(view.DPR, 0, 0, view.DPR, 0, 0);
    fadeLayer(c, W, H, Math.min(0.55, Math.max(0.2, 0.2 * Math.sqrt(sc / 1000))));
    const z = Math.min(2.6, Math.max(1.1, sc / 1500));
    // Group k + 3 is the same water fading in or out at an end of its route.
    for (const [col, k] of Object.entries(GROUP) as [Color, number][]) {
      // Seawater drops pile up in the estuary, so they glow more faintly.
      const a = col === "s" ? 0.55 : 1;
      streaks.style(k, C[col], (glow ? 0.3 : 0.8) * a, z);
      streaks.style(k + 3, C[col], (glow ? 0.12 : 0.35) * a, z);
    }
    streaks.begin();
    const tailPx = Math.min(7, Math.max(1.2, SPEED * sc * 0.12));
    for (const p of drops) {
      const line = p.salt ?? MAIN;
      const dir = p.salt ? (p.back ? -1 : 1) : p.dir;
      const [hx, hy] = pointAt(line, p.d);
      const [tx, ty] = pointAt(line, p.d - (dir * tailPx) / sc);
      // Wide water gets more sideways jitter so drops don't all ride the centerline.
      const wide = p.salt ? p.d < p.salt.inlet + (EST.len * 0.9) : p.d > dEstuary;
      const w = (wide ? 0.004 : 0.0007) * sc;
      const ox = p.off * w;
      const oy = p.off * w * 0.6;
      const sx = X(hx) + ox;
      const sy = Y(hy) + oy;
      if (sx < -10 || sy < -10 || sx > W + 10 || sy > H + 10) continue;
      streaks.add(GROUP[p.col] + (alphaOf(p) < 0.6 ? 3 : 0), X(tx) + ox, Y(ty) + oy, sx, sy);
    }
    streaks.flush(c, glow);
  }

  function refill(seconds: number, dt: number) {
    drops.length = 0;
    for (let t = 0; t < seconds; t += dt) step(dt);
    view.clearFx();
  }

  // ---------- cards ----------
  const nearLine = (l: Polyline, x: number, y: number) => Math.min(...l.pts.map((q) => (X(q[0]) - x) ** 2 + (Y(q[1]) - y) ** 2));
  function tap(x: number, y: number) {
    const seen = journal && showJournal ? hitSighting(journal, X, Y, x, y) : null;
    if (seen) return card.show(sightingCard(seen));
    let best: (() => void) | null = null;
    let bd = 22 * 22;
    const test = (d: number, f: () => void) => {
      if (d < bd) {
        bd = d;
        best = f;
      }
    };
    const at = (xy: XY) => (X(xy[0]) - x) ** 2 + (Y(xy[1]) - y) ** 2;
    const place = (p: Place) => test(at(project(p.lon, p.lat)), () => card.show({ title: p.name, kind: p.kind, body: p.text }));
    gauges.forEach((g) => test(at(g.xy), () => showGauge(g)));
    stations.forEach((s) => test(at(s.xy), () => showStation(s)));
    place(LAKE);
    place(INLET);
    // Lines count from a little farther, and lose ties to the points on them.
    bd = Math.min(bd, 22 * 22);
    const lines: [Polyline, () => void][] = [
      [CANAL, () => card.show({ title: "St. Lucie Canal", kind: "Canal (C-44)", body: canalText(canalMiles) })],
      [SF, () => card.show({ title: "South Fork", kind: "St. Lucie River", body: SOUTH_FORK_TEXT })],
      [NF, () => card.show({ title: "North Fork", kind: "St. Lucie River · not gauged", body: NORTH_FORK_TEXT })],
      [C23, () => card.show({ title: "C-23", kind: "Canal", body: C23_TEXT })],
      [EST, () => card.show({ title: "St. Lucie Estuary", kind: "Estuary", body: ESTUARY_TEXT })],
      [IRL, () => card.show({ title: "Indian River Lagoon", kind: "Lagoon", body: LAGOON_TEXT })],
    ];
    if (!best) for (const [l, f] of lines) test(nearLine(l, x, y) * 1.5, f);
    if (best) (best as () => void)();
    else card.hide();
  }

  function showGauge(g: Gauge) {
    const kind = `USGS gauge ${g.id}`;
    const title = g.name ?? g.short;
    if (g.cfs == null) return card.show({ title, kind, body: "No recent reading at this gauge." });
    const meta = liveMeta.get(g.key);
    const when = meta ? `, ${timeFmt(meta.time)}` : "";
    let body: string;
    if (g.key === "S308") {
      body =
        g.cfs < 0
          ? `${fmtCfs(-g.cfs)} cubic feet per second is running <b>back into the lake</b>${when}. The lake is lower than the canal, so the canal's own runoff drains west into it.`
          : `${fmtCfs(g.cfs)} cubic feet per second${when}, about ${Math.round(mgd(g.cfs))} million gallons a day of lake water.`;
      body += " The Port Mayaca Lock and Dam, built in 1977, is where the canal meets the lake.";
    } else {
      body =
        model.toEstuary > 0
          ? `${fmtCfs(g.cfs)} cubic feet per second${when}, into the South Fork.${model.lakeShare > 0 ? ` About ${Math.round(model.lakeShare * 100)}% of it is lake water; the rest is runoff from along the canal.` : " None of it is lake water right now: it's runoff from along the canal."}`
          : `${fmtCfs(g.cfs)} cubic feet per second${when}: nothing is going through to the river.${g.cfs < 0 ? " A small negative reading is water above the gate drifting back west." : ""}`;
      body += " Everything the canal sends to the estuary passes the St. Lucie Lock and Dam, built in 1941.";
    }
    if (meta?.stale) body += " This gauge hasn't reported recently, so treat it as old.";
    card.show({ title, kind, body });
  }

  function showStation(s: Station) {
    const { top, bottom } = s.ppt;
    const meta = liveMeta.get(s.key);
    const read =
      top == null && bottom == null
        ? "No recent salinity reading here."
        : `${top != null ? `<b>${fmtPpt(top)} ppt</b> near the surface` : ""}${top != null && bottom != null ? " and " : ""}${bottom != null ? `<b>${fmtPpt(bottom)} ppt</b> near the bottom` : ""}${meta ? `, ${timeFmt(meta.time)}` : ""}.`;
    card.show({ title: s.name, kind: `USGS salinity station ${s.id}`, body: `${read} ${SALINITY_NOTE}${meta?.stale ? " This station hasn't reported recently, so treat it as old." : ""}` });
  }

  // ---------- gauge strip + copy ----------
  function renderProfile() {
    const el = document.getElementById("profile")!;
    el.replaceChildren();
    const chip = (value: string, unit: string, name: string, stale: boolean, xy: XY, show: () => void) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `gauge${stale ? " stale" : ""}`;
      const v = document.createElement("div");
      v.className = "v";
      v.textContent = value;
      const u = document.createElement("small");
      u.textContent = unit;
      v.appendChild(u);
      const n = document.createElement("div");
      n.className = "n";
      n.textContent = name;
      b.append(v, n);
      b.addEventListener("click", () => {
        view.flyTo(xy, 2500);
        show();
      });
      el.appendChild(b);
    };
    for (const g of gauges) chip(fmtCfs(g.cfs), "cfs", g.short, !!liveMeta.get(g.key)?.stale, g.xy, () => showGauge(g));
    for (const s of stations) chip(fmtPpt(s.ppt.top ?? s.ppt.bottom), "ppt", `${s.short}${s.ppt.top != null ? ", surface" : ""}`, !!liveMeta.get(s.key)?.stale, s.xy, () => showStation(s));
  }

  const snapLabel = new Date(snapshot.time).toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  function renderCopy(state: "checking" | "live" | "snapshot") {
    const m = model;
    let flow: string;
    if (m.fromLake > 0) {
      flow =
        `Lake Okeechobee is releasing <b>${fmtCfs(m.fromLake)} cfs</b> into the St. Lucie Canal at Port Mayaca. ` +
        (m.toEstuary <= 0
          ? "The lock at the other end is closed, so none of it reaches the river yet. "
          : m.basin > 0
            ? `With the canal's own runoff, <b>${fmtCfs(m.toEstuary)} cfs</b> spills through the St. Lucie Lock into the river, ${Math.round(m.lakeShare * 100)}% of it lake water. `
            : `<b>${fmtCfs(m.toEstuary)} cfs</b> of it spills through the St. Lucie Lock into the river. `);
    } else if (m.toLake > 0) {
      flow =
        `The canal is running backward: <b>${fmtCfs(m.toLake)} cfs</b> of its runoff is flowing into Lake Okeechobee at Port Mayaca` +
        (m.toEstuary > 0 ? `, and <b>${fmtCfs(m.toEstuary)} cfs</b> is going the other way, through the St. Lucie Lock to the river. ` : ", and none is going through the St. Lucie Lock to the river. ");
    } else {
      flow = m.toEstuary > 0 ? `The lake isn't releasing water. The canal's own runoff, <b>${fmtCfs(m.toEstuary)} cfs</b>, spills through the St. Lucie Lock into the river. ` : "No water is moving through the canal right now. ";
    }
    const sp = stations.find((s) => s.key === "SP");
    const top = sp?.ppt.top ?? null;
    const salt = top != null ? `At Stuart the river is <b>${fmtPpt(top)} ppt</b> salt at the surface; seawater is about ${SEAWATER}. ` : "";
    document.getElementById("lede")!.innerHTML = flow + salt + "Tap anything on the map.";
    const tail = "Negative flow is running back toward the lake. Salinity is in parts per thousand (ppt).";
    document.getElementById("status")!.textContent =
      state === "live" ? `Live USGS readings, updated ${timeFmt(liveTime!)}. Flow is in cubic feet per second (cfs). ${tail}`
      : state === "checking" ? `USGS readings from ${snapLabel}. Checking for live readings… ${tail}`
      : `USGS readings from ${snapLabel}. Live readings didn't load, so this is a saved snapshot. ${tail}`;
  }

  // ---------- releases since 1931 ----------
  const hist = data.history;
  const sum = summarize(hist);
  function renderHist() {
    const bursts = sum.bursts.map((b) => `${b.year} (${fmtCfs(b.cfs)} cfs)`);
    document.getElementById("histRead")!.innerHTML =
      `The canal drained the most in ${sum.peak.year}, <b>${fmtCfs(sum.peak.cfs)} cfs</b> on average all year. ` +
      `Since ${MODERN}, releases come in bursts, biggest in ${bursts.slice(0, -1).join(", ")}, and ${bursts[bursts.length - 1]}. ` +
      `In <b>${sum.back.years.length} of those ${sum.back.of} years</b>, more water ran back into the lake than out.` +
      (sum.lock ? ` The lock passes the canal's own runoff too: in ${sum.lock.year} it averaged <b>${fmtCfs(sum.lock.cfs)} cfs</b> into the estuary.` : "");
    renderHistory(document.getElementById("histChart")!, hist.years, [
      { name: "Out of the lake (S-308)", color: "--chart-lake", values: hist.S308 },
      { name: "Into the estuary (S-80)", color: "--chart-estuary", values: hist.S80 },
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
    const [flows, salinity] = await Promise.allSettled([fetchLatest(gauges.map((g) => g.id), signed), fetchSalinity(stations.map((s) => s.id))]);
    let latest: Date | null = null;
    const seen = (key: string, time: Date) => {
      liveMeta.set(key, { time, stale: Date.now() - time.getTime() > STALE_MS });
      if (!latest || time > latest) latest = time;
    };
    if (flows.status === "fulfilled") {
      for (const g of gauges) {
        const r = flows.value.get(g.id);
        if (!r) continue;
        current[g.key] = r.cfs;
        seen(g.key, r.time);
      }
    }
    if (salinity.status === "fulfilled") {
      for (const s of stations) {
        const r = salinity.value.get(s.id);
        if (!r) continue;
        s.ppt = { top: r.top, bottom: r.bottom };
        seen(s.key, r.time);
      }
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
  document.getElementById("bCanal")!.addEventListener("click", () => view.fit(VIEWS.canal, true));
  document.getElementById("bEstuary")!.addEventListener("click", () => view.fit(VIEWS.estuary, true));

  readColors();
  setFlows(current);
  renderProfile();
  renderCopy("checking");
  view.resize();
  view.fit(VIEWS.all);
  // Warm start: long enough for lake water to reach the sea, and for the tide to fill the estuary.
  refill(MAIN.len / SPEED + 10, 0.1);
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
