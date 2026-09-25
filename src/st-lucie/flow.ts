// The flow model behind the St. Lucie animation. Two USGS gauges bracket the St. Lucie
// Canal (C-44): S-308 at Port Mayaca, where it leaves Lake Okeechobee, and S-80 at the
// St. Lucie Lock, where it spills into the South Fork. Both report flow running back
// toward the lake as negative. Two stations in the estuary report salinity near the
// surface and near the bottom.

import type { Salinity } from "../shared/types";

export interface CanalModel {
  /** Lake water released into the canal at Port Mayaca (cfs). */
  fromLake: number;
  /** Canal water running back into the lake at Port Mayaca. */
  toLake: number;
  /** What the canal sends through the St. Lucie Lock to the estuary. */
  toEstuary: number;
  /** Runoff the canal gathers between the two gauges: whatever leaves its ends beyond what the lake put in. */
  basin: number;
  /** Share of the water at the lock that came from the lake. */
  lakeShare: number;
  /**
   * How far from Port Mayaca toward the lock (0–1) the canal's runoff divides when some of it
   * runs back to the lake. Runoff west of here flows to the lake; east of it, to the lock.
   */
  divide: number;
}

export function canalModel(s308: number | null, s80: number | null): CanalModel {
  const a = s308 ?? 0;
  // A slightly negative reading above the lock is water sloshing against a closed gate, not
  // estuary water coming in: nothing is going through.
  const toEstuary = Math.max(0, s80 ?? 0);
  const fromLake = Math.max(0, a);
  const toLake = Math.max(0, -a);
  return {
    fromLake,
    toLake,
    toEstuary,
    basin: Math.max(0, toEstuary + toLake - fromLake),
    lakeShare: toEstuary > 0 ? Math.min(1, fromLake / toEstuary) : 0,
    divide: toLake > 0 ? toLake / (toLake + toEstuary) : 0,
  };
}

/** Open ocean, parts per thousand. */
export const SEAWATER = 35;

/** One number per station for the map: the average of its two sensors, or whichever is reporting. */
export function stationSalinity(s: Salinity | undefined): number | null {
  const vs = [s?.top, s?.bottom].filter((v): v is number => v != null);
  return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null;
}

/** [distance upstream from the inlet, ppt], in order upstream. */
export type Knot = [d: number, ppt: number];

/**
 * Salinity along a branch of the estuary, from seawater at the inlet (d = 0) through the
 * stations' readings to fresh water at `freshAt`. Missing stations drop out. Salinity can
 * only fall going upstream, so a station reading saltier than the one below it is held
 * to that one's value.
 */
export function saltProfile(stations: { d: number; ppt: number | null }[], freshAt: number): Knot[] {
  const knots: Knot[] = [[0, SEAWATER]];
  for (const s of [...stations].sort((a, b) => a.d - b.d)) {
    if (s.ppt == null || s.d <= 0 || s.d >= freshAt) continue;
    knots.push([s.d, Math.min(s.ppt, knots[knots.length - 1][1])]);
  }
  knots.push([freshAt, 0]);
  return knots;
}

/** Salinity at distance d on a profile. */
export function saltAt(knots: Knot[], d: number): number {
  if (d <= knots[0][0]) return knots[0][1];
  for (let i = 1; i < knots.length; i++) {
    const [d1, s1] = knots[i];
    if (d <= d1) {
      const [d0, s0] = knots[i - 1];
      return s0 + ((s1 - s0) * (d - d0)) / (d1 - d0 || 1);
    }
  }
  return knots[knots.length - 1][1];
}

/**
 * How far upstream a drop of seawater gets, for u in [0, 1): the distance where the profile
 * falls to u × seawater. Drops sent this far and back again pile up in proportion to the
 * salinity, so the density of seawater drops along the estuary draws its salinity.
 */
export function reach(knots: Knot[], u: number): number {
  const target = u * SEAWATER;
  for (let i = 1; i < knots.length; i++) {
    const [d0, s0] = knots[i - 1];
    const [d1, s1] = knots[i];
    if (s1 <= target) return s0 === s1 ? d0 : d0 + ((s0 - target) * (d1 - d0)) / (s0 - s1);
  }
  return knots[knots.length - 1][0];
}

/** Million gallons a day from cubic feet per second. */
export const mgd = (cfs: number): number => cfs * 0.6463;

/** USGS's record at Port Mayaca resumes in 1982, after the lock there (S-308) was built in 1977. */
export const MODERN = 1982;

export interface HistorySummary {
  /** The lake's biggest release year on record at Port Mayaca. */
  peak: { year: number; cfs: number };
  /** The biggest release years since MODERN, largest first. */
  bursts: { year: number; cfs: number }[];
  /** Years since MODERN with net flow back into the lake, and how many years that span has on record. */
  back: { years: number[]; of: number };
  /** The lock's biggest year since MODERN, lake water and the canal's runoff together. */
  lock: { year: number; cfs: number } | null;
}

/** The numbers the history panel's text is built from. */
export function summarize(h: { years: number[]; S308: (number | null)[]; S80: (number | null)[] }, top = 3): HistorySummary {
  const rows = (vs: (number | null)[]) => h.years.flatMap((year, i) => (vs[i] == null ? [] : [{ year, cfs: vs[i]! }]));
  const most = (xs: { year: number; cfs: number }[]) => xs.reduce((a, b) => (b.cfs > a.cfs ? b : a));
  const lake = rows(h.S308);
  const modern = lake.filter((r) => r.year >= MODERN);
  const lock = rows(h.S80).filter((r) => r.year >= MODERN);
  return {
    peak: most(lake),
    bursts: [...modern].sort((a, b) => b.cfs - a.cfs).slice(0, top),
    back: { years: modern.filter((r) => r.cfs < 0).map((r) => r.year), of: modern.length },
    lock: lock.length ? most(lock) : null,
  };
}
