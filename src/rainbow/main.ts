import "../shared/map.css";
import "../shared/story.css";
import "./rainbow.css";
import gaugeConfig from "../../config/gauges.json";
import { InfoCard } from "../shared/card";
import { loadData, showLoadError } from "../shared/data";
import { KM_PER_UNIT, nearestDistance, pointAt, polyline, project, ringsPath, unpackRings, type Polyline, type XY } from "../shared/geo";
import { drawJournal, hitSighting, journalCardHtml, loadJournalOverlay, sightingCard, type JournalOverlay } from "../shared/journal-overlay";
import { decodeLakes, drawLakeLabels, drawLakes } from "../shared/lakes";
import { STALE_MS, fetchLatest, fmtCfs } from "../shared/live";
import { StreakLayer, drawBoil, fadeLayer } from "../shared/streaks";
import { cssVar, fontsReady, isDark, onColorSchemeChange } from "../shared/theme";
import type { GaugeConfig, LakesFile, RainbowFile, RainbowFlows, RainbowKey, Snapshot } from "../shared/types";
import { Viewport, startLoop } from "../shared/viewport";
import { CANAL_TEXT, LAKE_ROUSSEAU, TOWNS, US41_NOTE, VIEWS, focusText, springshedText } from "./content";
import { mgd, rainbowModel, summarize, type RainbowModel } from "./flow";
import { renderHistory } from "../shared/history";

/** Particles spawned per cfs per second. */
const K = 0.035;
const MAX_PARTICLES = 20000;
/** Groundwater dots started per second, and how fast they drift (map units a second). */
const GW_RATE = 3;
const GW_SPEED = 0.035;
/** Gauge readings are drawn on the map only at this zoom (pixels per map unit) or closer. */
const GAUGE_LABEL_SCALE = 1200;
/** Where the NHD path from Inglis Dam joins the barge canal. */
const CANAL_JOIN: [number, number] = [-82.64, 29.0187];

interface River extends Polyline {
  name: string;
  next?: { r: River; d: number };
  /** Some of the water turns off here, with this chance, onto another line. */
  split?: { d: number; r: River; p: number };
}

interface Gauge extends GaugeConfig {
  key: RainbowKey;
  cfs: number | null;
  xy: XY;
}

interface Vent {
  name: string;
  lon: number;
  lat: number;
  xy: XY;
  /** Where its spring run meets the Rainbow, and how long that run is. */
  d: number;
  j: XY;
  leg: number;
  phase: number;
}

type Color = "t" | "s";
type Source =
  | { kind: "head"; r: River; cfs: number; col: Color; acc: number }
  | { kind: "diffuse"; r: River; d0: number; d1: number; cfs: number; col: Color; acc: number }
  | { kind: "vent"; v: Vent; cfs: number; acc: number };

interface Particle {
  r: River;
  d: number;
  col: Color;
  off: number;
  v?: Vent;
  leg?: number;
}

/** A drop of groundwater drifting across the springshed toward the head springs. */
interface Seep {
  a: XY;
  c: XY;
  u: number;
  du: number;
}

/** Where each gauge's reading sits relative to its marker: [dx, dy, align]. */
const LABEL_AT: Record<RainbowKey, [number, number, CanvasTextAlign]> = {
  WH: [8, -6, "left"],
  RbN: [8, -6, "left"],
  Rb: [8, 16, "left"],
  WD: [-8, -6, "right"],
  WB: [8, -6, "left"],
  WI: [8, 16, "left"],
};

const timeFmt = (d: Date) => d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

async function main() {
  const [data, snapshot, lakesFile] = await Promise.all([loadData<RainbowFile>("rainbow.json"), loadData<Snapshot>("snapshot.json"), loadData<LakesFile>("lakes.json"), fontsReady()]);
  const lakes = decodeLakes(lakesFile);
  const decodeRings = (rings: number[][]) => unpackRings(rings, data.meta.coordOrigin, data.meta.coordScale);

  // ---------- geometry ----------
  const line = (name: string): River => ({ ...polyline(data.rivers[name].p.map(([x, y]) => project(x, y))), name });
  const RB = line("Rainbow River");
  const WL = line("Withlacoochee River");
  const CANAL = line("Cross Florida Barge Canal");
  const end = (r: River) => r.pts[r.pts.length - 1];
  RB.next = { r: WL, d: nearestDistance(WL, ...end(RB)) };

  const gauges: Gauge[] = (gaugeConfig as GaugeConfig[])
    .filter((g): g is GaugeConfig & { key: RainbowKey } => g.page === "rainbow")
    .map((g) => ({ ...g, cfs: null, xy: project(g.lon, g.lat) }));
  const G = (key: RainbowKey) => gauges.find((g) => g.key === key)!;

  // Inglis: the dam's share of the water leaves the river for a short connector into the canal.
  const damXY = G("WI").xy;
  const splitD = nearestDistance(WL, ...damXY);
  const joinXY = project(...CANAL_JOIN);
  const SPILL: River = { ...polyline([pointAt(WL, splitD), damXY, pointAt(CANAL, nearestDistance(CANAL, ...joinXY))]), name: "Inglis Dam" };
  SPILL.next = { r: CANAL, d: nearestDistance(CANAL, ...joinXY) };

  const vents: Vent[] = data.vents.map(([name, lon, lat], i) => {
    const xy = project(lon, lat);
    const d = nearestDistance(RB, ...xy);
    const j = pointAt(RB, d);
    return { name, lon, lat, xy, d, j, leg: Math.hypot(j[0] - xy[0], j[1] - xy[1]), phase: (i * 0.618) % 1 };
  });
  const head = vents.find((v) => v.name === "Rainbow Springs") ?? vents[0];
  const upperD = nearestDistance(RB, ...G("RbN").xy);

  const shedRings = decodeRings(data.springshed.rings);
  const focusRings = decodeRings(data.focusArea.rings);
  const contours = data.contours.map((c) => ({ v: c.v, pts: c.p.map(([x, y]) => project(x, y)) }));
  const shedPath = ringsPath(shedRings);
  const focusPath = ringsPath(focusRings);
  const probe = document.createElement("canvas").getContext("2d")!;
  const inside = (p: Path2D, xy: XY) => probe.isPointInPath(p, xy[0], xy[1], "evenodd");
  const box = (rings: XY[][]) => {
    const xs = rings.flat().map((p) => p[0]);
    const ys = rings.flat().map((p) => p[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] as const;
  };
  const shedBox = box(shedRings);

  // ---------- flows ----------
  const current: RainbowFlows = { WH: snapshot.cfs.WH, RbN: snapshot.cfs.RbN, Rb: snapshot.cfs.Rb, WD: snapshot.cfs.WD, WB: snapshot.cfs.WB, WI: snapshot.cfs.WI };
  let liveTime: Date | null = null;
  const liveMeta = new Map<RainbowKey, { time: Date; stale: boolean }>();
  let model: RainbowModel = rainbowModel(current, vents.length);
  let sources: Source[] = [];

  function setFlows(f: RainbowFlows) {
    for (const g of gauges) g.cfs = f[g.key];
    model = rainbowModel(f, vents.length);
    WL.split = { d: splitD, r: SPILL, p: model.damShare };
    sources = [
      { kind: "head", r: WL, cfs: f.WH ?? 0, col: "t", acc: Math.random() },
      ...vents.map((v): Source => ({ kind: "vent", v, cfs: model.perVent, acc: Math.random() })),
      { kind: "diffuse", r: RB, d0: upperD, d1: RB.len, cfs: model.lowerGain, col: "s", acc: Math.random() },
    ];
  }

  // ---------- rendering ----------
  let C: Record<string, string> = {};
  let glow = true;
  const readColors = () => {
    C = Object.fromEntries(["bg", "ink", "muted", "tannin", "spring", "under", "river", "contour", "sea", "lake", "shore", "marsh"].map((n) => [n, cssVar(`--${n}`)]));
    C.t = C.tannin;
    C.s = C.spring;
    C.u = C.under;
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
  const path = (c: CanvasRenderingContext2D, pts: XY[]) => {
    c.beginPath();
    pts.forEach((p, i) => (i ? c.lineTo(X(p[0]), Y(p[1])) : c.moveTo(X(p[0]), Y(p[1]))));
  };
  /** Draw a map-unit Path2D through the camera, with widths and dashes kept in pixels. */
  const inMap = (c: CanvasRenderingContext2D, draw: (s: number) => void) => {
    const { s, tx, ty } = view.cam;
    c.save();
    c.setTransform(view.DPR * s, 0, 0, view.DPR * s, view.DPR * tx, view.DPR * ty);
    draw(s);
    c.restore();
  };

  let journal: JournalOverlay | null = null;
  let showJournal = true;
  let journalSprings: { xy: XY; id: string }[] = [];

  function drawBase() {
    const c = view.bctx;
    const { W, H } = view;
    c.setTransform(view.DPR, 0, 0, view.DPR, 0, 0);
    c.fillStyle = C.bg;
    c.fillRect(0, 0, W, H);
    drawLakes(c, lakes, X, Y, view.cam, { sea: C.sea, lake: C.lake, shore: C.shore, marsh: C.marsh, label: C.muted });

    // The springshed and, inside it, the priority focus area.
    inMap(c, (s) => {
      c.fillStyle = C.u;
      c.globalAlpha = glow ? 0.07 : 0.09;
      c.fill(shedPath, "evenodd");
      c.globalAlpha = glow ? 0.1 : 0.12;
      c.fill(focusPath, "evenodd");
      c.globalAlpha = 0.7;
      c.strokeStyle = C.u;
      c.lineWidth = 1.3 / s;
      c.setLineDash([5 / s, 4 / s]);
      c.stroke(shedPath);
      c.setLineDash([1.5 / s, 3 / s]);
      c.stroke(focusPath);
    });

    // Aquifer contours: the surface slopes down toward the river valley and the Gulf.
    c.lineWidth = 1;
    c.strokeStyle = C.contour;
    c.setLineDash([2, 5]);
    c.font = "500 11px 'Barlow Semi Condensed',sans-serif";
    c.fillStyle = C.muted;
    for (const k2 of contours) {
      path(c, k2.pts);
      c.stroke();
      const m = k2.pts[Math.floor(k2.pts.length * 0.5)];
      const x = X(m[0]);
      const y = Y(m[1]);
      if (x > 40 && x < W - 40 && y > 90 && y < H - 10) {
        c.globalAlpha = 0.8;
        c.fillText(`${k2.v} ft`, x + 3, y - 3);
        c.globalAlpha = 1;
      }
    }
    c.setLineDash([]);

    c.lineCap = "round";
    c.lineJoin = "round";
    c.strokeStyle = C.river;
    for (const [r, w] of [[CANAL, 1.8], [SPILL, 1.2], [WL, 3.2], [RB, 2.8]] as const) {
      c.lineWidth = w;
      path(c, r.pts);
      c.stroke();
    }
    c.strokeStyle = C.s;
    c.globalAlpha = 0.35;
    c.lineWidth = 1;
    for (const v of vents) {
      c.beginPath();
      c.moveTo(X(v.xy[0]), Y(v.xy[1]));
      c.lineTo(X(v.j[0]), Y(v.j[1]));
      c.stroke();
    }
    c.globalAlpha = 1;

    c.font = "500 12px 'Barlow Semi Condensed',sans-serif";
    for (const [n, lon, lat] of TOWNS) {
      const p = project(lon, lat);
      const y = Y(p[1]);
      if (y < 70) continue;
      c.fillStyle = C.muted;
      c.globalAlpha = 0.9;
      c.fillText(n, X(p[0]), y);
      c.globalAlpha = 1;
    }
    const label = (t: string, lon: number, lat: number, col: string, font = "italic 400 14px 'Spectral',serif") => {
      const p = project(lon, lat);
      c.font = font;
      c.fillStyle = col;
      c.fillText(t, X(p[0]), Y(p[1]));
    };
    if (journal && showJournal) drawJournal(c, journal, X, Y, journalSprings, C.ink, glow);
    drawLakeLabels(c, lakes, X, Y, view.scale, C.muted);
    label("Rainbow River", -82.425, 29.1, C.s);
    label("Withlacoochee River", -82.42, 28.955, C.t);
    label("Rainbow's springshed", -82.42, 29.52, C.u);
    if (view.scale > 2500) label("Cross Florida Barge Canal", -82.73, 28.988, C.muted, "italic 400 12px 'Spectral',serif");
    if (view.scale > 6000) label("priority focus area", -82.39, 29.14, C.u, "italic 400 12px 'Spectral',serif");

    for (const g of gauges) {
      if (g.cfs == null) continue;
      const x = X(g.xy[0]);
      const y = Y(g.xy[1]);
      c.fillStyle = C.bg;
      c.strokeStyle = C.ink;
      c.lineWidth = 1.4;
      c.beginPath();
      c.rect(x - 4, y - 4, 8, 8);
      c.fill();
      c.stroke();
      // Zoomed out, six readings crowd two towns; the gauge strip below has them all.
      if (view.scale < GAUGE_LABEL_SCALE) continue;
      const [dx, dy, align] = LABEL_AT[g.key];
      c.font = "600 12px 'Barlow Semi Condensed',sans-serif";
      c.fillStyle = isStale(g) ? C.muted : C.ink;
      c.textAlign = align;
      c.fillText(`${fmtCfs(g.cfs)} cfs`, x + dx, y + dy);
      c.textAlign = "left";
    }
  }

  const isStale = (g: Gauge) => !!liveMeta.get(g.key)?.stale;

  // ---------- particles ----------
  const parts: Particle[] = [];
  const seeps: Seep[] = [];
  const SPEED = WL.len / 45;

  function spawn(src: Source) {
    if (parts.length >= MAX_PARTICLES) return;
    const off = Math.random() - 0.5;
    if (src.kind === "head") parts.push({ r: src.r, d: Math.random() * SPEED * 0.05, col: src.col, off });
    else if (src.kind === "diffuse") parts.push({ r: src.r, d: src.d0 + Math.random() * (src.d1 - src.d0), col: src.col, off });
    else parts.push({ v: src.v, leg: 0, r: RB, d: src.v.d, col: "s", off });
  }

  function spawnSeep() {
    // Rejection-sample a start inside the springshed; arc gently toward the head springs.
    for (let tries = 0; tries < 20; tries++) {
      const a: XY = [shedBox[0] + Math.random() * (shedBox[2] - shedBox[0]), shedBox[1] + Math.random() * (shedBox[3] - shedBox[1])];
      if (!inside(shedPath, a) || Math.hypot(a[0] - head.xy[0], a[1] - head.xy[1]) < 0.02) continue;
      const b = head.xy;
      const bend = (Math.random() - 0.5) * 0.5;
      const c: XY = [(a[0] + b[0]) / 2 - (b[1] - a[1]) * bend, (a[1] + b[1]) / 2 + (b[0] - a[0]) * bend];
      seeps.push({ a, c, u: 0, du: GW_SPEED / Math.hypot(b[0] - a[0], b[1] - a[1]) });
      return;
    }
  }
  const qb = (t: number, a: XY, c: XY, b: XY): XY => [
    (1 - t) ** 2 * a[0] + 2 * (1 - t) * t * c[0] + t * t * b[0],
    (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * c[1] + t * t * b[1],
  ];

  let seepAcc = 0;
  function step(dt: number) {
    for (const s of sources) {
      s.acc += s.cfs * K * dt;
      while (s.acc >= 1) {
        s.acc -= 1;
        spawn(s);
      }
    }
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      // Vent water first runs down its spring run to the river.
      if (p.v && p.leg! < 1) {
        p.leg! += (dt * SPEED) / Math.max(p.v.leg, 1e-4);
        continue;
      }
      const before = p.d;
      p.d += dt * SPEED;
      const sp = p.r.split;
      if (sp && before < sp.d && p.d >= sp.d && Math.random() < sp.p) {
        p.d -= sp.d;
        p.r = sp.r;
      }
      if (p.d > p.r.len) {
        const next = p.r.next;
        if (!next) {
          parts.splice(i, 1);
          continue;
        }
        p.d = next.d + (p.d - p.r.len);
        p.r = next.r;
      }
    }
    seepAcc += GW_RATE * dt;
    while (seepAcc >= 1) {
      seepAcc--;
      spawnSeep();
    }
    for (let i = seeps.length - 1; i >= 0; i--) if ((seeps[i].u += seeps[i].du * dt) >= 1) seeps.splice(i, 1);
  }

  const streaks = new StreakLayer();
  // Groups 0/1: tannin and spring water on their own rivers. 2/3: the same below
  // Dunnellon, where both share one channel and additive glow would stack them to white.
  const GROUP = { t: 0, s: 1 } as const;
  const shared = (p: Particle) => p.r !== RB && (p.r !== WL || p.d > RB.next!.d);
  function draw() {
    const c = view.fctx;
    const { W, H } = view;
    const sc = view.scale;
    c.setTransform(view.DPR, 0, 0, view.DPR, 0, 0);
    fadeLayer(c, W, H, Math.min(0.55, Math.max(0.2, 0.2 * Math.sqrt(sc / 1000))));
    const z = Math.min(2.6, Math.max(1.1, sc / 1500));
    streaks.style(GROUP.t, C.t, glow ? 0.34 : 0.85, z);
    streaks.style(GROUP.s, C.s, glow ? 0.34 : 0.85, z);
    streaks.style(GROUP.t + 2, C.t, glow ? 0.16 : 0.6, z);
    streaks.style(GROUP.s + 2, C.s, glow ? 0.16 : 0.6, z);
    streaks.begin();
    const tailPx = Math.min(7, Math.max(1.2, SPEED * sc * 0.12));
    for (const p of parts) {
      let hx: number, hy: number, tx: number, ty: number;
      if (p.v && p.leg! < 1) {
        const v = p.v;
        const k0 = Math.max(0, p.leg! - tailPx / sc / Math.max(v.leg, 1e-4));
        hx = v.xy[0] + (v.j[0] - v.xy[0]) * p.leg!;
        hy = v.xy[1] + (v.j[1] - v.xy[1]) * p.leg!;
        tx = v.xy[0] + (v.j[0] - v.xy[0]) * k0;
        ty = v.xy[1] + (v.j[1] - v.xy[1]) * k0;
      } else {
        [hx, hy] = pointAt(p.r, p.d);
        [tx, ty] = pointAt(p.r, Math.max(0, p.d - tailPx / sc));
      }
      // Wider rivers get more sideways jitter so drops don't all ride the centerline.
      const w = (p.r === WL || p.r === CANAL ? 0.0012 : 0.0006) * sc;
      const ox = p.off * w;
      const oy = p.off * w * 0.6;
      const sx = X(hx) + ox;
      const sy = Y(hy) + oy;
      if (sx < -10 || sy < -10 || sx > W + 10 || sy > H + 10) continue;
      streaks.add(GROUP[p.col] + (shared(p) ? 2 : 0), X(tx) + ox, Y(ty) + oy, sx, sy);
    }
    streaks.flush(c, glow);
    c.fillStyle = C.u;
    for (const s of seeps) {
      const q = qb(s.u, s.a, s.c, head.xy);
      c.globalAlpha = 0.75 * Math.min(1, s.u * 8, (1 - s.u) * 8);
      c.fillRect(X(q[0]) - 1, Y(q[1]) - 1, 2, 2);
    }
    c.globalAlpha = 1;
    const now = performance.now() / 1000;
    const zs = Math.min(1, sc / 6000);
    for (const v of vents) drawBoil(c, X(v.xy[0]), Y(v.xy[1]), 1.6 + Math.sqrt(model.perVent || 1) * 0.3 * zs, v.phase, now, C.s);
  }

  function refill(seconds: number, dt: number) {
    parts.length = 0;
    seeps.length = 0;
    for (let t = 0; t < seconds; t += dt) step(dt);
    view.clearFx();
  }

  // ---------- cards ----------
  function tap(x: number, y: number) {
    const seen = journal && showJournal ? hitSighting(journal, X, Y, x, y) : null;
    if (seen) return card.show(sightingCard(seen));
    let best: (() => void) | null = null;
    let bd = 22 * 22;
    const test = (xy: XY, f: () => void) => {
      const d = (X(xy[0]) - x) ** 2 + (Y(xy[1]) - y) ** 2;
      if (d < bd) {
        bd = d;
        best = f;
      }
    };
    gauges.forEach((g) => test(g.xy, () => showGauge(g)));
    vents.forEach((v) => test(v.xy, () => showVent(v)));
    test(project(LAKE_ROUSSEAU.lon, LAKE_ROUSSEAU.lat), () => card.show({ title: LAKE_ROUSSEAU.name, kind: LAKE_ROUSSEAU.kind, body: LAKE_ROUSSEAU.text }));
    test(pointAt(CANAL, CANAL.len / 2), () => card.show({ title: "Cross Florida Barge Canal", kind: "Canal", body: CANAL_TEXT }));
    if (best) return (best as () => void)();
    // Nothing close: tell the reader which zone they tapped.
    const m: XY = [(x - view.cam.tx) / view.cam.s, (y - view.cam.ty) / view.cam.s];
    if (inside(focusPath, m)) card.show({ title: "Priority focus area", kind: "Rainbow Springs", body: focusText(data.focusArea.km2) });
    else if (inside(shedPath, m)) card.show({ title: "Rainbow's springshed", kind: "Where its groundwater comes from", body: springshedText(data.springshed.km2) });
    else card.hide();
  }

  function showGauge(g: Gauge) {
    const kind = `USGS gauge ${g.id}`;
    const title = g.name ?? g.short;
    if (g.cfs == null) {
      card.show({ title, kind, body: "No recent reading at this gauge." });
      return;
    }
    const meta = liveMeta.get(g.key);
    let body = `${fmtCfs(g.cfs)} cubic feet per second${meta ? `, ${timeFmt(meta.time)}` : ""}.`;
    if (meta?.stale) body += " This gauge hasn't reported recently, so treat it as old.";
    if (g.key === "RbN") body += ` All the mapped vents are upstream, so this is about what the head springs put out: ${Math.round(mgd(g.cfs))} million gallons a day.`;
    if (g.key === "WD") body += US41_NOTE;
    if (g.key === "WI") body += " Water released here runs down the barge canal to the Gulf.";
    if (g.key === "WB") body += " This is the river's own channel below Lake Rousseau.";
    card.show({ title, kind, body });
  }

  function showVent(v: Vent) {
    const id = journal?.nearestSpring(v.lon, v.lat)?.[0];
    const log = journal && id ? ` ${journalCardHtml(journal, id)}` : "";
    card.show({
      title: v.name,
      kind: "Spring vent",
      body: `The springs above the upper gauge put out ${fmtCfs(model.springs)} cfs together. Individual vents aren't gauged, so the map spreads that evenly across the ${vents.length} mapped vents, about ${fmtCfs(model.perVent)} cfs each.${log}`,
    });
  }

  // ---------- gauge strip + copy ----------
  function renderProfile() {
    const el = document.getElementById("profile")!;
    el.replaceChildren();
    for (const g of gauges) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `gauge${isStale(g) ? " stale" : ""}`;
      const v = document.createElement("div");
      v.className = "v";
      v.textContent = fmtCfs(g.cfs);
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

  const snapLabel = new Date(snapshot.time).toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  function renderCopy(state: "checking" | "live" | "snapshot") {
    const share = model.rainbowShare;
    const mouth = G("Rb").cfs;
    document.getElementById("lede")!.innerHTML =
      `The springs at its head put out <b>${fmtCfs(model.springs)} cfs</b>, about ${Math.round(mgd(model.springs))} million gallons a day, so the Rainbow starts at full size. ` +
      (mouth != null ? `About ${(RB.len * KM_PER_UNIT * 0.621).toFixed(0)} miles on, it carries <b>${fmtCfs(mouth)} cfs</b> into the Withlacoochee at Dunnellon${share != null ? `, <b>${Math.round(share * 100)}%</b> of the river below` : ""}. ` : "") +
      "Tap anything on the map.";
    const tail = "Springshed: SWFWMD. Priority focus area: FDEP. Aquifer contours: FGS.";
    document.getElementById("status")!.textContent =
      state === "live" ? `Live USGS readings, updated ${timeFmt(liveTime!)}. Units are cubic feet per second (cfs). ${tail}`
      : state === "checking" ? `USGS readings from ${snapLabel}. Checking for live readings… ${tail}`
      : `USGS readings from ${snapLabel}. Live readings didn't load, so this is a saved snapshot. ${tail}`;
  }

  // ---------- flow since 1966 ----------
  const hist = data.history;
  const sum = summarize(hist);
  function renderHist() {
    const pct = Math.round(sum.dryYear.share * 100);
    document.getElementById("histRead")!.innerHTML =
      `The spring is steady; the river isn't. Year to year the Rainbow's flow ranges about <b>${sum.rainbowSwing.toFixed(1)}×</b>, from ${fmtCfs(sum.low.cfs)} cfs in ${sum.low.year} to ${fmtCfs(sum.high.cfs)} in ${sum.high.year}. ` +
      `The Withlacoochee above Dunnellon ranges <b>${Math.round(sum.riverSwing)}×</b>, and in ${sum.dryYear.year}, its driest year, the Rainbow was <b>${pct}%</b> of the river below. ` +
      `It averaged ${fmtCfs(sum.first.mean)} cfs in ${sum.first.from}–${String(sum.first.to).slice(2)} and ${fmtCfs(sum.last.mean)} in ${sum.last.from}–${String(sum.last.to).slice(2)}.`;
    renderHistory(document.getElementById("histChart")!, hist.years, [
      { name: "Rainbow at Dunnellon", color: "--chart-spring", values: hist.Rb },
      { name: "Withlacoochee near Holder", color: "--chart-tannin", values: hist.WH },
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
    const readings = await fetchLatest(gauges.map((g) => g.id));
    let latest: Date | null = null;
    for (const g of gauges) {
      const r = readings.get(g.id);
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
  document.getElementById("bRiver")!.addEventListener("click", () => view.fit(VIEWS.river, true));
  document.getElementById("bSprings")!.addEventListener("click", () => view.fit(VIEWS.springs, true));

  readColors();
  setFlows(current);
  renderProfile();
  renderCopy("checking");
  view.resize();
  view.fit(VIEWS.all);
  // Warm start: long enough for water from Holder to reach the Gulf, and for groundwater to arrive.
  refill(WL.len / SPEED + 10, 0.1);
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
    journalSprings = vents.flatMap((v) => {
      const hit = o.nearestSpring(v.lon, v.lat);
      return hit ? [{ xy: v.xy, id: hit[0] }] : [];
    });
    const chip = document.createElement("button");
    chip.type = "button";
    chip.textContent = "Journal";
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
