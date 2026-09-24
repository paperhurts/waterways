import "../shared/map.css";
import "./rain.css";
import { InfoCard } from "../shared/card";
import { escapeHtml, loadData, showLoadError } from "../shared/data";
import { KM_PER_UNIT, bounds, pointAt, project, type XY } from "../shared/geo";
import { decodeLakes, drawLakeLabels, drawLakes, inLake } from "../shared/lakes";
import { StreakLayer, drawBoil, fadeLayer } from "../shared/streaks";
import { cssVar, fontsReady, isDark, onColorSchemeChange } from "../shared/theme";
import { Fate, type LakesFile, type StreamsFile } from "../shared/types";
import { Viewport, startLoop } from "../shared/viewport";
import { decodeSegments, fateShares, sinkLabels, traceDownstream, type Trace } from "./network";

const FATES = [
  { v: "--gulf", label: "Reaches the Gulf", via: "Flows to the Suwannee and on to the Gulf of Mexico." },
  { v: "--atl", label: "Reaches the Atlantic", via: "Flows to the Ocklawaha River, then north along the St. Johns to the Atlantic. Water from Gainesville's east side passes through Orange Lake first, and some of it leaves through sinks on the way." },
  { v: "--sink", label: "Drops into a sink", via: "Ends at a mapped sink and goes straight into the Floridan aquifer." },
  { v: "--inland", label: "Ends inland", via: "Ends with no mapped outlet. That's usually a sink, a closed wetland, or a lake with no surface exit, but it can also be a gap in the map." },
  { v: "--off", label: "Leaves the map", via: "Flows off the edge of this map and ends somewhere beyond it." },
];

const VIEWS = {
  all: bounds(-82.99, 29.12, -81.5, 30.09),
  stj: bounds(-82.12, 29.14, -81.52, 29.56),
  gnv: bounds(-82.48, 29.57, -82.22, 29.72),
  ala: bounds(-82.62, 29.72, -82.36, 29.9),
  spr: bounds(-82.8, 29.8, -82.55, 29.95),
};

const PLACES: [string, number, number][] = [
  ["Gainesville", -82.325, 29.665], ["High Springs", -82.585, 29.815], ["Alachua", -82.47, 29.752],
  ["Fort White", -82.713, 29.905], ["Lake City", -82.64, 30.085], ["Newberry", -82.61, 29.646],
  ["Ocala", -82.14, 29.187], ["Silver Springs", -82.03, 29.235], ["Welaka", -81.672, 29.48],
];

/** Boil size by spring magnitude (index), so first-magnitude springs read as the giants they are. */
const MAG_SIZE = [1, 2, 1.45, 1.15, 1, 1, 1, 1, 1];
const MAG_TEXT = [
  "",
  "A first-magnitude spring: more than 100 cubic feet of water a second, about 65 million gallons a day. ",
  "A second-magnitude spring, flowing 10 to 100 cubic feet a second. ",
  "A third-magnitude spring, flowing 1 to 10 cubic feet a second. ",
];

/** Rain drops per second, and the cap on live particles. */
const RATE = 225;
const MAX_PARTICLES = 26000;
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
  const springs = data.springs.map(([lon, lat, name, mag]) => ({ xy: project(lon, lat), name, mag, phase: (((lon * 97.3 + lat * 41.1) % 1) + 1) % 1 }));
  const swallets = data.swallets.map(([lon, lat, name]) => ({ xy: project(lon, lat), name }));
  const pct = fateShares(segs);
  const sinks = sinkLabels(segs);
  // NHD draws virtual "artificial path" channels across lakes. The lake fill already
  // shows that water, so those lines stay faint; drops still flow along them. (Wide
  // rivers like the Suwannee are artificial paths too, so test against the lakes.)
  const throughLake = new Set(segs.filter((s) => s.artificial && inLake(lakes, pointAt(s, s.len / 2))));
  // Draw small creeks first so rivers sit on top.
  const order = [...segs].sort((a, b) => a.acc - b.acc);
  const base = (VIEWS.all[2] - VIEWS.all[0]) / 40;
  // Big rivers run faster than headwater creeks: speed grows with the log of upstream length.
  const vel = Float32Array.from(segs, (s) => base * (0.45 + 0.32 * Math.log10(s.acc + 1)));
  /** 0 creek, 1 stream, 2 river, by km of creek upstream. */
  const sizeClass = Uint8Array.from(segs, (s) => (s.acc < 15 ? 0 : s.acc < 150 ? 1 : 2));

  document.getElementById("lede")!.innerHTML =
    `Every mapped creek between the Suwannee and Gainesville, and along the water's route east to the St. Johns, colored by where it ends up. ` +
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
    C = Object.fromEntries(["bg", "ink", "muted", "spring", "hi", "line", "lake", "shore", "marsh"].map((n) => [n, cssVar(`--${n}`)]));
    FC = FATES.map((f) => cssVar(f.v));
    glow = isDark();
  };

  let selected: Trace | null = null;
  let tracer: { d: number; total: number; v: number; rest: number } | null = null;
  const card = new InfoCard();
  card.onShow = () => (document.getElementById("hint")!.style.display = "none");
  card.onHide = () => select(null);

  const view = new Viewport({
    minScale: 250,
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
    drawLakes(c, lakes, X, Y, view.cam, { lake: C.lake, shore: C.shore, marsh: C.marsh, label: C.muted });
    c.lineCap = "round";
    c.lineJoin = "round";
    const zs = Math.max(0.6, Math.min(2.2, view.scale / 1500));
    for (const s of order) {
      c.lineWidth = (0.45 + Math.log10(s.acc + 1) * 0.75) * zs;
      c.strokeStyle = FC[s.fate];
      c.globalAlpha = s.underground ? 0.4 : throughLake.has(s) ? 0.1 : glow ? 0.3 : 0.26;
      if (s.underground) c.setLineDash([3, 4]);
      c.beginPath();
      strokePath(c, s.pts);
      c.stroke();
      if (s.underground) c.setLineDash([]);
    }
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
    for (const [n, lon, lat] of PLACES) {
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
    label("Ocklawaha", -81.99, 29.37, FC[Fate.Atlantic]);
    label("St. Johns", -81.63, 29.54, FC[Fate.Atlantic]);
  }

  // ----- particles: rain falls on every creek, weighted by length -----
  // Rain on a big river starts as an already-merged drop, so it's spawned less often.
  const cumLen: number[] = [];
  let totalLen = 0;
  segs.forEach((s, i) => cumLen.push((totalLen += s.len * MERGE_KEEP ** sizeClass[i])));
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
    spawnAcc += RATE * dt;
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
          if ((s.fate === Fate.Sink || s.fate === Fate.Inland) && Math.random() < 0.15) {
            flashes.push({ xy: s.pts[s.pts.length - 1], t: 0, col: FC[s.fate], big: false });
          }
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
      card.show({ title: spring.name, kind: "Spring", color: C.spring, body: `${MAG_TEXT[spring.mag] ?? ""}Groundwater rising back to the surface. Water that drops into sinks upstream can come out at springs like this one, sometimes days later.` });
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
    const body = s0.fate === Fate.Sink && s0.sink ? `Ends at <b>${escapeHtml(s0.sink)}</b> and goes straight into the Floridan aquifer.` : F.via;
    const dist = s0.fate <= Fate.Atlantic
      ? `Its water travels at least ${Math.round(mi)} miles before leaving this map.`
      : `Its water travels about ${mi < 1 ? mi.toFixed(1) : Math.round(mi)} miles along the surface before it disappears.`;
    const underground = trace.path.some((s) => s.underground) ? " Part of the way it runs underground, through the aquifer." : "";
    const joins = trace.joins && trace.joins !== s0.name ? ` Along the way it joins ${escapeHtml(trace.joins)}.` : "";
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

  for (const [id, b] of [["vAll", VIEWS.all], ["vGnv", VIEWS.gnv], ["vAla", VIEWS.ala], ["vSpr", VIEWS.spr], ["vStj", VIEWS.stj]] as const) {
    document.getElementById(id)!.addEventListener("click", () => view.fit(b, true));
  }
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
}

main().catch(showLoadError);
