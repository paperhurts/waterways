// The flow model behind the Lake Okeechobee animation: live USGS readings at the lake's
// outlets, netted by direction. East is the St. Lucie Canal at Port Mayaca (S-308); west
// is the Caloosahatchee at Moore Haven (S-77); south is S-351 (into the Hillsboro and
// North New River canals) and S-354 (the Miami Canal). USGS reports flow back into the
// lake as negative.

import type { LakeOFlows } from "../shared/types";

export type Direction = "east" | "west" | "south";

export const DIRECTION_KEYS: Record<Direction, (keyof LakeOFlows)[]> = {
  east: ["S308"],
  west: ["S77"],
  south: ["S351H", "S351N", "S354"],
};

/** Net flow out of the lake each way (negative is in), or null if none of its gauges report. */
export function directions(f: LakeOFlows): Record<Direction, number | null> {
  const net = (keys: (keyof LakeOFlows)[]) => {
    const vs = keys.map((k) => f[k]).filter((v): v is number => v != null);
    return vs.length ? vs.reduce((a, b) => a + b, 0) : null;
  };
  return { east: net(DIRECTION_KEYS.east), west: net(DIRECTION_KEYS.west), south: net(DIRECTION_KEYS.south) };
}

/**
 * What the Caloosahatchee picks up between Moore Haven and the Franklin Lock: the river's
 * own basin. The lock passes the lake's releases plus this.
 */
export function caloosahatcheeRunoff(f: LakeOFlows): number {
  if (f.S79 == null) return 0;
  return Math.max(0, f.S79 - Math.max(0, f.S77 ?? 0));
}

/** USGS's record at Port Mayaca resumes in 1982, and the south canals' starts in 1958. */
export const MODERN = 1982;

export interface HistorySummary {
  /** Mean since MODERN each way, over the years it reports. */
  mean: Record<Direction, number>;
  /** Years the south canals, on net, sent water into the lake instead of out. */
  southBack: number[];
  /** The decade (with at least MIN_DECADE years on record) the south canals pumped the most into the lake: its first year and mean. */
  pumping: { from: number; mean: number } | null;
}

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
/** A decade needs this many years on record to speak for it. */
const MIN_DECADE = 5;

export function summarize(h: { years: number[]; east: (number | null)[]; west: (number | null)[]; south: (number | null)[] }): HistorySummary {
  const since = (vs: (number | null)[]) => h.years.flatMap((y, i) => (y >= MODERN && vs[i] != null ? [vs[i]!] : []));
  const south = h.years.flatMap((year, i) => (h.south[i] == null ? [] : [{ year, cfs: h.south[i]! }]));
  const decades = new Map<number, number[]>();
  for (const r of south) decades.set(Math.floor(r.year / 10) * 10, [...(decades.get(Math.floor(r.year / 10) * 10) ?? []), r.cfs]);
  let pumping: HistorySummary["pumping"] = null;
  for (const [from, vs] of decades) {
    if (vs.length < MIN_DECADE) continue;
    const m = avg(vs);
    if (m < 0 && (!pumping || m < pumping.mean)) pumping = { from, mean: Math.round(m) };
  }
  return {
    mean: { east: Math.round(avg(since(h.east))), west: Math.round(avg(since(h.west))), south: Math.round(avg(since(h.south))) },
    southBack: south.filter((r) => r.cfs < 0).map((r) => r.year),
    pumping,
  };
}
