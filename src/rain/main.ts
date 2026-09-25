import "../shared/map.css";
import "./rain.css";
import { InfoCard } from "../shared/card";
import { escapeHtml, loadData, showLoadError } from "../shared/data";
import { KM_PER_UNIT, bounds, pointAt, project, type XY } from "../shared/geo";
import { drawJournal, journalCardHtml, loadJournalOverlay, type JournalOverlay } from "../shared/journal-overlay";
import { decodeLakes, drawLakeLabels, drawLakes, inLake } from "../shared/lakes";
import { StreakLayer, drawBoil, fadeLayer } from "../shared/streaks";
import { cssVar, fontsReady, isDark, onColorSchemeChange } from "../shared/theme";
import { Fate, type LakesFile, type StreamsFile } from "../shared/types";
import { Viewport, startLoop } from "../shared/viewport";
import { decodeSegments, fateShares, sinkLabels, traceDownstream, type Segment, type Trace } from "./network";

const FATES = [
  { v: "--gulf", label: "Reaches the Gulf", via: "Flows to the Gulf of Mexico." },
  { v: "--atl", label: "Reaches the Atlantic", via: "Flows to the Ocklawaha River, then north along the St. Johns to the Atlantic. Water from Gainesville's east side passes through Orange Lake first, and some of it leaves through sinks on the way." },
  { v: "--sink", label: "Drops into a sink", via: "Ends at a mapped sink and goes straight into the Floridan aquifer." },
  { v: "--inland", label: "Ends inland", via: "Ends with no mapped outlet. That's usually a sink, a closed wetland, or a lake with no surface exit, but it can also be a gap in the map." },
  { v: "--off", label: "Leaves the map", via: "Flows off the edge of this map and ends somewhere beyond it." },
];

const VIEWS = {
  all: bounds(-83.3, 28.75, -81.33, 30.5),
  gnv: bounds(-82.48, 29.57, -82.22, 29.72),
  ala: bounds(-82.62, 29.72, -82.36, 29.9),
  spr: bounds(-82.8, 29.8, -82.55, 29.95),
  msw: bounds(-83.3, 29.92, -82.85, 30.5),
  gulf: bounds(-83.25, 29.25, -82.75, 29.65),
  rbw: bounds(-82.8, 28.75, -82.35, 29.15),
  stj: bounds(-82.12, 29.14, -81.52, 29.56),
  ock: bounds(-82.1, 28.75, -81.5, 29.25),
  atl: bounds(-81.92, 29.44, -81.3, 30.46),
};

/** Town names, and the zoom (pixels per map unit) below which smaller ones are hidden. */
const PLACES: [name: string, lon: number, lat: number, minScale?: number][] = [
  ["Gainesville", -82.325, 29.665], ["High Springs", -82.585, 29.815], ["Alachua", -82.47, 29.752],
  ["Fort White", -82.713, 29.905], ["Lake City", -82.64, 30.085], ["Newberry", -82.61, 29.646],
  ["Ocala", -82.14, 29.187], ["Silver Springs", -82.03, 29.235], ["Welaka", -81.672, 29.48],
  ["Palatka", -81.637, 29.648], ["Jacksonville", -81.656, 30.332], ["Dunnellon", -82.461, 29.049],
  ["Live Oak", -82.984, 30.295, 1500], ["Mayo", -83.175, 30.053, 1500], ["Branford", -82.928, 29.96, 1500],
  ["White Springs", -82.759, 30.33, 1500], ["Chiefland", -82.86, 29.475, 1500], ["Cedar Key", -83.035, 29.138, 1500],
  ["Williston", -82.447, 29.387, 1500], ["Crystal River", -82.593, 28.902, 1500], ["Inverness", -82.33, 28.836, 1500],
  ["Leesburg", -81.878, 28.811, 1500],
];

/** How a Gulf- or Atlantic-bound creek's water gets to the sea, by the rivers on its path. */
function seaway(s0: Segment, trace: Trace): string {
  if (s0.fate === Fate.Atlantic) {
    return trace.path.some((s) => s.name === "Ocklawaha River") ? FATES[Fate.Atlantic].via : "Flows to the St. Johns River, then north along it to the Atlantic.";
  }
  // The last named river before the coast: the Suwannee, the Withlacoochee, Crystal River...
  let outlet: string | null = null;
  for (let i = trace.path.length - 1; i >= 0 && !outlet; i--) outlet = trace.path[i].name;
  return outlet ? `Flows down the ${escapeHtml(outlet)} to the Gulf of Mexico.` : FATES[Fate.Gulf].via;
}

/** Boil size by spring magnitude (index), so first-magnitude springs read as the giants they are. */
const MAG_SIZE = [1, 2, 1.45, 1.15, 1, 1, 1, 1, 1];
const MAG_TEXT = [
  "",
  "A first-magnitude spring: more than 100 cubic feet of water a second, about 65 million gallons a day. ",
  "A second-magnitude spring, flowing 10 to 100 cubic feet a second. ",
  "A third-magnitude spring, flowing 1 to 10 cubic feet a second. ",
];

/**
 * Rain drops per second per km of creek, so every creek gets the same rain however
 * big the map grows. Most drops merge into a bigger stream within seconds, so only a
 * few thousand are alive at once; the cap is a safety net.
 */
const RAIN_PER_KM = 0.0456;
const MAX_PARTICLES = 26000;
/** Speed of a drop on a headwater creek, in map units (about 111 km) a second. Rivers run faster. */
const BASE_SPEED = 0.0323;
/** Share of drops reaching a river mouth that ripple out into the sea. */
const SEA_RIPPLE_CHANCE = 0.08;
/** Creek line widths are rounded to this many pixels so they can be drawn in batches. */
const WIDTH_STEP = 0.1;

const Line = { Surface: 0, ThroughLake: 1, Underground: 2 } as const;
type Line = (typeof Line)[keyof typeof Line];
/** Every creek drawn in one line style, as one path in map units. */
interface StrokeGroup {
  width: number;
  fate: Fate;
  kind: Line;
  path: Path2D;
}
/**
 * When a drop flows into a bigger size class of stream, only this share keeps
 * going (drawn heavier); the rest merge into it. Volume is conserved on
 * average, and big rivers show distinct moving drops instead of a solid smear.
 */
const MERGE_KEEP = 0.3;
/** Share of new drops that leave a ripple where they land. */
const RIPPLE_CHANCE = 0.1;
/** Sinks draining more than this accumulation (km of creek) are labeled at every zoom. */
const BIG_SINK_ACC = 15;

async function main() {
  const [data, lakesFile] = await Promise.all([loadData<StreamsFile>("streams.json"), loadData<LakesFile>("lakes.json"), fontsReady()]);
  const segs = decodeSegments(data);
  const lakes = decodeLakes(lakesFile);
  const springs = data.springs.map(([lon, lat, name, mag, id]) => ({ xy: project(lon, lat), name, mag, id, phase: (((lon * 97.3 + lat * 41.1) % 1) + 1) % 1 }));
  /** The signed-in member's journal, drawn over the map; null for everyone else. */
  let journal: JournalOverlay | null = null;
  let showJournal = true;
  const swallets = data.swallets.map(([lon, lat, name]) => ({ xy: project(lon, lat), name }));
  const pct = fateShares(segs);
  const sinks = sinkLabels(segs);
  // NHD draws virtual "artificial path" channels across lakes. The lake fill already
  // shows that water, so those lines stay faint; drops still flow along them. (Wide
  // rivers like the Suwannee are artificial paths too, so test against the lakes.)
  const throughLake = new Set(segs.filter((s) => s.artificial && inLake(lakes, pointAt(s, s.len / 2))));
  // The base layer redraws on every pan and zoom frame, so creeks are batched: one
  // Path2D per line style, built once in map units and drawn through the camera
  // transform. Small creeks come first so rivers sit on top.
  const strokeGroups = (() => {
    const groups = new Map<string, StrokeGroup>();
    for (const s of segs) {
      const width = Math.round((0.45 + Math.log10(s.acc + 1) * 0.75) / WIDTH_STEP) * WIDTH_STEP;
      const kind = s.underground ? Line.Underground : throughLake.has(s) ? Line.ThroughLake : Line.Surface;
      const key = `${width}|${s.fate}|${kind}`;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { width, fate: s.fate, kind, path: new Path2D() }));
      s.pts.forEach((p, i) => (i ? g.path.lineTo(p[0], p[1]) : g.path.moveTo(p[0], p[1])));
    }
    return [...groups.values()].sort((a, b) => a.width - b.width);
  })();
  // Big rivers run faster than headwater creeks: speed grows with the log of upstream length.
  const vel = Float32Array.from(segs, (s) => BASE_SPEED * (0.45 + 0.32 * Math.log10(s.acc + 1)));
  /** 0 creek, 1 stream, 2 river, by km of creek upstream. */
  const sizeClass = Uint8Array.from(segs, (s) => (s.acc < 15 ? 0 : s.acc < 150 ? 1 : 2));

  document.getElementById("lede")!.innerHTML =
    `Every mapped creek in north Florida's springs belt, from the middle Suwannee to Rainbow River and the Ocklawaha, colored by where its water ends up, ` +
    `and followed down the rivers to the sea. ` +
    `<b>${Math.round(pct[Fate.Gulf])}%</b> of creek length drains to the Gulf and <b>${Math.round(pct[Fate.Atlantic])}%</b> to the Atlantic. ` +
    `The other <b>${Math.round(pct[Fate.Sink] + pct[Fate.Inland])}%</b> never reaches a river: it ends inland, in a sink, a closed wetland, ` +
    `or a lake with no outlet, and much of that water goes into the aquifer.`;
  document.getElementById("legend")!.innerHTML =
    FATES.slice(0, 4).map((f, i) => `<span><i style="background:var(${f.v})"></i>${f.label} <em>${Math.round(pct[i])}%</em></span>`).join("") +
    `<span><i class="dot"></i>Spring</span>`;

  let C: Record<string, string> = {};
  let FC: string[] = [];
  let glow = true;
  const readColors = () => {
    C = Object.fromEntries(["bg", "ink", "muted", "spring", "hi", "line", "sea", "lake", "shore", "marsh"].map((n) => [n, cssVar(`--${n}`)]));
    FC = FATES.map((f) => cssVar(f.v));
    glow = isDark();
  };

  let selected: Trace | null = null;
  let tracer: { d: number; total: number; v: number; rest: number } | null = null;
  const card = new InfoCard();
  card.onShow = () => (document.getElementById("hint")!.style.display = "none");
  card.onHide = () => select(null);

  const view = new Viewport({
    minScale: 150,
    maxScale: 60000,
    padding: (w) => {
      const p = w < 600 ? 10 : 40;
      return { x: p, top: p, bottom: p };
    },
    drawBase,
    onTap: tap,
  });
  const { X, Y } = view;

  function strokePath(c: CanvasRenderingContext2D, pts: XY[]) {
    pts.forEach((p, i) => (i ? c.lineTo(X(p[0]), Y(p[1])) : c.moveTo(X(p[0]), Y(p[1]))));
  }

  function sinkRing(c: CanvasRenderingContext2D, x: number, y: number, name: string, labeled: boolean) {
    c.strokeStyle = FC[Fate.Sink];
    c.lineWidth = 1.5;
    c.beginPath();
    c.arc(x, y, 4.5, 0, 7);
    c.stroke();
    if (labeled) {
      c.fillStyle = FC[Fate.Sink];
      c.fillText(name, x + 7, y + 4);
    }
  }

  function drawBase() {
    const c = view.bctx;
    const { W, H } = view;
    c.setTransform(view.DPR, 0, 0, view.DPR, 0, 0);
    c.fillStyle = C.bg;
    c.fillRect(0, 0, W, H);
    drawLakes(c, lakes, X, Y, view.cam, { sea: C.sea, lake: C.lake, shore: C.shore, marsh: C.marsh, label: C.muted });
    c.lineCap = "round";
    c.lineJoin = "round";
    const zs = Math.max(0.6, Math.min(2.2, view.scale / 1500));
    // Paths are in map units, so widths and dashes are divided by the scale to stay in pixels.
    const { s: k, tx, ty } = view.cam;
    c.setTransform(view.DPR * k, 0, 0, view.DPR * k, view.DPR * tx, view.DPR * ty);
    for (const g of strokeGroups) {
      c.lineWidth = (g.width * zs) / k;
      c.strokeStyle = FC[g.fate];
      c.globalAlpha = g.kind === Line.Underground ? 0.4 : g.kind === Line.ThroughLake ? 0.1 : glow ? 0.3 : 0.26;
      c.setLineDash(g.kind === Line.Underground ? [3 / k, 4 / k] : []);
      c.stroke(g.path);
    }
    c.setLineDash([]);
    c.setTransform(view.DPR, 0, 0, view.DPR, 0, 0);
    c.globalAlpha = 1;
    if (selected) {
      c.strokeStyle = C.hi;
      c.globalAlpha = 0.7;
      c.lineWidth = 2;
      c.beginPath();
      for (const s of selected.path) strokePath(c, s.pts);
      c.stroke();
      c.globalAlpha = 1;
      c.beginPath();
      c.arc(X(selected.end[0]), Y(selected.end[1]), 6, 0, 7);
      c.stroke();
    }
    if (journal && showJournal) drawJournal(c, journal, X, Y, springs, C.ink, glow);
    drawLakeLabels(c, lakes, X, Y, view.scale, C.muted);
    c.font = "500 12px 'Barlow Semi Condensed',sans-serif";
    const onScreen = (x: number, y: number) => x >= 0 && y >= 0 && x <= W && y <= H;
    for (const s of sinks) {
      const x = X(s.xy[0]);
      const y = Y(s.xy[1]);
      if (onScreen(x, y)) sinkRing(c, x, y, s.name, view.scale > 1600 || s.acc > BIG_SINK_ACC);
    }
    for (const s of swallets) {
      const x = X(s.xy[0]);
      const y = Y(s.xy[1]);
      if (onScreen(x, y)) sinkRing(c, x, y, s.name, view.scale > 1600);
    }
    c.fillStyle = C.muted;
    for (const [n, lon, lat, min = 0] of PLACES) {
      if (view.scale < min) continue;
      const p = project(lon, lat);
      c.fillText(n, X(p[0]), Y(p[1]));
    }
    c.font = "italic 14px 'Spectral',serif";
    const label = (t: string, lon: number, lat: number, col: string) => {
      const p = project(lon, lat);
      c.fillStyle = col;
      c.fillText(t, X(p[0]), Y(p[1]));
    };
    label("Suwannee", -82.99, 29.7, FC[Fate.Gulf]);
    label("Santa Fe", -82.47, 29.93, FC[Fate.Gulf]);
    label("Paynes Prairie", -82.33, 29.585, FC[Fate.Sink]);
    label("Suwannee", -83.14, 30.25, FC[Fate.Gulf]);
    label("Withlacoochee", -82.72, 28.95, FC[Fate.Gulf]);
    label("Ocklawaha", -81.99, 29.37, FC[Fate.Atlantic]);
    label("St. Johns", -81.63, 29.54, FC[Fate.Atlantic]);
    label("St. Johns", -81.62, 30.1, FC[Fate.Atlantic]);
    // Sea names sit in open water, clear of the coast. Each has spots to try in order:
    // well offshore when the screen is wide, nearer the coast when it isn't. On a phone
    // there's little sea on screen, so use the short name; skip it if nothing fits.
    const seaLabel = (full: string, short: string, spots: [number, number][]) => {
      const t = W < 600 ? short : full;
      const w = c.measureText(t).width;
      for (const [lon, lat] of spots) {
        const p = project(lon, lat);
        const x = X(p[0]);
        const y = Y(p[1]);
        if (x < 0 || y < 0 || y > H || x + w > W) continue;
        c.fillStyle = C.muted;
        c.fillText(t, x, y);
        return;
      }
    };
    seaLabel("Gulf of Mexico", "Gulf", [[-83.8, 29.35], [-83.3, 28.95]]);
    seaLabel("Atlantic Ocean", "Atlantic", [[-81.3, 30.06]]);
  }

  // ----- particles: rain falls on every creek, weighted by length -----
  // Rain on a big river starts as an already-merged drop, so it's spawned less often.
  // None falls on the route to the sea: those rivers only carry the map's water out.
  const cumLen: number[] = [];
  let totalLen = 0;
  segs.forEach((s, i) => cumLen.push((totalLen += s.route ? 0 : s.len * MERGE_KEEP ** sizeClass[i])));
  const rate = RAIN_PER_KM * segs.reduce((km, s) => km + (s.route ? 0 : s.len * KM_PER_UNIT), 0);
  const pickSeg = () => {
    const r = Math.random() * totalLen;
    let lo = 0;
    let hi = cumLen.length - 1;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (cumLen[m] < r) lo = m + 1;
      else hi = m;
    }
    return lo;
  };
  const parts: { s: number; d: number; f: Fate }[] = [];
  const flashes: { xy: XY; t: number; col: string; big: boolean }[] = [];
  const ripples: { xy: XY; t: number; f: Fate }[] = [];
  let spawnAcc = 0;

  function step(dt: number, fresh = true) {
    spawnAcc += rate * dt;
    while (spawnAcc >= 1) {
      spawnAcc--;
      if (parts.length < MAX_PARTICLES) {
        const i = pickSeg();
        const d = Math.random() * segs[i].len;
        parts.push({ s: i, d, f: segs[i].fate });
        if (fresh && ripples.length < 80 && Math.random() < RIPPLE_CHANCE) ripples.push({ xy: pointAt(segs[i], d), t: 0, f: segs[i].fate });
      }
    }
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.d += vel[p.s] * dt;
      let s = segs[p.s];
      for (let hops = 0; p.d > s.len && hops < 6; hops++) {
        if (s.next >= 0) {
          if (sizeClass[s.next] > sizeClass[p.s] && Math.random() > MERGE_KEEP) {
            parts.splice(i, 1);
            break;
          }
          p.d -= s.len;
          p.s = s.next;
          s = segs[p.s];
        } else {
          const flash = s.mouth ? SEA_RIPPLE_CHANCE : s.fate === Fate.Sink || s.fate === Fate.Inland ? 0.15 : 0;
          if (Math.random() < flash) flashes.push({ xy: s.pts[s.pts.length - 1], t: 0, col: FC[s.fate], big: false });
          parts.splice(i, 1);
          break;
        }
      }
    }
    for (let i = flashes.length - 1; i >= 0; i--) if ((flashes[i].t += dt) > 1.2) flashes.splice(i, 1);
    for (let i = ripples.length - 1; i >= 0; i--) if ((ripples[i].t += dt) > 0.9) ripples.splice(i, 1);
    if (tracer) advanceTracer(dt);
  }

  const streaks = new StreakLayer();
  function draw() {
    const c = view.fctx;
    const { W, H } = view;
    c.setTransform(view.DPR, 0, 0, view.DPR, 0, 0);
    const sc = view.scale;
    // On-screen speed grows with zoom; fade faster when zoomed in so trails keep
    // a similar length in pixels instead of merging into a solid line.
    fadeLayer(c, W, H, Math.min(0.6, Math.max(0.24, 0.24 * Math.sqrt(sc / 1100))));
    const z = Math.min(2.2, Math.max(1, sc / 1200));
    // Every drop upstream funnels into the big rivers, so their streaks overlap
    // many times. Draw them wider and fainter so the glow builds into a ribbon
    // that keeps its color instead of blowing out to white.
    for (let f = 0; f < 5; f++) {
      // Additive blending pushes pale colors to white fastest; hold those back
      // so gray "ends inland" creeks recede and lavender sinks stay lavender.
      const muted = glow ? [1, 0.8, 0.75, 0.5, 0.5][f] : 1;
      for (let k = 0; k < 3; k++) {
        const g = (f * 3 + k) * 2;
        streaks.style(g, FC[f], (glow ? [0.8, 0.62, 0.5] : [0.9, 0.8, 0.7])[k] * muted, z * [1, 1.35, 1.8][k]);
        streaks.style(g + 1, FC[f], 0.35, z * 0.8);
      }
    }
    streaks.begin();
    for (const p of parts) {
      const s = segs[p.s];
      const head = pointAt(s, p.d);
      const x = X(head[0]);
      const y = Y(head[1]);
      if (x < -12 || y < -12 || x > W + 12 || y > H + 12) continue;
      // Tail length follows speed on screen, so fast rivers draw long streaks.
      const tailPx = Math.min(8, Math.max(1.2, vel[p.s] * sc * 0.16));
      const tail = pointAt(s, Math.max(0, p.d - tailPx / sc));
      streaks.add((p.f * 3 + sizeClass[p.s]) * 2 + (s.underground ? 1 : 0), X(tail[0]), Y(tail[1]), x, y);
    }
    streaks.flush(c, glow);

    c.lineWidth = 0.9;
    for (const r of ripples) {
      c.strokeStyle = FC[r.f];
      c.globalAlpha = (1 - r.t / 0.9) * 0.45;
      c.beginPath();
      c.arc(X(r.xy[0]), Y(r.xy[1]), 1 + r.t * 6, 0, 7);
      c.stroke();
    }
    for (const f of flashes) {
      c.strokeStyle = f.col;
      c.globalAlpha = Math.max(0, 1 - f.t / 1.2) * (f.big ? 1 : 0.8);
      c.lineWidth = f.big ? 2 : 1.2;
      c.beginPath();
      c.arc(X(f.xy[0]), Y(f.xy[1]), (f.big ? 4 : 2) + f.t * (f.big ? 18 : 9), 0, 7);
      c.stroke();
    }
    c.globalAlpha = 1;
    if (tracer && selected && tracer.rest <= 0) drawTracer(c);
    const now = performance.now() / 1000;
    const size = 2 + Math.min(2.5, sc / 3000);
    for (const s of springs) {
      const x = X(s.xy[0]);
      const y = Y(s.xy[1]);
      if (x < -10 || y < -10 || x > W + 10 || y > H + 10) continue;
      drawBoil(c, x, y, size * MAG_SIZE[s.mag], s.phase, now, C.spring);
    }
  }

  // ----- the traced drop: one bright raindrop runs the selected creek's whole path -----
  function select(t: Trace | null) {
    selected = t;
    if (!t) tracer = null;
    else {
      const total = t.path.reduce((a, s) => a + s.len, 0);
      // A short creek takes a few seconds; the long haul to the Gulf takes about ten.
      const seconds = Math.max(3, Math.min(10, (total * KM_PER_UNIT) / 14));
      tracer = { d: 0, total, v: total / seconds, rest: 0.3 };
    }
    view.redraw();
  }

  function advanceTracer(dt: number) {
    const t = tracer!;
    if (t.rest > 0) {
      t.rest -= dt;
      return;
    }
    t.d += t.v * dt;
    if (t.d >= t.total) {
      flashes.push({ xy: selected!.end, t: 0, col: C.hi, big: true });
      t.d = 0;
      t.rest = 1.4;
    }
  }

  function drawTracer(c: CanvasRenderingContext2D) {
    let d = tracer!.d;
    for (const s of selected!.path) {
      if (d > s.len) {
        d -= s.len;
        continue;
      }
      const p = pointAt(s, d);
      const x = X(p[0]);
      const y = Y(p[1]);
      c.fillStyle = C.hi;
      c.globalAlpha = 0.18;
      c.beginPath();
      c.arc(x, y, 7, 0, 7);
      c.fill();
      c.globalAlpha = 1;
      c.beginPath();
      c.arc(x, y, 2.6, 0, 7);
      c.fill();
      return;
    }
  }

  // ----- interaction -----
  function distToSegment(px: number, py: number, a: XY, b: XY) {
    const ax = X(a[0]), ay = Y(a[1]), bx = X(b[0]), by = Y(b[1]);
    const dx = bx - ax, dy = by - ay, dd = dx * dx + dy * dy;
    const t = dd ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / dd)) : 0;
    return Math.hypot(px - ax - t * dx, py - ay - t * dy);
  }

  const near = (xy: XY, x: number, y: number, r: number) => Math.hypot(X(xy[0]) - x, Y(xy[1]) - y) < r;

  function tap(x: number, y: number) {
    const spring = springs.find((s) => near(s.xy, x, y, 10));
    if (spring) {
      select(null);
      const log = journal && spring.id ? ` ${journalCardHtml(journal, spring.id)}` : "";
      card.show({ title: spring.name, kind: "Spring", color: C.spring, body: `${MAG_TEXT[spring.mag] ?? ""}Groundwater rising back to the surface. Water that drops into sinks upstream can come out at springs like this one, sometimes days later.${log}` });
      return;
    }
    const swallet = swallets.find((s) => near(s.xy, x, y, 10));
    if (swallet) return showSwallet(swallet);
    let best = -1;
    let bd = 14;
    segs.forEach((s, i) => {
      for (let k = 1; k < s.pts.length; k++) {
        const d = distToSegment(x, y, s.pts[k - 1], s.pts[k]);
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
    });
    if (best < 0) {
      card.hide();
      return;
    }
    const s0 = segs[best];
    const trace = traceDownstream(segs, best);
    select(trace);
    const F = FATES[s0.fate];
    const mi = trace.km * 0.621;
    const miles = mi < 1 ? mi.toFixed(1) : String(Math.round(mi));
    const sea = s0.fate === Fate.Gulf ? "Gulf" : "Atlantic";
    const body = s0.route
      ? `Past the mapped creeks, the ${escapeHtml(s0.name ?? "river")} carries their water the rest of the way to the sea.`
      : s0.fate === Fate.Sink && s0.sink ? `Ends at <b>${escapeHtml(s0.sink)}</b> and goes straight into the Floridan aquifer.`
      : s0.fate <= Fate.Atlantic ? seaway(s0, trace) : F.via;
    const dist = s0.fate > Fate.Atlantic
      ? `Its water travels about ${miles} miles along the surface before it disappears.`
      : trace.toSea ? `Its water travels about ${miles} miles to reach the ${sea}.` : `Its water travels at least ${miles} miles before leaving this map.`;
    const underground = trace.path.some((s) => s.underground) ? " Part of the way it runs underground, through the aquifer." : "";
    // Skip the river it joins when the card already names it ("Flows down the Withlacoochee River...").
    const joins = trace.joins && trace.joins !== s0.name && !body.includes(escapeHtml(trace.joins)) ? ` Along the way it joins ${escapeHtml(trace.joins)}.` : "";
    card.show({ title: s0.name || "Unnamed creek", kind: F.label, color: FC[s0.fate], body: `${body} ${dist}${underground}${joins}` });
  }

  /** A creek drops into the ground here but keeps going: say where it comes back up. */
  function showSwallet(sw: { xy: XY; name: string }) {
    let entry = -1;
    let bd = Infinity;
    segs.forEach((s, i) => {
      if (s.underground || s.next < 0 || !segs[s.next].underground) return;
      const e = s.pts[s.pts.length - 1];
      const d = (e[0] - sw.xy[0]) ** 2 + (e[1] - sw.xy[1]) ** 2;
      if (d < bd) {
        bd = d;
        entry = i;
      }
    });
    if (entry < 0) return;
    let km = 0;
    let j = segs[entry].next;
    while (j >= 0 && segs[j].underground) {
      km += segs[j].len * KM_PER_UNIT;
      j = segs[j].next;
    }
    // "Rising again into the Santa Fe River" reads oddly when the Santa Fe is what sank.
    const rises = j >= 0 && segs[j].name !== segs[entry].name ? segs[j].name : null;
    select(traceDownstream(segs, segs[entry].next));
    const mi = km * 0.621;
    card.show({
      title: sw.name,
      kind: "Swallet",
      color: FC[Fate.Sink],
      body: `${segs[entry].name ? escapeHtml(segs[entry].name!) : "The creek"} drops into the ground here and flows through the aquifer for about ${mi < 1 ? mi.toFixed(1) : Math.round(mi)} miles before rising again${rises ? ` into the ${escapeHtml(rises)}` : ""}. The dashed line is the underground channel the USGS maps, not its exact route.`,
    });
  }

  document.getElementById("vAll")!.addEventListener("click", () => view.fit(VIEWS.all, true));
  const pick = document.getElementById("view") as HTMLSelectElement;
  pick.addEventListener("change", () => {
    const b = VIEWS[pick.value as keyof typeof VIEWS];
    if (b) view.fit(b, true);
    // Back to "Zoom to…", so the same place can be picked again after panning away.
    pick.value = "";
  });
  let paused = false;
  const bp = document.getElementById("bPause")!;
  const setPaused = (p: boolean) => {
    paused = p;
    bp.textContent = p ? "Play" : "Pause";
    bp.setAttribute("aria-pressed", String(p));
  };
  bp.addEventListener("click", () => setPaused(!paused));

  // ----- boot -----
  readColors();
  view.resize();
  view.fit(VIEWS.all);
  // Warm start so the creeks are already full of rain on first paint.
  for (let t = 0; t < 45; t += 0.25) step(0.25, false);
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
    view.redraw();
  });
  void loadJournalOverlay().then((o) => {
    if (!o) return;
    journal = o;
    const chip = document.createElement("button");
    chip.type = "button";
    chip.textContent = "Journal";
    chip.setAttribute("aria-pressed", "true");
    chip.addEventListener("click", () => {
      showJournal = !showJournal;
      chip.setAttribute("aria-pressed", String(showJournal));
      view.redraw();
    });
    bp.after(chip);
    view.redraw();
  });
}

main().catch(showLoadError);
