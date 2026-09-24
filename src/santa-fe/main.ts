import "../shared/map.css";
import "./santa-fe.css";
import gaugeConfig from "../../config/gauges.json";
import { InfoCard } from "../shared/card";
import { loadData, showLoadError } from "../shared/data";
import { edgeRuns, locate, nearestDistance, pointAt, polyline, project, type Polyline, type XY } from "../shared/geo";
import { drawJournal, journalCardHtml, loadJournalOverlay, type JournalOverlay } from "../shared/journal-overlay";
import { decodeLakes, drawLakeLabels, drawLakes } from "../shared/lakes";
import { StreakLayer, drawBoil, fadeLayer } from "../shared/streaks";
import { cssVar, fontsReady, isDark, onColorSchemeChange } from "../shared/theme";
import type { AquiferFile, ContoursFile, FlowKey, Flows, GaugeConfig, LakesFile, RiversFile, Snapshot } from "../shared/types";
import { Viewport, startLoop } from "../shared/viewport";
import { blend, colorize, contour, decodeGrid, type ContourLine } from "./aquifer";
import { SINKS, SPRINGS, TOWNS, TRACES, UNDERGROUND_TEXT, VIEWS, type Reach } from "./content";
import { fmtCfs, reachGains, reachInfo, springShare, type ReachInfo } from "./flow";
import { STALE_MS, fetchLatest } from "./live";

/** Suwannee particles are thinned to this fraction so the big river doesn't drown out the Santa Fe. */
const SUWK = 0.5;
/** Particles spawned per cfs per second. */
const K = 0.03;
const MAX_PARTICLES = 26000;
const CONTOUR_LEVELS = [10, 20, 30, 40, 50, 60, 70, 80, 90];

interface River extends Polyline {
  name: string;
  u: (0 | 1)[];
  /** Tributaries drawn for context only, with no flow. */
  context: boolean;
  next?: { r: River; d: number };
}

interface Gauge extends GaugeConfig {
  cfs: number | null;
  est: boolean;
  xy: XY;
  /** Distance along its river. */
  d: number;
}

interface Spring {
  name: string;
  lon: number;
  lat: number;
  reach: Reach;
  xy: XY;
  r: River;
  d: number;
  /** Where its spring run meets the river, and how long that run is. */
  j: XY;
  leg: number;
  cfs: number;
  /** Stagger for the boil animation. */
  phase: number;
}

type Color = "t" | "s";
type Source =
  | { kind: "head"; r: River; d: number; cfs: number; col: Color; dim?: boolean; acc: number }
  | { kind: "diffuse"; r: River; d0: number; d1: number; cfs: number; col: Color; dim?: boolean; acc: number }
  | { kind: "spring"; sp: Spring; cfs: number; acc: number };

interface Particle {
  r: River;
  d: number;
  col: Color;
  dim: boolean;
  /** Sideways jitter so particles don't all ride the centerline. */
  off: number;
  sp?: Spring;
  leg?: number;
  under?: boolean;
}

interface Step {
  label: string;
  grid: string;
  mean: number;
  flows: Flows | null;
  est: FlowKey[];
  typical?: boolean;
  now?: boolean;
}

const timeFmt = (d: Date) => d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

async function main() {
  const [riversFile, contoursFile, aq, snapshot, lakesFile] = await Promise.all([
    loadData<RiversFile>("rivers.json"),
    loadData<ContoursFile>("contours.json"),
    loadData<AquiferFile>("aquifer.json"),
    loadData<Snapshot>("snapshot.json"),
    loadData<LakesFile>("lakes.json"),
    fontsReady(),
  ]);
  const lakes = decodeLakes(lakesFile);

  // ---------- geometry ----------
  const rivers: Record<string, River> = {};
  for (const [name, r] of Object.entries(riversFile.rivers)) {
    rivers[name] = { ...polyline(r.p.map(([x, y]) => project(x, y))), name, u: r.u, context: name === "New River" || name === "Olustee Creek" };
  }
  const SF = rivers["Santa Fe River"];
  const ICH = rivers["Ichetucknee River"];
  const SUW = rivers["Suwannee River"];
  const end = (r: River) => r.pts[r.pts.length - 1];
  SF.next = { r: SUW, d: nearestDistance(SUW, ...end(SF)) };
  ICH.next = { r: SF, d: nearestDistance(SF, ...end(ICH)) };

  /** Position and underground flag at distance d along a river. */
  const at = (r: River, d: number): [number, number, boolean] => {
    const { lo, hi } = locate(r, d);
    const p = pointAt(r, d);
    return [p[0], p[1], !!(r.u[lo] && r.u[hi])];
  };
  const ugIdx = SF.u.flatMap((f, i) => (f ? [i] : []));
  const ug0 = SF.cum[ugIdx[0]];
  const ug1 = SF.cum[ugIdx[ugIdx.length - 1]];
  const ugMid = pointAt(SF, (ug0 + ug1) / 2);

  const gauges: Gauge[] = (gaugeConfig as GaugeConfig[]).map((g) => {
    const xy = project(g.lon, g.lat);
    const river = rivers[g.river ?? "Suwannee River"];
    return { ...g, cfs: null, est: false, xy, d: nearestDistance(river, ...xy) };
  });
  const G = (k: FlowKey) => gauges.find((g) => g.key === k)!;

  /** The signed-in member's journal, drawn over the map; null for everyone else. */
  let journal: JournalOverlay | null = null;
  let showJournal = true;
  let journalSprings: { xy: XY; id: string }[] = [];
  const springs: Spring[] = SPRINGS.map(([name, lon, lat, reach], k) => {
    const xy = project(lon, lat);
    const r = reach === "ich" ? ICH : reach === "fan" ? SUW : SF;
    const d = nearestDistance(r, ...xy);
    const j = pointAt(r, d);
    return { name, lon, lat, reach, xy, r, d, j, leg: Math.hypot(j[0] - xy[0], j[1] - xy[1]), cfs: 0, phase: (k * 0.618) % 1 };
  });
  const springCounts: Partial<Record<Reach, number>> = {};
  for (const s of springs) springCounts[s.reach] = (springCounts[s.reach] ?? 0) + 1;

  const sinks = SINKS.map((s) => ({ ...s, xy: project(s.lon, s.lat) }));
  // Dye traces arc gently between sink and spring; they show a connection, not a route.
  const traces = TRACES.map((t) => {
    const a = sinks.find((k) => k.name === t.from)!.xy;
    const b = project(...t.to);
    const c: XY = [(a[0] + b[0]) / 2 - (b[1] - a[1]) * 0.18, (a[1] + b[1]) / 2 + (b[0] - a[0]) * 0.18];
    return { ...t, a, b, c };
  });
  const qb = (t: number, a: XY, c: XY, b: XY): XY => [
    (1 - t) ** 2 * a[0] + 2 * (1 - t) * t * c[0] + t * t * b[0],
    (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * c[1] + t * t * b[1],
  ];
  const contours2022 = contoursFile.contours.map((k) => ({ v: k.v, pts: k.p.map(([x, y]) => project(x, y)) }));

  // ---------- flows ----------
  /** Current readings: the saved snapshot until live readings arrive. */
  const current: Flows = { ...snapshot.cfs };
  let liveTime: Date | null = null;
  const liveMeta = new Map<FlowKey, { time: Date; stale: boolean }>();
  /** True while the map shows current readings rather than a historic year. */
  let showingNow = true;
  let sources: Source[] = [];
  let reaches: Partial<Record<Reach, ReachInfo>> = {};

  function setFlows(f: Flows, est: FlowKey[]) {
    for (const g of gauges) {
      g.cfs = f[g.key];
      g.est = est.includes(g.key);
    }
    buildSources(f);
  }

  function buildSources(f: Flows) {
    const v = (k: FlowKey) => f[k] ?? 0;
    const gain = reachGains(f);
    reaches = reachInfo(f, springCounts);
    const s: Source[] = [
      { kind: "head", r: SF, d: 0, cfs: v("W"), col: "t", acc: 0 },
      { kind: "diffuse", r: SF, d0: G("W").d, d1: G("O").d, cfs: Math.max(0, v("O") - v("W")), col: "t", acc: 0 },
      // Water that surfaces at River Rise beyond what sank at O'Leno is groundwater.
      { kind: "head", r: SF, d: ug1, cfs: Math.max(0, v("R") - v("O")), col: "s", acc: 0 },
    ];
    for (const sp of springs) {
      sp.cfs = sp.reach === "fan" ? v("Fn") : gain[sp.reach] / (springCounts[sp.reach] ?? 1);
      s.push({ kind: "spring", sp, cfs: sp.reach === "fan" ? sp.cfs * SUWK : sp.cfs, acc: 0 });
    }
    s.push({ kind: "head", r: SUW, d: 0, cfs: v("B") * SUWK, col: "t", dim: true, acc: 0 });
    s.push({ kind: "diffuse", r: SUW, d0: G("Bl").d, d1: G("Wx").d, cfs: Math.max(0, v("Wx") - v("Bl") - v("Fn")) * SUWK, col: "s", dim: true, acc: 0 });
    for (const x of s) x.acc = Math.random();
    sources = s;
  }

  // ---------- rendering ----------
  let C: Record<string, string> = {};
  let glow = true;
  const readColors = () => {
    C = Object.fromEntries(["bg", "ink", "muted", "tannin", "spring", "under", "river", "contour", "lake", "shore", "marsh"].map((n) => [n, cssVar(`--${n}`)]));
    C.t = C.tannin;
    C.s = C.spring;
    C.u = C.under;
    glow = isDark();
  };

  let aqMode = false;
  const card = new InfoCard();
  const view = new Viewport({
    minScale: 200,
    maxScale: 40000,
    padding: (w) => (w < 600 ? { x: 14, top: aqMode ? 14 : 64, bottom: 16 } : { x: 60, top: 50, bottom: 60 }),
    drawBase,
    onTap: tap,
  });
  const { X, Y } = view;
  const path = (c: CanvasRenderingContext2D, pts: XY[]) => {
    c.beginPath();
    pts.forEach((p, i) => (i ? c.lineTo(X(p[0]), Y(p[1])) : c.moveTo(X(p[0]), Y(p[1]))));
  };

  function drawBase() {
    const c = view.bctx;
    const { W, H } = view;
    c.setTransform(view.DPR, 0, 0, view.DPR, 0, 0);
    c.fillStyle = C.bg;
    c.fillRect(0, 0, W, H);
    if (aqMode) drawAquifer(c);
    else {
      c.lineWidth = 1;
      c.strokeStyle = C.contour;
      c.setLineDash([2, 5]);
      c.font = "500 11px 'Barlow Semi Condensed',sans-serif";
      c.fillStyle = C.muted;
      for (const k of contours2022) {
        path(c, k.pts);
        c.stroke();
        const m = k.pts[Math.floor(k.pts.length * 0.5)];
        const x = X(m[0]);
        const y = Y(m[1]);
        if (x > 40 && x < W - 40 && y > 80 && y < H - 10) {
          c.globalAlpha = 0.8;
          c.fillText(`${k.v} ft`, x + 3, y - 3);
          c.globalAlpha = 1;
        }
      }
      c.setLineDash([]);
    }
    drawLakes(c, lakes, X, Y, view.cam, { lake: C.lake, shore: C.shore, marsh: C.marsh, label: C.muted });
    c.lineCap = "round";
    c.lineJoin = "round";
    for (const r of Object.values(rivers)) {
      c.strokeStyle = C.river;
      if (r.context) {
        c.lineWidth = 1.2;
        path(c, r.pts);
        c.stroke();
        continue;
      }
      const width = r === SUW ? 5 : r === SF ? 3.2 : 2.4;
      // Surface stretches solid; the underground reach dashed, in the aquifer's color.
      for (const run of edgeRuns(r.u)) {
        if (run.flagged) {
          c.strokeStyle = C.u;
          c.globalAlpha = 0.55;
          c.lineWidth = 1.5;
          c.setLineDash([3, 4]);
        } else {
          c.strokeStyle = C.river;
          c.lineWidth = width;
        }
        path(c, r.pts.slice(run.from, run.to + 1));
        c.stroke();
        c.setLineDash([]);
        c.globalAlpha = 1;
      }
    }
    c.strokeStyle = C.u;
    c.lineWidth = 1.3;
    c.setLineDash([1, 5]);
    c.globalAlpha = 0.8;
    for (const t of traces) {
      c.beginPath();
      c.moveTo(X(t.a[0]), Y(t.a[1]));
      c.quadraticCurveTo(X(t.c[0]), Y(t.c[1]), X(t.b[0]), Y(t.b[1]));
      c.stroke();
      if (view.scale > 2200) {
        const m = qb(0.5, t.a, t.c, t.b);
        c.setLineDash([]);
        c.fillStyle = C.u;
        c.fillText(`dye trace, ${t.days}`, X(m[0]) + 6, Y(m[1]) + (t.days.startsWith("2") ? 12 : -4));
        c.setLineDash([1, 5]);
      }
    }
    c.setLineDash([]);
    c.globalAlpha = 1;
    c.strokeStyle = C.s;
    c.globalAlpha = 0.35;
    c.lineWidth = 1;
    for (const s of springs) {
      c.beginPath();
      c.moveTo(X(s.xy[0]), Y(s.xy[1]));
      c.lineTo(X(s.j[0]), Y(s.j[1]));
      c.stroke();
    }
    c.globalAlpha = 1;
    for (const s of sinks) {
      const x = X(s.xy[0]);
      const y = Y(s.xy[1]);
      c.strokeStyle = C.u;
      c.lineWidth = 1.6;
      c.beginPath();
      c.arc(x, y, 5.5, 0, 7);
      c.stroke();
      c.beginPath();
      c.arc(x, y, 2, 0, 7);
      c.fillStyle = C.u;
      c.fill();
      if (s.q) {
        c.font = "600 13px 'Spectral',serif";
        c.fillText("?", x + 8, y + 4);
      }
    }
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
    const label = (t: string, lon: number, lat: number, col: string) => {
      const p = project(lon, lat);
      c.font = "italic 400 14px 'Spectral',serif";
      c.fillStyle = col;
      c.fillText(t, X(p[0]), Y(p[1]));
    };
    if (journal && showJournal) drawJournal(c, journal, X, Y, journalSprings, C.ink, glow);
    drawLakeLabels(c, lakes, X, Y, view.scale, C.muted);
    label("Santa Fe River", -82.5, 29.965, C.t);
    label("Ichetucknee", -82.86, 30.0, C.s);
    label("Suwannee River", -83.0, 29.7, C.t);
    if (view.scale > 1400) {
      c.font = "italic 13px 'Spectral',serif";
      c.fillStyle = C.u;
      c.fillText("underground", X(ugMid[0]) + 8, Y(ugMid[1]));
    }
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
      c.font = "600 12px 'Barlow Semi Condensed',sans-serif";
      c.fillStyle = isStale(g) ? C.muted : C.ink;
      c.fillText(`${fmtCfs(g.cfs)} cfs${g.est ? " est." : ""}${g.spring ? " (spring)" : ""}`, x + 8, y + (g.spring ? 16 : -6));
    }
  }

  const isStale = (g: Gauge) => showingNow && !!liveMeta.get(g.key)?.stale;

  // ---------- particles ----------
  const parts: Particle[] = [];
  const traceDots: { t: (typeof traces)[number]; u: number }[] = [];
  const SPEED = SF.len / 60;

  function spawn(src: Source) {
    if (parts.length >= MAX_PARTICLES) return;
    const off = Math.random() - 0.5;
    if (src.kind === "head") parts.push({ r: src.r, d: src.d + Math.random() * SPEED * 0.05, col: src.col, dim: !!src.dim, off });
    else if (src.kind === "diffuse") parts.push({ r: src.r, d: src.d0 + Math.random() * (src.d1 - src.d0), col: src.col, dim: !!src.dim, off });
    else parts.push({ sp: src.sp, leg: 0, r: src.sp.r, d: src.sp.d, col: "s", dim: src.sp.reach === "fan", off });
  }

  function step(dt: number) {
    for (const s of sources) {
      s.acc += s.cfs * K * dt;
      while (s.acc >= 1) {
        s.acc -= 1;
        spawn(s);
      }
    }
    for (const t of traces) if (Math.random() < dt * 0.6) traceDots.push({ t, u: 0 });
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      // Spring water first runs down its spring run to the river.
      if (p.sp && p.leg! < 1) {
        p.leg! += (dt * SPEED) / Math.max(p.sp.leg, 1e-4);
        continue;
      }
      p.d += dt * SPEED * (p.under ? 1.4 : 1);
      if (p.d > p.r.len) {
        const next = p.r.next;
        if (!next || (next.r === SUW && Math.random() > SUWK)) {
          parts.splice(i, 1);
          continue;
        }
        p.d = next.d + (p.d - p.r.len);
        p.r = next.r;
      }
    }
    for (let i = traceDots.length - 1; i >= 0; i--) if ((traceDots[i].u += dt * 0.07) > 1) traceDots.splice(i, 1);
  }

  const streaks = new StreakLayer();
  // Streak groups: tannin, spring, underground; each bright or dim (the Suwannee).
  const GROUP = { t: 0, s: 2, u: 4 } as const;

  function draw() {
    const c = view.fctx;
    const { W, H } = view;
    const sc = view.scale;
    c.setTransform(view.DPR, 0, 0, view.DPR, 0, 0);
    // Faster fade when zoomed in keeps trails a similar length on screen.
    fadeLayer(c, W, H, Math.min(0.55, Math.max(0.2, 0.2 * Math.sqrt(sc / 1000))));
    const z = Math.min(2.6, Math.max(1.1, sc / 900));
    // Particle counts follow discharge, so the lower river is dozens of times
    // denser than the headwaters. Keep alpha low enough that additive glow
    // saturates toward the water's own color, not white.
    for (const [k, g] of Object.entries(GROUP) as [keyof typeof GROUP, number][]) {
      const under = k === "u";
      streaks.style(g, C[k], under ? 0.5 : glow ? 0.34 : 0.85, under ? z * 0.7 : z);
      streaks.style(g + 1, C[k], glow ? 0.1 : 0.35, z * 1.15);
    }
    streaks.begin();
    const jitter = 0.00045;
    const tailPx = Math.min(7, Math.max(1.2, SPEED * sc * 0.12));
    for (const p of parts) {
      let hx: number, hy: number, tx: number, ty: number;
      let u = false;
      if (p.sp && p.leg! < 1) {
        // Still running down its spring run toward the river.
        const s = p.sp;
        const k0 = Math.max(0, p.leg! - tailPx / sc / Math.max(s.leg, 1e-4));
        hx = s.xy[0] + (s.j[0] - s.xy[0]) * p.leg!;
        hy = s.xy[1] + (s.j[1] - s.xy[1]) * p.leg!;
        tx = s.xy[0] + (s.j[0] - s.xy[0]) * k0;
        ty = s.xy[1] + (s.j[1] - s.xy[1]) * k0;
      } else {
        [hx, hy, u] = at(p.r, p.d);
        p.under = u;
        [tx, ty] = at(p.r, Math.max(0, p.d - (tailPx * (u ? 1.4 : 1)) / sc));
      }
      const w = p.r === SUW ? jitter * 3 : jitter * (p.r === SF ? 1.6 : 1);
      const ox = p.off * w * sc;
      const oy = p.off * w * sc * 0.6;
      const sx = X(hx) + ox;
      const sy = Y(hy) + oy;
      if (sx < -10 || sy < -10 || sx > W + 10 || sy > H + 10) continue;
      const g = u ? GROUP.u : GROUP[p.col];
      streaks.add(g + (!u && (p.dim || p.r === SUW) ? 1 : 0), X(tx) + ox, Y(ty) + oy, sx, sy);
    }
    streaks.flush(c, glow);
    c.globalAlpha = 0.9;
    c.fillStyle = C.u;
    for (const tp of traceDots) {
      const q = qb(tp.u, tp.t.a, tp.t.c, tp.t.b);
      c.fillRect(X(q[0]) - 1, Y(q[1]) - 1, 2, 2);
    }
    const now = performance.now() / 1000;
    const zs = Math.min(1, sc / 3000);
    // Boils sized by each spring's share of its reach's gain.
    for (const s of springs) drawBoil(c, X(s.xy[0]), Y(s.xy[1]), 1.6 + Math.sqrt(s.cfs || 1) * 0.3 * zs, s.phase, now, C.s);
    c.globalAlpha = 1;
  }

  function refill(seconds: number, dt: number) {
    parts.length = 0;
    traceDots.length = 0;
    for (const s of sources) s.acc = Math.random();
    for (let t = 0; t < seconds; t += dt) step(dt);
    view.clearFx();
  }

  // ---------- cards ----------
  function tap(x: number, y: number) {
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
    springs.forEach((s) => test(s.xy, () => showSpring(s)));
    sinks.forEach((s) => test(s.xy, () => card.show({ title: s.name, kind: s.kind, body: s.text })));
    if (best) (best as () => void)();
    else card.hide();
  }

  function showGauge(g: Gauge) {
    const kind = `USGS gauge ${g.id}`;
    if (g.cfs == null) {
      card.show({ title: g.short, kind, body: "No daily record for this year at this gauge." });
      return;
    }
    const meta = showingNow ? liveMeta.get(g.key) : undefined;
    let body = `${fmtCfs(g.cfs)} cubic feet per second${meta ? `, ${timeFmt(meta.time)}` : ""}.`;
    if (meta?.stale) body += " This gauge hasn't reported recently, so treat it as old.";
    if (g.key === "R") body += " The river reappears here after running underground, carrying more water than went in at O'Leno.";
    card.show({ title: g.short.includes("@") || g.spring ? g.short : `Santa Fe at ${g.short}`, kind, body });
  }

  function showSpring(s: Spring) {
    const id = journal?.nearestSpring(s.lon, s.lat)?.[0];
    const log = journal && id ? ` ${journalCardHtml(journal, id)}` : "";
    if (s.reach === "fan") {
      card.show({ title: s.name, kind: "Gauged spring on the Suwannee", body: `${fmtCfs(G("Fn").cfs)} cfs, measured directly by USGS.${log}` });
      return;
    }
    const ri = reaches[s.reach]!;
    card.show({
      title: s.name,
      kind: "Spring",
      body: `The ${s.reach === "ich" ? "Ichetucknee" : "Santa Fe"} gained ${fmtCfs(ri.gain)} cfs between ${ri.a} and ${ri.b}${ri.note ? `, ${ri.note}` : ""}. Individual springs here aren't gauged, so the map spreads that gain evenly across the ${ri.n} mapped springs, about ${fmtCfs(ri.gain / ri.n)} cfs each.${log}`,
    });
  }

  // ---------- gauge strip + copy ----------
  function renderProfile() {
    const el = document.getElementById("profile")!;
    el.replaceChildren();
    const button = (cls: string, html: string, onClick: () => void) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = cls;
      b.innerHTML = html;
      b.addEventListener("click", onClick);
      el.appendChild(b);
    };
    for (const g of gauges) {
      if (g.spring) continue;
      button(`gauge${isStale(g) ? " stale" : ""}`, `<div class="v">${fmtCfs(g.cfs)}${g.est ? '<span class="e">est.</span>' : ""}</div><div class="n">${g.short}</div>`, () => {
        view.flyTo(g.xy, g.river === "Suwannee River" ? 1400 : 2600);
        showGauge(g);
      });
      // The river vanishes between O'Leno and River Rise.
      if (g.key === "O") {
        button("gauge under", `<div class="v">underground</div><div class="n">River Sink → Rise</div>`, () => {
          view.flyTo(ugMid, 2600);
          card.show({ title: "River Sink to River Rise", kind: "Underground reach", body: UNDERGROUND_TEXT });
        });
      }
    }
  }

  const snapLabel = new Date(snapshot.time).toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  function renderCopy(state: "checking" | "live" | "snapshot") {
    const w = G("W").cfs ?? 0;
    const h = G("H").cfs ?? 0;
    document.getElementById("lede")!.innerHTML = `The river carries <b>${fmtCfs(w)} cfs</b> past Worthington Springs and <b>${fmtCfs(h)} cfs</b> near Hildreth, about ${Math.round(h / w)} times as much. Most of that rises from springs. Tap anything on the map.`;
    const contours = `Groundwater contours from FGS, ${aq.now.grid}.`;
    document.getElementById("status")!.textContent =
      state === "live" ? `Live USGS readings, updated ${timeFmt(liveTime!)}. Units are cubic feet per second (cfs). ${contours}`
      : state === "checking" ? `USGS readings from ${snapLabel}. Checking for live readings… ${contours}`
      : `USGS readings from ${snapLabel}. Live readings didn't load, so this is a saved snapshot. ${contours}`;
  }

  // ---------- aquifer over time ----------
  const grids = Object.fromEntries(Object.entries(aq.grids).map(([k, b64]) => [k, decodeGrid(b64)]));
  const { nx: NX, ny: NY } = aq.grid;
  const steps: Step[] = [...aq.steps, { label: "Now", grid: aq.now.grid, mean: aq.now.mean, flows: null, est: [], now: true }];
  const last = steps.length - 1;
  let aqPos = last;
  let aqIdx = -1;
  const surf = document.createElement("canvas");
  surf.width = NX;
  surf.height = NY;
  const sctx = surf.getContext("2d")!;
  let curZ: Float32Array | null = null;
  let curContours: ContourLine[] = [];

  const flowsFor = (st: Step): Flows => (st.now ? current : st.flows!);

  function blendAt(pos: number) {
    const i = Math.floor(pos);
    const j = Math.min(last, i + 1);
    return blend(grids[steps[i].grid], grids[steps[j].grid], pos - i);
  }

  function paintSurface(z: Float32Array) {
    curZ = z;
    sctx.putImageData(new ImageData(colorize(z, NX, NY, isDark()), NX, NY), 0, 0);
    curContours = contour(z, aq.grid, CONTOUR_LEVELS);
  }

  function drawAquifer(c: CanvasRenderingContext2D) {
    if (!curZ) return;
    const { W, H } = view;
    const h = aq.grid.res / 2;
    const a = project(aq.grid.lon0 - h, aq.grid.lat0 + (NY - 1) * aq.grid.res + h);
    const b = project(aq.grid.lon0 + (NX - 1) * aq.grid.res + h, aq.grid.lat0 - h);
    c.imageSmoothingEnabled = true;
    c.globalAlpha = 0.9;
    c.drawImage(surf, X(a[0]), Y(a[1]), X(b[0]) - X(a[0]), Y(b[1]) - Y(a[1]));
    c.strokeStyle = C.muted;
    c.lineWidth = 1;
    c.font = "500 11px 'Barlow Semi Condensed',sans-serif";
    c.fillStyle = C.muted;
    for (const line of curContours) {
      c.globalAlpha = 0.55;
      c.beginPath();
      for (const [p, q] of line.segs) {
        const pp = project(...p);
        const qq = project(...q);
        c.moveTo(X(pp[0]), Y(pp[1]));
        c.lineTo(X(qq[0]), Y(qq[1]));
      }
      c.stroke();
      for (const l of line.labels) {
        const p = project(...l);
        const x = X(p[0]);
        const y = Y(p[1]);
        if (x > 30 && x < W - 60 && y > 60 && y < H - 200) {
          c.globalAlpha = 0.9;
          c.fillText(`${line.level} ft`, x + 3, y - 3);
          break;
        }
      }
    }
    c.globalAlpha = 1;
  }

  function setStep(i: number, force = false) {
    if (i === aqIdx && !force) return;
    aqIdx = i;
    const st = steps[i];
    showingNow = !!st.now;
    setFlows(flowsFor(st), st.est);
    refill(SF.len / SPEED + 8, 0.4);
    renderProfile();
    renderPanel();
    drawBase();
  }

  let settle: ReturnType<typeof setTimeout> | undefined;
  function onPos(pos: number, immediate = false) {
    aqPos = pos;
    paintSurface(blendAt(pos));
    view.redraw();
    const i = Math.round(pos);
    renderPanelHead(i);
    // Rebuilding particles is the slow part, so wait until the slider settles.
    clearTimeout(settle);
    if (immediate) setStep(i);
    else settle = setTimeout(() => setStep(i), 160);
  }

  function renderPanelHead(i: number) {
    const st = steps[i];
    document.getElementById("aqYear")!.textContent = st.label;
    const f = flowsFor(st);
    let s = st.now
      ? `${liveTime ? "Live river readings" : `River readings from ${snapLabel}`} over the latest published aquifer map, from ${aq.now.grid}. `
      : st.typical ? "USGS's reconstruction of the aquifer before large-scale pumping. No gauges existed then, so the river shows a typical May: the median of every May on record. "
      : "";
    s += `Worthington Springs: <b>${fmtCfs(f.W)} cfs</b>. Fort White: <b>${fmtCfs(f.F)} cfs</b>, with about <b>${Math.round(springShare(f) * 100)}%</b> of it entering below O'Leno, mostly through springs.`;
    if ((f.W ?? 0) < 5) s += " The upper river nearly stopped; the springs kept the lower Santa Fe running.";
    document.getElementById("aqRead")!.innerHTML = s;
  }

  function renderPanel() {
    const i = Math.round(aqPos);
    renderPanelHead(i);
    document.getElementById("status")!.textContent = steps[i].now
      ? `Current USGS readings over the ${aq.now.grid} aquifer map (FGS).`
      : "River flows: USGS daily records, averaged for the month shown. Aquifer: USGS and FGS potentiometric-surface maps.";
    const n = steps.length;
    const means = steps.map((s) => s.mean);
    const fw = steps.map((s) => flowsFor(s).F ?? 0);
    const scale = (arr: number[]) => {
      const lo = Math.min(...arr);
      const hi = Math.max(...arr);
      return (v: number) => 52 - ((v - lo) / (hi - lo || 1)) * 46;
    };
    const x = (k: number) => 4 + k * (292 / (n - 1));
    const line = (arr: number[], sy: (v: number) => number, col: string) =>
      `<polyline fill="none" stroke="${col}" stroke-width="1.6" vector-effect="non-scaling-stroke" points="${arr.map((v, k) => `${x(k)},${sy(v)}`).join(" ")}"/>`;
    const cx = x(aqPos);
    document.getElementById("spark")!.innerHTML =
      line(means, scale(means), C.u) + line(fw, scale(fw), C.s) +
      `<line x1="${cx}" x2="${cx}" y1="0" y2="58" stroke="${C.ink}" stroke-width="1" vector-effect="non-scaling-stroke" opacity=".6"/>`;
  }

  const slider = document.getElementById("aqSlider") as HTMLInputElement;
  slider.max = String(last);
  slider.value = String(aqPos);
  slider.addEventListener("input", () => {
    stopPlay();
    onPos(+slider.value);
  });
  slider.addEventListener("change", () => {
    const i = Math.round(+slider.value);
    slider.value = String(i);
    onPos(i, true);
  });

  const bAq = document.getElementById("bAq")!;
  const bPlay = document.getElementById("aqPlay")!;
  bAq.addEventListener("click", () => {
    aqMode = !aqMode;
    bAq.setAttribute("aria-pressed", String(aqMode));
    document.getElementById("aq")!.classList.toggle("on", aqMode);
    document.body.classList.toggle("aq", aqMode);
    card.hide();
    // The panel changes the layout; measure after it settles.
    requestAnimationFrame(() => {
      view.resize();
      view.fit(VIEWS.all);
    });
    if (aqMode) {
      aqIdx = -1;
      onPos(aqPos, true);
    } else {
      stopPlay();
      showingNow = true;
      setFlows(current, []);
      refill(SF.len / SPEED + 8, 0.4);
      renderProfile();
      renderCopy(liveTime ? "live" : "snapshot");
      drawBase();
    }
  });

  let playing = false;
  let playFrame = 0;
  function stopPlay() {
    playing = false;
    bPlay.textContent = "Play";
    cancelAnimationFrame(playFrame);
  }
  bPlay.addEventListener("click", () => {
    if (playing) return stopPlay();
    playing = true;
    bPlay.textContent = "Stop";
    if (aqPos >= last - 0.01) aqPos = 0;
    const t0 = performance.now();
    const p0 = aqPos;
    const tick = (t: number) => {
      if (!playing) return;
      const p = Math.min(last, p0 + ((t - t0) / 1000) * 0.7);
      slider.value = String(p);
      onPos(p);
      renderPanel();
      if (p >= last) {
        stopPlay();
        onPos(last, true);
        return;
      }
      playFrame = requestAnimationFrame(tick);
    };
    playFrame = requestAnimationFrame(tick);
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
    if (aqMode) {
      // Re-apply the step on screen: "Now" picks up the live values, a historic year keeps its own.
      setStep(Math.round(aqPos), true);
      return;
    }
    setFlows(current, []);
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
  document.getElementById("bSprings")!.addEventListener("click", () => view.fit(VIEWS.springs, true));
  document.getElementById("bGnv")!.addEventListener("click", () => view.fit(VIEWS.gnv, true));

  readColors();
  setFlows(current, []);
  renderProfile();
  renderCopy("checking");
  view.resize();
  view.fit(VIEWS.all);
  // Warm start: run the river long enough that it's full end to end on first paint.
  for (let t = 0; t < SF.len / SPEED + 10; t += 0.1) step(0.1);
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
  });
  onColorSchemeChange(() => {
    readColors();
    if (curZ) paintSurface(curZ);
    view.redraw();
    if (aqMode) renderPanel();
  });
  void loadJournalOverlay().then((o) => {
    if (!o) return;
    journal = o;
    journalSprings = springs.flatMap((s) => {
      const hit = o.nearestSpring(s.lon, s.lat);
      return hit ? [{ xy: s.xy, id: hit[0] }] : [];
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
    if (!aqMode) renderCopy("snapshot");
  });
}

main().catch(showLoadError);
