// The lagoon's flushing grid: km by water from each cell to the nearest inlet. No DOM
// here, so tests can use it.

import type { IndianRiverFile } from "../shared/types";

export const NOT_LAGOON = 255;

export class FlushGrid {
  readonly km: Uint8Array;
  readonly lon0: number;
  readonly lat0: number;
  readonly res: number;
  readonly nx: number;
  readonly ny: number;
  readonly farthest: number;

  constructor(g: IndianRiverFile["grid"]) {
    this.km = Uint8Array.from(atob(g.km), (ch) => ch.charCodeAt(0));
    ({ lon0: this.lon0, lat0: this.lat0, res: this.res, nx: this.nx, ny: this.ny, farthest: this.farthest } = g);
  }

  /** km at a cell, or NOT_LAGOON off the grid. Row 0 is the south edge. */
  cell(col: number, row: number): number {
    if (col < 0 || row < 0 || col >= this.nx || row >= this.ny) return NOT_LAGOON;
    return this.km[row * this.nx + col];
  }

  /** km by water to the nearest inlet at a point, or NOT_LAGOON off the lagoon. */
  at(lon: number, lat: number): number {
    return this.cell(Math.floor((lon - this.lon0) / this.res), Math.floor((lat - this.lat0) / this.res));
  }

  /**
   * The unit step (in lon, lat degrees) toward the nearest inlet from a point: the
   * neighboring lagoon cell that's closest to one, or null at an inlet or off the lagoon.
   */
  downhill(lon: number, lat: number): [number, number] | null {
    const col = Math.floor((lon - this.lon0) / this.res);
    const row = Math.floor((lat - this.lat0) / this.res);
    const here = this.cell(col, row);
    if (here === NOT_LAGOON) return null;
    let best: [number, number] | null = null;
    let bestKm = here;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const k = this.cell(col + dc, row + dr);
        if ((dr || dc) && k !== NOT_LAGOON && k < bestKm) {
          bestKm = k;
          const len = Math.hypot(dc, dr);
          best = [dc / len, dr / len];
        }
      }
    }
    return best;
  }

  /**
   * A unit step away from the inlets: one of the neighboring lagoon cells farther from
   * one, chosen by `pick` (0 to 1), or null where none is.
   */
  uphill(lon: number, lat: number, pick: number): [number, number] | null {
    const col = Math.floor((lon - this.lon0) / this.res);
    const row = Math.floor((lat - this.lat0) / this.res);
    const here = this.cell(col, row);
    if (here === NOT_LAGOON) return null;
    const up: [number, number][] = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const k = this.cell(col + dc, row + dr);
        if ((dr || dc) && k !== NOT_LAGOON && k > here) {
          const len = Math.hypot(dc, dr);
          up.push([dc / len, dr / len]);
        }
      }
    }
    return up.length ? up[Math.min(up.length - 1, Math.floor(pick * up.length))] : null;
  }

  /** Where water at a point reaches an inlet, following the lagoon downhill; null off the lagoon. */
  toInlet(lon: number, lat: number): [number, number] | null {
    if (this.at(lon, lat) === NOT_LAGOON) return null;
    for (let i = 0; i < 10_000; i++) {
      const step = this.downhill(lon, lat);
      if (!step) break;
      lon += step[0] * this.res;
      lat += step[1] * this.res;
    }
    return [lon, lat];
  }
}
