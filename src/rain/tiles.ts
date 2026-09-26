// Levels of detail for the rain map. The base file loads with the page; each later
// level's tiles of smaller creeks (and, in the first, smaller lakes) load once the map
// is zoomed in far enough to show them. No DOM here, so tests can use it.

import { bounds, type Bounds } from "../shared/geo";
import type { RainBase } from "../shared/types";

/** Pixels per map unit (about 111 km) at which each level's creeks appear. */
export const LEVEL_SCALE = [0, 450, 1200];

export interface TileRef {
  level: number;
  col: number;
  row: number;
  /** Id of its first segment; its segments' ids run on consecutively. */
  first: number;
  count: number;
  /** Path under public/data/rain/. */
  path: string;
  /** Its cell in map units. Segments are filed by their middle vertex, so they can reach a little past it. */
  box: Bounds;
}

export class TileIndex {
  readonly levels: TileRef[][];
  /** Every tile with segments, by first id, to find the tile holding an id. */
  private byFirst: TileRef[];

  constructor(meta: RainBase["meta"]) {
    const [west, south] = meta.gridOrigin;
    this.levels = meta.levels.map((lv, level) =>
      lv.tiles.map(([col, row, first, count]) => {
        const w = west + col * lv.tileDeg;
        const s = south + row * lv.tileDeg;
        return { level, col, row, first, count, path: `rain/${level}/${col}-${row}.json`, box: bounds(w, s, w + lv.tileDeg, s + lv.tileDeg) };
      }),
    );
    this.byFirst = this.levels.flat().filter((t) => t.count > 0).sort((a, b) => a.first - b.first);
  }

  /** The tile holding segment `id`, or undefined if it's in the base. */
  of(id: number): TileRef | undefined {
    const t = this.byFirst;
    let lo = 0;
    let hi = t.length - 1;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      if (id < t[m].first) hi = m - 1;
      else if (id >= t[m].first + t[m].count) lo = m + 1;
      else return t[m];
    }
    return undefined;
  }

  /** A level's tiles overlapping `view` (map units), widened by `margin` units. */
  visible(level: number, view: Bounds, margin = 0): TileRef[] {
    const [x0, y0, x1, y1] = view;
    return (this.levels[level] ?? []).filter(({ box: b }) => b[2] >= x0 - margin && b[0] <= x1 + margin && b[3] >= y0 - margin && b[1] <= y1 + margin);
  }
}
