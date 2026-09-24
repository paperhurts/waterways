// Upper Floridan aquifer surfaces: decoding the packed grids, blending
// between years, coloring, and contouring.

import type { GridSpec, LonLat } from "../shared/types";

/** Each cell is one byte of half-feet: 0–127.5 ft above sea level. */
export function decodeGrid(b64: string): Float32Array {
  const bin = atob(b64);
  const out = new Float32Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) / 2;
  return out;
}

export function blend(a: Float32Array, b: Float32Array, t: number): Float32Array {
  if (t < 0.001) return a;
  const out = new Float32Array(a.length);
  for (let k = 0; k < a.length; k++) out[k] = a[k] + (b[k] - a[k]) * t;
  return out;
}

type Ramp = [ft: number, rgb: [number, number, number]][];
const DARK_RAMP: Ramp = [[0, [22, 22, 30]], [20, [28, 36, 54]], [40, [36, 62, 88]], [60, [46, 92, 112]], [90, [64, 128, 136]]];
const LIGHT_RAMP: Ramp = [[0, [228, 230, 222]], [20, [208, 218, 221]], [40, [180, 201, 211]], [60, [150, 182, 199]], [90, [118, 158, 184]]];
/** Cells within this many of the grid edge fade out, hiding the hard boundary. */
const EDGE_FADE = 10;

/** RGBA pixels, north-up (the grid is stored south-up). */
export function colorize(z: Float32Array, nx: number, ny: number, dark: boolean): Uint8ClampedArray<ArrayBuffer> {
  const ramp = dark ? DARK_RAMP : LIGHT_RAMP;
  const px = new Uint8ClampedArray(nx * ny * 4);
  for (let i = 0; i < ny; i++) {
    for (let j = 0; j < nx; j++) {
      const v = z[i * nx + j];
      let k = 0;
      while (k < ramp.length - 2 && v > ramp[k + 1][0]) k++;
      const [v0, c0] = ramp[k];
      const [v1, c1] = ramp[k + 1];
      const t = Math.max(0, Math.min(1, (v - v0) / (v1 - v0)));
      const o = ((ny - 1 - i) * nx + j) * 4;
      px[o] = c0[0] + (c1[0] - c0[0]) * t;
      px[o + 1] = c0[1] + (c1[1] - c0[1]) * t;
      px[o + 2] = c0[2] + (c1[2] - c0[2]) * t;
      const e = Math.min(i, j, ny - 1 - i, nx - 1 - j);
      px[o + 3] = e >= EDGE_FADE ? 255 : Math.round(255 * (e / EDGE_FADE) ** 1.5);
    }
  }
  return px;
}

export interface ContourLine {
  level: number;
  /** Line segments as [lon, lat] pairs. */
  segs: [LonLat, LonLat][];
  /** Candidate spots for the "40 ft" label, spread pseudo-randomly across the grid; draw at the first one on screen. */
  labels: LonLat[];
}

/**
 * Marching squares over the grid at each level. Saddle cells (two crossings
 * per pair of edges) are paired in edge order, which is fine at 10-ft spacing.
 */
export function contour(z: Float32Array, g: GridSpec, levels: number[]): ContourLine[] {
  const { nx, ny } = g;
  const lon = (j: number) => g.lon0 + j * g.res;
  const lat = (i: number) => g.lat0 + i * g.res;
  return levels.map((L) => {
    const segs: [LonLat, LonLat][] = [];
    const labels: LonLat[] = [];
    for (let i = 0; i < ny - 1; i++) {
      for (let j = 0; j < nx - 1; j++) {
        const v = [z[i * nx + j], z[i * nx + j + 1], z[(i + 1) * nx + j + 1], z[(i + 1) * nx + j]];
        const idx = (+(v[0] > L)) | (+(v[1] > L) << 1) | (+(v[2] > L) << 2) | (+(v[3] > L) << 3);
        if (idx === 0 || idx === 15) continue;
        const e: LonLat[] = [];
        const edge = (p: number, q: number, pi: number, pj: number, qi: number, qj: number) => {
          if (v[p] > L !== v[q] > L) {
            const t = (L - v[p]) / (v[q] - v[p]);
            e.push([lon(pj + (qj - pj) * t), lat(pi + (qi - pi) * t)]);
          }
        };
        edge(0, 1, i, j, i, j + 1);
        edge(1, 2, i, j + 1, i + 1, j + 1);
        edge(3, 2, i + 1, j, i + 1, j + 1);
        edge(0, 3, i, j, i + 1, j);
        for (let k = 0; k + 1 < e.length; k += 2) segs.push([e[k], e[k + 1]]);
        if (e.length && (i * 7 + j) % 97 === 0) labels.push(e[0]);
      }
    }
    return { level: L, segs, labels };
  });
}
