// Glints over the wetlands: sunlight catching the water between the sawgrass. Each
// wetland gets points in proportion to its area, placed once from a fixed seed (so the
// pattern holds from visit to visit), and each flashes now and then on the animated layer.

import { ringsPath, type XY } from "../shared/geo";

/** One glint per this many km² of wetland, and at most this many in one wetland. */
const KM2_PER_GLINT = 2.5;
const MAX_PER_WETLAND = 700;
/** Higher is a shorter, rarer flash: the share of time a glint shows at all. */
const SHARPNESS = 24;

export interface Glint {
  xy: XY;
  phase: number;
  speed: number;
}

/** A small seeded random number generator (mulberry32). */
function seeded(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Glint points inside each wetland (rings in map units, holes included). */
export function placeGlints(wetlands: { km2: number; rings: XY[][] }[]): Glint[] {
  const probe = document.createElement("canvas").getContext("2d")!;
  const rand = seeded(1987);
  const out: Glint[] = [];
  for (const w of wetlands) {
    const want = Math.min(MAX_PER_WETLAND, Math.max(1, Math.round(w.km2 / KM2_PER_GLINT)));
    const path = ringsPath(w.rings);
    const pts = w.rings.flat();
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    for (let n = 0, tries = 0; n < want && tries < want * 12; tries++) {
      const x = x0 + rand() * (x1 - x0);
      const y = y0 + rand() * (y1 - y0);
      if (!probe.isPointInPath(path, x, y, "evenodd")) continue;
      out.push({ xy: [x, y], phase: rand() * Math.PI * 2, speed: 0.5 + rand() * 1.1 });
      n++;
    }
  }
  return out;
}

/** How bright a glint is at time t (seconds): dark most of the time, then a quick flash. */
export const glintAlpha = (g: Glint, t: number): number => Math.max(0, Math.sin(g.speed * t + g.phase)) ** SHARPNESS;
