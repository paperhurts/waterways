import "../shared/map.css";
import "../shared/nav";
import "./rain.css";
import { InfoCard } from "../shared/card";
import { escapeHtml, loadData, showLoadError } from "../shared/data";
import { KM_PER_UNIT, bounds, pointAt, project, type Bounds, type XY } from "../shared/geo";
import { drawJournal, hitSighting, journalCardHtml, loadJournalOverlay, sightingCard, type JournalOverlay } from "../shared/journal-overlay";
import { MAG_TEXT } from "../shared/magnitude";
import { StreakLayer, drawBoil, fadeLayer } from "../shared/streaks";
import { cssVar, fontsReady, isDark, onColorSchemeChange } from "../shared/theme";
import { Fate, type RainBase, type RainTile, type RainWater } from "../shared/types";
import { Viewport, startLoop } from "../shared/viewport";
import { decodeSegments, traceDownstream, traceLoading, unpackDelta, type Segment, type Trace } from "./network";
import { LEVEL_SCALE, TileIndex, type TileRef } from "./tiles";

const FATES = [
  { v: "--gulf", label: "Reaches the Gulf", via: "Flows to the Gulf of Mexico." },
  { v: "--atl", label: "Reaches the Atlantic", via: "Flows to the Atlantic." },
  { v: "--sink", label: "Drops into a sink", via: "Ends at a mapped sink and goes straight into the Floridan aquifer." },
  { v: "--inland", label: "Ends inland", via: "Ends with no mapped outlet. That's usually a sink, a closed wetland, or a lake with no surface exit, but it can also be a gap in the map." },
  { v: "--off", label: "Leaves Florida", via: "Flows out of Florida and ends somewhere beyond this map." },
];

/** The whole state, then its parts, north and west to south and east. */
const VIEWS: Record<string, Bounds> = {
  all: bounds(-87.65, 24.45, -79.95, 31.05),
  pens: bounds(-87.65, 30.25, -86.2, 31.05),
  apa: bounds(-85.7, 29.55, -84.35, 30.75),
  tlh: bounds(-84.75, 29.9, -83.7, 30.7),
  belt: bounds(-83.3, 28.75, -81.5, 30.5),
  msw: bounds(-83.3, 29.92, -82.85, 30.5),
  spr: bounds(-82.8, 29.8, -82.55, 29.95),
  ala: bounds(-82.62, 29.72, -82.36, 29.9),
  gnv: bounds(-82.48, 29.57, -82.22, 29.72),
  gulf: bounds(-83.25, 29.25, -82.75, 29.65),
  rbw: bounds(-82.8, 28.75, -82.35, 29.15),
  stj: bounds(-82.12, 29.14, -81.52, 29.56),
  ock: bounds(-82.1, 28.75, -81.5, 29.25),
  atl: bounds(-81.92, 29.44, -81.3, 30.46),
  mid: bounds(-81.62, 28.6, -81.0, 29.2),
  upr: bounds(-81.15, 27.6, -80.45, 28.55),
  tpa: bounds(-82.85, 27.45, -82.05, 28.3),
  peace: bounds(-82.35, 26.7, -81.55, 28.05),
  kis: bounds(-81.65, 26.65, -80.55, 28.45),
  stl: bounds(-80.75, 26.88, -80.08, 27.5),
  glades: bounds(-81.45, 25.1, -80.1, 26.7),
  keys: bounds(-82.0, 24.45, -80.2, 25.45),
};

/** Town names, and the zoom (pixels per map unit) below which each is hidden. */
const PLACES: [name: string, lon: number, lat: number, minScale: number][] = [
  ["Pensacola", -87.217, 30.421, 0], ["Tallahassee", -84.28, 30.438, 0], ["Jacksonville", -81.656, 30.332, 0], ["Gainesville", -82.325, 29.665, 0],
  ["Orlando", -81.379, 28.538, 0], ["Tampa", -82.458, 27.95, 0], ["Fort Myers", -81.872, 26.64, 0], ["Miami", -80.192, 25.762, 0],
  ["West Palm Beach", -80.053, 26.715, 0], ["Key West", -81.78, 24.555, 0],
  ["Panama City", -85.66, 30.159, 400], ["Ocala", -82.14, 29.187, 400], ["Daytona Beach", -81.023, 29.211, 400], ["St. Petersburg", -82.64, 27.771, 400],
  ["Sarasota", -82.531, 27.336, 400], ["Naples", -81.795, 26.142, 400], ["Fort Lauderdale", -80.137, 26.122, 400], ["Lakeland", -81.95, 28.04, 400],
  ["Melbourne", -80.608, 28.084, 400], ["Fort Pierce", -80.326, 27.447, 400], ["Stuart", -80.253, 27.198, 400], ["Lake City", -82.64, 30.085, 400],
  ["Palatka", -81.637, 29.648, 400], ["Titusville", -80.808, 28.612, 400], ["Vero Beach", -80.397, 27.638, 400], ["Okeechobee", -80.83, 27.244, 400],
  ["Destin", -86.495, 30.393, 900], ["Marianna", -85.227, 30.775, 900], ["Apalachicola", -84.983, 29.726, 900], ["Perry", -83.582, 30.117, 900],
  ["St. Augustine", -81.314, 29.894, 900], ["Sebring", -81.441, 27.496, 900], ["Clewiston", -80.934, 26.754, 900], ["Punta Gorda", -82.045, 26.93, 900],
  ["Homestead", -80.477, 25.468, 900], ["Kissimmee", -81.407, 28.292, 900], ["Brooksville", -82.388, 28.555, 900], ["DeLand", -81.303, 29.028, 900],
  ["Sanford", -81.269, 28.8, 900], ["Jupiter", -80.094, 26.934, 900], ["Dunnellon", -82.461, 29.049, 900], ["High Springs", -82.585, 29.815, 900],
  ["Alachua", -82.47, 29.752, 1500], ["Fort White", -82.713, 29.905, 1500], ["Newberry", -82.61, 29.646, 1500], ["Silver Springs", -82.03, 29.235, 1500],
  ["Welaka", -81.672, 29.48, 1500], ["Live Oak", -82.984, 30.295, 1500], ["Mayo", -83.175, 30.053, 1500], ["Branford", -82.928, 29.96, 1500],
  ["White Springs", -82.759, 30.33, 1500], ["Chiefland", -82.86, 29.475, 1500], ["Cedar Key", -83.035, 29.138, 1500], ["Williston", -82.447, 29.387, 1500],
  ["Crystal River", -82.593, 28.902, 1500], ["Inverness", -82.33, 28.836, 1500], ["Leesburg", -81.878, 28.811, 1500], ["Apopka", -81.511, 28.676, 1500],
  ["Oviedo", -81.208, 28.67, 1500], ["Astor", -81.525, 29.167, 1500], ["Cocoa", -80.742, 28.386, 1500], ["Palm Bay", -80.588, 28.034, 1500],
  ["Fellsmere", -80.601, 27.768, 1500], ["Port St. Lucie", -80.358, 27.294, 1500], ["Indiantown", -80.486, 27.027, 1500], ["Arcadia", -81.859, 27.216, 1500],
  ["Wakulla Springs", -84.302, 30.235, 1500], ["Crestview", -86.57, 30.762, 1500], ["Milton", -87.039, 30.632, 1500], ["Chipley", -85.539, 30.782, 1500],
];

/** How a Gulf- or Atlantic-bound creek's water gets to the sea, by the rivers on its path. */
function seaway(s0: Segment, trace: Trace): string {
  const on = (name: string) => trace.path.some((s) => s.name === name);
  if (s0.lakeo) {
    return "Flows into Lake Okeechobee. The USGS map routes the lake out the St. Lucie Canal to the Atlantic, but its releases also go west down the Caloosahatchee to the Gulf and south to the Everglades, as the water managers choose.";
  }
  // The last named river before the coast: the Suwannee, the Withlacoochee, Crystal River...
  let outlet: string | null = null;
  for (let i = trace.path.length - 1; i >= 0 && !outlet; i--) outlet = trace.path[i].name;
  if (s0.fate === Fate.Atlantic) {
    if (on("Ocklawaha River")) return "Flows to the Ocklawaha River, then north along the St. Johns to the Atlantic.";
    if (on("Saint Johns River")) return "Flows to the St. Johns River, then north along it to the Atlantic.";
    // East of the St. Johns' basin, creeks run straight to the coast's lagoons.
    if (on("Indian River")) return "Flows into the Indian River Lagoon, which opens to the Atlantic through inlets in the barrier islands.";
    return outlet ? `Flows down the ${escapeHtml(outlet)} to the Atlantic.` : FATES[Fate.Atlantic].via;
  }
  return outlet ? `Flows down the ${escapeHtml(outlet)} to the Gulf of Mexico.` : FATES[Fate.Gulf].via;
}

/** Story pages about a river, linked from the card of any creek whose water passes through it. */
const STORIES: [test: (s: Segment) => boolean, href: string, title: string][] = [
  // First, since the lake's water also runs out the St. Lucie Canal.
  [(s) => s.lakeo || s.name === "Caloosahatchee River", "lake-o.html", "the Lake Okeechobee map"],
  [(s) => /Saint Lucie/.test(s.name ?? ""), "st-lucie.html", "the St. Lucie map"],
  [(s) => s.name === "Rainbow River", "rainbow.html", "the Rainbow River map"],
  [(s) => s.name === "Santa Fe River", "santa-fe.html", "the Santa Fe map"],
];

/** Boil size by spring magnitude (index), so first-magnitude springs read as the giants they are. */
const MAG_SIZE = [1, 2, 1.45, 1.15, 1, 1, 1, 1, 1];
/** The biggest spring magnitude drawn at a zoom: only the first-magnitude springs across the whole state. */
const springsUpTo = (scale: number) => (scale < 250 ? 1 : scale < 500 ? 2 : 8);
/** Places the data doesn't name: a basin that drains into sinks. */
const EXTRA_LABELS: [name: string, lon: number, lat: number, fate: Fate, minScale: number][] = [["Paynes Prairie", -82.33, 29.585, Fate.Sink, 900]];

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
/**
 * Zoomed out past this, the base draws from coarse copies of its creeks, thinned so
 * no two vertices are closer than COARSE_STEP map units (about 400 m, under two pixels
 * here). Stroking every vertex of the whole state costs far more than it shows.
 */
const COARSE_SCALE = 300;
const COARSE_STEP = 0.0036;
/** Tiles kept in memory once loaded; the least recently shown go first. */
const MAX_TILES = 48;
/** Tiles load a little before their level shows, and a margin past the screen's edge (map units). */
const PREFETCH = 0.85;
const TILE_MARGIN = 0.15;
/** Seconds of rain a newly shown tile starts with, so its creeks aren't empty. */
const TILE_WARM_S = 8;

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
/** Sinks draining more than this accumulation (km of creek) are labeled once zoomed to a region. */
const BIG_SINK_ACC = 15;
/** Zoom at which sinks, swallets, and the smaller springs appear. */
const REGION_SCALE = 500;
/** Zoom for a linked spot: close enough that its smallest creeks have loaded. */
const SPOT_SCALE = 2400;

interface Seg extends Segment {
  vel: number;
  /** 0 creek, 1 stream, 2 river, by km of creek upstream. */
  cls: number;
}

/** One path per kind of water, in map units. */
type WaterPaths = Record<RainWater["kind"], Path2D | null>;

/** A polyline's vertices less those within `step` of the last one kept, keeping the ends. */
function thin(pts: XY[], step: number): XY[] {
  if (!step) return pts;
  const out: XY[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [lx, ly] = out[out.length - 1];
    if (i === pts.length - 1 || Math.abs(pts[i][0] - lx) + Math.abs(pts[i][1] - ly) >= step) out.push(pts[i]);
  }
  return out;
}

/** The base, or one tile: its creeks, batched for drawing and weighted for rain, and its water. */
interface Chunk {
  ref: TileRef | null;
  segs: Seg[];
  groups: StrokeGroup[];
  /** The same groups, thinned, for drawing zoomed far out (the base only). */
  coarse: StrokeGroup[] | null;
  water: WaterPaths;
  waterCoarse: WaterPaths | null;
  lakeLabels: { name: string; km2: number; xy: XY }[];
  /** Cumulative rain weight by segment. */
  cum: Float64Array;
  km: number;
  lastShown: number;
}

async function main() {
  const [base] = await Promise.all([loadData<RainBase>("rain/base.json"), fontsReady()]);
  const { meta } = base;
  const index = new TileIndex(meta);
  /** Every loaded segment, by id. */
  const all: (Seg | undefined)[] = new Array(meta.segCount);
  const get = (id: number) => all[id];

  function toSegs(segs: Segment[]): Seg[] {
    return segs.map((s) => {
      const seg = s as Seg;
      // Big rivers run faster than headwater creeks: speed grows with the log of upstream length.
      seg.vel = BASE_SPEED * (0.45 + 0.32 * Math.log10(s.acc + 1));
      seg.cls = s.acc < 15 ? 0 : s.acc < 150 ? 1 : 2;
      all[s.id] = seg;
      return seg;
    });
  }

  function makeChunk(ref: TileRef | null, segs: Seg[], water: RainWater[]): Chunk {
    // The base layer redraws on every pan and zoom frame, so creeks are batched: one
    // Path2D per line style, built once in map units and drawn through the camera
    // transform. Small creeks come first so rivers sit on top.
    const batch = (step: number) => {
      const groups = new Map<string, StrokeGroup>();
      for (const s of segs) {
        const width = Math.round((0.45 + Math.log10(s.acc + 1) * 0.75) / WIDTH_STEP) * WIDTH_STEP;
        const kind = s.underground ? Line.Underground : s.lake ? Line.ThroughLake : Line.Surface;
        const key = `${width}|${s.fate}|${kind}`;
        let g = groups.get(key);
        if (!g) groups.set(key, (g = { width, fate: s.fate, kind, path: new Path2D() }));
        thin(s.pts, step).forEach((p, i) => (i ? g.path.lineTo(p[0], p[1]) : g.path.moveTo(p[0], p[1])));
      }
      return [...groups.values()].sort((a, b) => a.width - b.width);
    };
    const paths: WaterPaths = { sea: null, swamp: null, lake: null };
    const coarse: WaterPaths = { sea: null, swamp: null, lake: null };
    const lakeLabels: Chunk["lakeLabels"] = [];
    for (const w of water) {
      const rings = w.rings.map((r) => unpackDelta(r, meta));
      for (const [into, step] of [[paths, 0], ...(ref ? [] : [[coarse, COARSE_STEP]])] as [WaterPaths, number][]) {
        const p = (into[w.kind] ??= new Path2D());
        for (const r of rings) {
          const pts = thin(r, step);
          if (pts.length < 3) continue;
          pts.forEach((q, i) => (i ? p.lineTo(q[0], q[1]) : p.moveTo(q[0], q[1])));
          p.closePath();
        }
      }
      if (w.kind === "lake" && w.name) {
        const xs = rings[0].map((q) => q[0]);
        const ys = rings[0].map((q) => q[1]);
        lakeLabels.push({ name: w.name, km2: w.km2, xy: [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2] });
      }
    }
    // Rain on a big river starts as an already-merged drop, so it's spawned less often.
    const cum = new Float64Array(segs.length);
    let total = 0;
    let km = 0;
    segs.forEach((s, i) => {
      cum[i] = total += s.len * MERGE_KEEP ** s.cls;
      km += s.len * KM_PER_UNIT;
    });
    return { ref, segs, groups: batch(0), coarse: ref ? null : batch(COARSE_STEP), water: paths, waterCoarse: ref ? null : coarse, lakeLabels, cum, km, lastShown: 0 };
  }

  const baseChunk = makeChunk(null, toSegs(decodeSegments(base.segs, base.names, 0, meta)), base.water);
  const tiles = new Map<string, Chunk>();
  const pending = new Map<string, Promise<Chunk | null>>();
  /** The chunks drawn and rained on right now: the base, then the shown tiles. */
  let shown: Chunk[] = [baseChunk];

  function loadTile(ref: TileRef): Promise<Chunk | null> {
    const have = tiles.get(ref.path);
    if (have) return Promise.resolve(have);
    let p = pending.get(ref.path);
    if (!p) {
      p = loadData<RainTile>(ref.path)
        .then((t) => {
          const chunk = makeChunk(ref, toSegs(decodeSegments(t.segs, t.names, t.first, meta)), t.water);
          tiles.set(ref.path, chunk);
          evict();
          view.redraw();
          return chunk;
        })
        .catch((err) => {
          console.warn(`Couldn't load ${ref.path}`, err);
          return null;
        })
        .finally(() => pending.delete(ref.path));
      pending.set(ref.path, p);
    }
    return p;
  }

  /** Load the tile holding a segment, for a trace. */
  const loadId = async (id: number) => {
    const ref = index.of(id);
    return !!ref && !!(await loadTile(ref));
  };

  function evict() {
    if (tiles.size <= MAX_TILES) return;
    const old = [...tiles.values()].filter((t) => !shown.includes(t)).sort((a, b) => a.lastShown - b.lastShown);
    for (const t of old.slice(0, tiles.size - MAX_TILES)) {
      for (const s of t.segs) all[s.id] = undefined;
      tiles.delete(t.ref!.path);
    }
  }

  function mapView(): Bounds {
    const { s, tx, ty } = view.cam;
    return [-tx / s, -ty / s, (view.W - tx) / s, (view.H - ty) / s];
  }

  /** Pick the tiles to show at this zoom, and ask for the ones missing. */
  function updateTiles() {
    const v = mapView();
    const now = performance.now();
    const next: Chunk[] = [baseChunk];
    for (let level = 1; level < LEVEL_SCALE.length; level++) {
      if (view.scale < LEVEL_SCALE[level] * PREFETCH) continue;
      for (const ref of index.visible(level, v, TILE_MARGIN)) {
        const t = tiles.get(ref.path);
        if (!t) {
          void loadTile(ref);
          continue;
        }
        if (view.scale < LEVEL_SCALE[level]) continue;
        t.lastShown = now;
        next.push(t);
        if (!shown.includes(t)) warm(t);
      }
    }
    shown = next;
    rate = RAIN_PER_KM * shown.reduce((a, c) => a + c.km, 0);
  }

  const lede = document.getElementById("lede")!;
  const pct = meta.shares;
  lede.innerHTML =
    `Every mapped creek in Florida, from the Perdido to the Keys, colored by where its water ends up and followed down the rivers to the sea. ` +
    `<b>${Math.round(pct[Fate.Gulf])}%</b> of creek length drains to the Gulf and <b>${Math.round(pct[Fate.Atlantic])}%</b> to the Atlantic. ` +
    `The other <b>${Math.round(pct[Fate.Sink] + pct[Fate.Inland])}%</b> never reaches a river: it ends inland, in a sink, a closed wetland, ` +
    `or a lake with no outlet, and much of that water goes into the aquifer. Zoom in and the smaller creeks fill in.`;
  document.getElementById("legend")!.innerHTML =
    FATES.slice(0, 4).map((f, i) => `<span><i style="background:var(${f.v})"></i>${f.label} <em>${Math.round(pct[i])}%</em></span>`).join("") +
    `<span><i class="dot"></i>Spring</span>`;

  const springs = base.springs.map(([lon, lat, name, mag, id]) => ({ xy: project(lon, lat), name, mag, id, phase: (((lon * 97.3 + lat * 41.1) % 1) + 1) % 1 }));
  const swallets = base.swallets.map(([lon, lat, name]) => ({ xy: project(lon, lat), name }));
  const sinks = base.sinks.map(([lon, lat, name, acc]) => ({ xy: project(lon, lat), name, acc }));
  const rivers = base.rivers.map(([lon, lat, name, fate, km]) => ({ xy: project(lon, lat), name: name.replace(/^Saint /, "St. ").replace(/ River$/, ""), fate, km }));
  const shownSpring = (s: { mag: number }, scale: number) => (s.mag >= 1 && s.mag <= springsUpTo(scale)) || (scale >= 500 && s.mag === 0);
  /** The signed-in member's journal, drawn over the map; null for everyone else. */
  let journal: JournalOverlay | null = null;
  let showJournal = true;

  let C: Record<string, string> = {};
  let FC: string[] = [];
  let glow = true;
  const readColors = () => {
    C = Object.fromEntries(["bg", "ink", "muted", "spring", "hi", "line", "sea", "lake", "shore", "marsh"].map((n) => [n, cssVar(`--${n}`)]));
    FC = FATES.map((f) => cssVar(f.v));
    glow = isDark();
    marsh = null;
  };

  let selected: Trace | null = null;
  let tracer: { d: number; total: number; v: number; rest: number } | null = null;
  const card = new InfoCard();
  card.onShow = () => (document.getElementById("hint")!.style.display = "none");
  card.onHide = () => select(null);

  const view = new Viewport({
    minScale: 40,
    maxScale: 60000,
    padding: (w) => {
      const p = w < 600 ? 10 : 40;
      return { x: p, top: p, bottom: p };
    },
    drawBase,
    onTap: tap,
  });
  const { X, Y } = view;

  // Swamps get the cartographer's marsh stipple, pinned to the map so it pans with the land.
  const STIPPLE = 7;
  let marsh: CanvasPattern | null = null;
  function marshPattern(c: CanvasRenderingContext2D): CanvasPattern {
    if (marsh) return marsh;
    const tile = document.createElement("canvas");
    tile.width = tile.height = STIPPLE * 2;
    const t = tile.getContext("2d")!;
    t.fillStyle = C.marsh;
    // Offset rows, like the tufts on a USGS topo swamp symbol.
    t.fillRect(1, 2, 3, 1);
    t.fillRect(STIPPLE + 1, STIPPLE + 2, 3, 1);
    return (marsh = c.createPattern(tile, "repeat")!);
  }

  /** Screen rectangles already taken by a label this frame. */
  let taken: [number, number, number, number][] = [];
  function place(c: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, align: CanvasTextAlign = "left"): boolean {
    const w = c.measureText(text).width;
    const x0 = align === "center" ? x - w / 2 : x;
    const box: [number, number, number, number] = [x0 - 3, y - 12, x0 + w + 3, y + 4];
    if (box[2] < 0 || box[0] > view.W || box[3] < 0 || box[1] > view.H) return false;
    if (taken.some((b) => b[0] < box[2] && box[0] < b[2] && b[1] < box[3] && box[1] < b[3])) return false;
    taken.push(box);
    c.fillStyle = color;
    c.textAlign = align;
    c.fillText(text, x, y);
    c.textAlign = "left";
    return true;
  }

  function strokePath(c: CanvasRenderingContext2D, pts: XY[]) {
    pts.forEach((p, i) => (i ? c.lineTo(X(p[0]), Y(p[1])) : c.moveTo(X(p[0]), Y(p[1]))));
  }

  function sinkRing(c: CanvasRenderingContext2D, x: number, y: number) {
    c.strokeStyle = FC[Fate.Sink];
    c.lineWidth = 1.5;
    c.beginPath();
    c.arc(x, y, 4.5, 0, 7);
    c.stroke();
  }

  function drawBase() {
    updateTiles();
    const c = view.bctx;
    const { W, H } = view;
    const sc = view.scale;
    c.setTransform(view.DPR, 0, 0, view.DPR, 0, 0);
    c.fillStyle = C.bg;
    c.fillRect(0, 0, W, H);
    c.lineCap = "round";
    c.lineJoin = "round";
    // Paths are in map units, so widths, dashes, and the stipple are divided by the scale to stay in pixels.
    const { s: k, tx, ty } = view.cam;
    c.setTransform(view.DPR * k, 0, 0, view.DPR * k, view.DPR * tx, view.DPR * ty);
    const far = sc < COARSE_SCALE;
    const waterOf = (ch: Chunk) => (far && ch.waterCoarse) || ch.water;
    // The sea sits under everything, filled as one shape with no outline: NHD tiles it
    // into polygons with straight seams offshore, and stroking those would draw fake coasts.
    const sea = waterOf(baseChunk).sea;
    if (sea) {
      c.fillStyle = C.sea;
      c.fill(sea, "evenodd");
    }
    const m = marshPattern(c);
    m.setTransform(new DOMMatrix().scaleSelf(1 / k, 1 / k));
    c.fillStyle = m;
    for (const ch of shown) {
      const swamp = waterOf(ch).swamp;
      if (swamp) c.fill(swamp, "evenodd");
    }
    c.lineWidth = 0.8 / k;
    for (const ch of shown) {
      const lake = waterOf(ch).lake;
      if (!lake) continue;
      c.fillStyle = C.lake;
      c.fill(lake, "evenodd");
      c.strokeStyle = C.shore;
      c.stroke(lake);
    }
    const zs = Math.max(0.6, Math.min(2.2, sc / 1500));
    // The finest tiles first, so each level's bigger creeks sit on top.
    // Round ends and joins are invisible on sub-pixel lines, and cost the most to draw.
    c.lineCap = far ? "butt" : "round";
    c.lineJoin = far ? "bevel" : "round";
    for (const ch of [...shown].reverse()) {
      for (const g of (far && ch.coarse) || ch.groups) {
        c.lineWidth = (g.width * zs) / k;
        c.strokeStyle = FC[g.fate];
        c.globalAlpha = g.kind === Line.Underground ? 0.4 : g.kind === Line.ThroughLake ? 0.1 : glow ? 0.3 : 0.26;
        c.setLineDash(g.kind === Line.Underground ? [3 / k, 4 / k] : []);
        c.stroke(g.path);
      }
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

    // Labels, most important first, each skipped if it would land on one already drawn.
    taken = [];
    const onScreen = (x: number, y: number) => x >= 0 && y >= 0 && x <= W && y <= H;
    c.font = "500 12px 'Barlow Semi Condensed',sans-serif";
    for (const [n, lon, lat, min] of PLACES) {
      if (sc < min) continue;
      const p = project(lon, lat);
      place(c, n, X(p[0]), Y(p[1]), C.muted);
    }
    if (sc >= REGION_SCALE) {
      for (const s of sinks) {
        const x = X(s.xy[0]);
        const y = Y(s.xy[1]);
        if (!onScreen(x, y)) continue;
        sinkRing(c, x, y);
        if (sc > 1600 || s.acc > BIG_SINK_ACC) place(c, s.name, x + 7, y + 4, FC[Fate.Sink]);
      }
      for (const s of swallets) {
        const x = X(s.xy[0]);
        const y = Y(s.xy[1]);
        if (!onScreen(x, y)) continue;
        sinkRing(c, x, y);
        if (sc > 1600) place(c, s.name, x + 7, y + 4, FC[Fate.Sink]);
      }
    }
    c.font = "italic 14px 'Spectral',serif";
    // Longer rivers are named first and from farther out.
    const minKm = sc < 200 ? 150 : sc < 450 ? 60 : sc < 1000 ? 30 : 0;
    for (const r of rivers) {
      if (r.km < minKm) break;
      place(c, r.name, X(r.xy[0]), Y(r.xy[1]), FC[r.fate], "center");
    }
    for (const [n, lon, lat, fate, min] of EXTRA_LABELS) {
      const p = project(lon, lat);
      if (sc >= min) place(c, n, X(p[0]), Y(p[1]), FC[fate]);
    }
    c.font = "italic 12px 'Spectral',serif";
    c.globalAlpha = 0.85;
    for (const ch of shown) {
      for (const l of ch.lakeLabels) {
        if (l.km2 < 100 && sc < 450) continue;
        if (l.km2 < 8 && sc < 2400) continue;
        if (l.km2 < 2 && sc < 6000) continue;
        place(c, l.name, X(l.xy[0]), Y(l.xy[1]) + 4, C.muted, "center");
      }
    }
    c.globalAlpha = 1;
    // Sea names sit in open water, clear of the coast. Each has spots to try in order;
    // on a phone there's little sea on screen, so use the short name; skip it if nothing fits.
    c.font = "italic 14px 'Spectral',serif";
    const seaLabel = (full: string, short: string, spots: [number, number][]) => {
      const t = W < 600 ? short : full;
      for (const [lon, lat] of spots) {
        const p = project(lon, lat);
        if (place(c, t, X(p[0]), Y(p[1]), C.muted)) return;
      }
    };
    seaLabel("Gulf of Mexico", "Gulf", [[-85.6, 28.9], [-84.2, 28.7], [-83.6, 28.3], [-83.3, 28.95], [-82.8, 26.6]]);
    seaLabel("Atlantic Ocean", "Atlantic", [[-80.2, 30.3], [-80.0, 28.9], [-79.95, 27.6], [-80.3, 30.06], [-80.75, 29.0]]);
  }

  // ----- particles: rain falls on every creek shown, weighted by length -----
  let rate = 0;
  const pick = (): Seg | undefined => {
    let r = Math.random() * shown.reduce((a, ch) => a + (ch.cum[ch.cum.length - 1] ?? 0), 0);
    for (const ch of shown) {
      const w = ch.cum[ch.cum.length - 1] ?? 0;
      if (r > w) {
        r -= w;
        continue;
      }
      let lo = 0;
      let hi = ch.cum.length - 1;
      while (lo < hi) {
        const m = (lo + hi) >> 1;
        if (ch.cum[m] < r) lo = m + 1;
        else hi = m;
      }
      return ch.segs[lo];
    }
    return undefined;
  };
  const parts: { s: number; d: number; f: Fate }[] = [];
  const flashes: { xy: XY; t: number; col: string; big: boolean }[] = [];
  const ripples: { xy: XY; t: number; f: Fate }[] = [];
  let spawnAcc = 0;

  /** Fill a newly shown tile's creeks with the rain they'd be carrying already. */
  function warm(ch: Chunk) {
    let n = Math.round(ch.km * RAIN_PER_KM * TILE_WARM_S * MERGE_KEEP);
    const total = ch.cum[ch.cum.length - 1] ?? 0;
    while (n-- > 0 && parts.length < MAX_PARTICLES && total > 0) {
      const r = Math.random() * total;
      let lo = 0;
      let hi = ch.cum.length - 1;
      while (lo < hi) {
        const m = (lo + hi) >> 1;
        if (ch.cum[m] < r) lo = m + 1;
        else hi = m;
      }
      const s = ch.segs[lo];
      parts.push({ s: s.id, d: Math.random() * s.len, f: s.fate });
    }
  }

  function step(dt: number, fresh = true) {
    // Zoomed out, thousands of creek ends share a few pixels; keep their splashes rare.
    const splash = Math.min(1, view.scale / 600);
    spawnAcc += rate * dt;
    while (spawnAcc >= 1) {
      spawnAcc--;
      if (parts.length < MAX_PARTICLES) {
        const s = pick();
        if (!s) continue;
        const d = Math.random() * s.len;
        parts.push({ s: s.id, d, f: s.fate });
        if (fresh && ripples.length < 80 && Math.random() < RIPPLE_CHANCE * splash) ripples.push({ xy: pointAt(s, d), t: 0, f: s.fate });
      }
    }
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      const at = all[p.s];
      if (!at) {
        parts.splice(i, 1);
        continue;
      }
      let s: Seg = at;
      p.d += s.vel * dt;
      for (let hops = 0; p.d > s.len && hops < 6; hops++) {
        const n: Seg | undefined = s.next >= 0 ? all[s.next] : undefined;
        if (n) {
          if (n.cls > s.cls && Math.random() > MERGE_KEEP) {
            parts.splice(i, 1);
            break;
          }
          p.d -= s.len;
          p.s = n.id;
          s = n;
        } else {
          // The end of the line, or a tile that isn't loaded.
          const flash = s.next >= 0 ? 0 : s.mouth ? SEA_RIPPLE_CHANCE : s.fate === Fate.Sink || s.fate === Fate.Inland ? 0.15 : 0;
          if (Math.random() < flash * splash) flashes.push({ xy: s.pts[s.pts.length - 1], t: 0, col: FC[s.fate], big: false });
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
      const s = all[p.s];
      if (!s) continue;
      const head = pointAt(s, p.d);
      const x = X(head[0]);
      const y = Y(head[1]);
      if (x < -12 || y < -12 || x > W + 12 || y > H + 12) continue;
      // Tail length follows speed on screen, so fast rivers draw long streaks.
      const tailPx = Math.min(8, Math.max(1.2, s.vel * sc * 0.16));
      const tail = pointAt(s, Math.max(0, p.d - tailPx / sc));
      streaks.add((p.f * 3 + s.cls) * 2 + (s.underground ? 1 : 0), X(tail[0]), Y(tail[1]), x, y);
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
    // Smaller across the whole state, where the springs belt is only a few hundred pixels wide.
    const size = (2 + Math.min(2.5, sc / 3000)) * (sc < 250 ? 0.6 : 1);
    for (const s of springs) {
      if (!shownSpring(s, sc)) continue;
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
    const seen = journal && showJournal ? hitSighting(journal, X, Y, x, y) : null;
    if (seen) {
      select(null);
      card.show(sightingCard(seen));
      return;
    }
    const spring = springs.find((s) => shownSpring(s, view.scale) && near(s.xy, x, y, 10));
    if (spring) {
      select(null);
      const log = journal && spring.id ? ` ${journalCardHtml(journal, spring.id)}` : "";
      card.show({ title: spring.name, kind: "Spring", color: C.spring, body: `${MAG_TEXT[spring.mag] ?? ""}Groundwater rising back to the surface. Water that drops into sinks upstream can come out at springs like this one, sometimes days later.${log}` });
      return;
    }
    const swallet = view.scale >= REGION_SCALE ? swallets.find((s) => near(s.xy, x, y, 10)) : undefined;
    if (swallet) return showSwallet(swallet);
    let best: Seg | null = null;
    let bd = 14;
    for (const ch of shown) {
      for (const s of ch.segs) {
        for (let k = 1; k < s.pts.length; k++) {
          const d = distToSegment(x, y, s.pts[k - 1], s.pts[k]);
          if (d < bd) {
            bd = d;
            best = s;
          }
        }
      }
    }
    if (!best) {
      card.hide();
      return;
    }
    const s0 = best;
    void traceLoading(get, loadId, s0.id).then((trace) => showCreek(s0, trace));
  }

  function showCreek(s0: Seg, trace: Trace) {
    select(trace);
    const F = FATES[s0.fate];
    const mi = trace.km * 0.621;
    const miles = mi < 1 ? mi.toFixed(1) : String(Math.round(mi));
    const sea = s0.fate === Fate.Gulf ? "Gulf" : "Atlantic";
    const body = s0.fate === Fate.Sink && s0.sink ? `Ends at <b>${escapeHtml(s0.sink)}</b> and goes straight into the Floridan aquifer.` : s0.fate <= Fate.Atlantic ? seaway(s0, trace) : F.via;
    const dist = s0.fate > Fate.Atlantic
      ? s0.fate === Fate.OffMap ? `Its water travels at least ${miles} miles before it leaves Florida.` : `Its water travels about ${miles} miles along the surface before it disappears.`
      : trace.toSea ? `Its water travels about ${miles} miles to reach the ${sea}.` : `Its water travels at least ${miles} miles on this map before it leaves Florida.`;
    const underground = trace.path.some((s) => s.underground) ? " Part of the way it runs underground, through the aquifer." : "";
    // Skip the river it joins when the card already names it ("Flows down the Withlacoochee River...").
    const joins = trace.joins && trace.joins !== s0.name && !body.includes(escapeHtml(trace.joins)) ? ` Along the way it joins ${escapeHtml(trace.joins)}.` : "";
    const story = STORIES.find(([test]) => trace.path.some(test));
    const more = story ? ` <a href="${story[1]}">See ${story[2]}.</a>` : "";
    card.show({ title: s0.name || "Unnamed creek", kind: F.label, color: FC[s0.fate], body: `${body} ${dist}${underground}${joins}${more}` });
  }

  /** A creek drops into the ground here but keeps going: say where it comes back up. */
  function showSwallet(sw: { xy: XY; name: string }) {
    let entry: Seg | null = null;
    let bd = Infinity;
    for (const s of all) {
      if (!s || s.underground || s.next < 0 || !all[s.next]?.underground) continue;
      const e = s.pts[s.pts.length - 1];
      const d = (e[0] - sw.xy[0]) ** 2 + (e[1] - sw.xy[1]) ** 2;
      if (d < bd) {
        bd = d;
        entry = s;
      }
    }
    if (!entry) {
      card.show({ title: sw.name, kind: "Swallet", color: FC[Fate.Sink], body: "A creek drops into the ground here and flows on through the aquifer." });
      return;
    }
    let km = 0;
    let j = all[entry.next];
    while (j && j.underground) {
      km += j.len * KM_PER_UNIT;
      j = j.next >= 0 ? all[j.next] : undefined;
    }
    // "Rising again into the Santa Fe River" reads oddly when the Santa Fe is what sank.
    const rises = j && j.name !== entry.name ? j.name : null;
    select(traceDownstream(get, entry.next));
    const mi = km * 0.621;
    card.show({
      title: sw.name,
      kind: "Swallet",
      color: FC[Fate.Sink],
      body: `${entry.name ? escapeHtml(entry.name) : "The creek"} drops into the ground here and flows through the aquifer for about ${mi < 1 ? mi.toFixed(1) : Math.round(mi)} miles before rising again${rises ? ` into the ${escapeHtml(rises)}` : ""}. The dashed line is the underground channel the USGS maps, not its exact route.`,
    });
  }

  document.getElementById("vAll")!.addEventListener("click", () => view.fit(VIEWS.all, true));
  const picker = document.getElementById("view") as HTMLSelectElement;
  picker.addEventListener("change", () => {
    const b = VIEWS[picker.value];
    if (b) view.fit(b, true);
    // Back to "Zoom to…", so the same place can be picked again after panning away.
    picker.value = "";
  });
  let paused = false;
  const bp = document.getElementById("bPause")!;
  const setPaused = (p: boolean) => {
    paused = p;
    bp.textContent = p ? "Play" : "Pause";
    bp.setAttribute("aria-pressed", String(p));
  };
  bp.addEventListener("click", () => setPaused(!paused));

  /** rain.html#lon,lat (from a spring's card on another map) opens zoomed in on that spot. */
  const home = (animate = false) => {
    const m = /^#(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(location.hash);
    const lon = m ? Number(m[1]) : NaN;
    const lat = m ? Number(m[2]) : NaN;
    const [w, s, e, n] = meta.bounds;
    if (lon >= w && lon <= e && lat >= s && lat <= n) view.flyTo(project(lon, lat), SPOT_SCALE, animate);
    else view.fit(VIEWS.all, animate);
  };

  // ----- boot -----
  readColors();
  view.resize();
  home();
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
    home();
  });
  addEventListener("hashchange", () => home(true));
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
      view.redraw();
    });
    bp.after(chip);
    view.redraw();
  });
}

main().catch(showLoadError);
