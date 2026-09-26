// Map projection and polyline helpers shared by both maps.
//
// Map units are equirectangular degrees centered on the basin: x is longitude
// scaled by cos(LAT0) so one unit is the same ground distance on both axes,
// and y is flipped so north is up on the canvas.

export type XY = [number, number];
/** Map-unit rectangle: [x0, y0, x1, y1] with y0 the northern edge. */
export type Bounds = [number, number, number, number];
/** A box on screen, in CSS px from the stage's corner. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const LAT0 = 29.8;
const LON0 = -82.6;
const KX = Math.cos((LAT0 * Math.PI) / 180);
/** One map unit is about one degree of latitude. */
export const KM_PER_UNIT = 111;

export const project = (lon: number, lat: number): XY => [(lon - LON0) * KX, -(lat - LAT0)];

export function bounds(west: number, south: number, east: number, north: number): Bounds {
  const a = project(west, north);
  const b = project(east, south);
  return [a[0], a[1], b[0], b[1]];
}

export interface Polyline {
  pts: XY[];
  /** Cumulative distance to each vertex, in map units. */
  cum: number[];
  len: number;
}

export function polyline(pts: XY[]): Polyline {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  }
  // A zero-length segment would divide by zero when particles are spread by length.
  return { pts, cum, len: cum[cum.length - 1] || 1e-6 };
}

/** The vertex pair bracketing distance `d`, and how far between them `d` falls. */
export function locate(line: Polyline, d: number): { lo: number; hi: number; t: number } {
  const c = line.cum;
  const last = c.length - 1;
  if (d <= 0) return { lo: 0, hi: 0, t: 0 };
  if (d >= line.len) return { lo: last, hi: last, t: 0 };
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (c[m] <= d) lo = m;
    else hi = m;
  }
  return { lo, hi, t: (d - c[lo]) / (c[hi] - c[lo] || 1) };
}

export function pointAt(line: Polyline, d: number): XY {
  const { lo, hi, t } = locate(line, d);
  const a = line.pts[lo];
  const b = line.pts[hi];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/**
 * Split a polyline into runs of like edges, given per-vertex flags: an edge is
 * flagged when both its ends are. Runs share their boundary vertex, so the
 * pieces join without gaps. Returns inclusive vertex ranges.
 */
export function edgeRuns(flags: ArrayLike<number>): { flagged: boolean; from: number; to: number }[] {
  const runs: { flagged: boolean; from: number; to: number }[] = [];
  for (let i = 1; i < flags.length; i++) {
    const flagged = !!(flags[i - 1] && flags[i]);
    const last = runs[runs.length - 1];
    if (last && last.flagged === flagged) last.to = i;
    else runs.push({ flagged, from: i - 1, to: i });
  }
  return runs;
}

/** Distance along the line of the vertex closest to (x, y). */
export function nearestDistance(line: Polyline, x: number, y: number): number {
  let bi = 0;
  let bd = Infinity;
  for (let i = 0; i < line.pts.length; i++) {
    const d = (line.pts[i][0] - x) ** 2 + (line.pts[i][1] - y) ** 2;
    if (d < bd) {
      bd = d;
      bi = i;
    }
  }
  return line.cum[bi];
}

/** Packed rings (flat ints of (lon - origin) * scale, as the pipeline writes them) in map units. */
export function unpackRings(rings: number[][], [ox, oy]: [number, number], scale: number): XY[][] {
  return rings.map((flat) => {
    const pts: XY[] = [];
    for (let i = 0; i < flat.length; i += 2) pts.push(project(flat[i] / scale + ox, flat[i + 1] / scale + oy));
    return pts;
  });
}

/** One Path2D (map units) of every ring, for even-odd fills and hit tests. */
export function ringsPath(rings: XY[][]): Path2D {
  const p = new Path2D();
  for (const r of rings) r.forEach((q, i) => (i ? p.lineTo(q[0], q[1]) : p.moveTo(q[0], q[1])));
  return p;
}
