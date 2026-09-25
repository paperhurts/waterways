// The flow model behind the Santa Fe animation: how much water enters each
// reach, inferred from the difference between the gauges that bracket it.

import { fmtCfs } from "../shared/live";
import type { Flows } from "../shared/types";
import type { Reach } from "./content";

const v = (f: Flows, k: keyof Flows) => f[k] ?? 0;

/**
 * Water gained along each spring reach (cfs). Gains can't go negative: a
 * losing reach shows as zero rather than as springs running backward.
 * Hildreth's gain excludes the Ichetucknee, which enters between it and Fort White.
 */
export function reachGains(f: Flows): Record<Reach, number> {
  return {
    r441: Math.max(0, v(f, "U") - v(f, "R")),
    rFW: Math.max(0, v(f, "F") - v(f, "U")),
    rH: Math.max(0, v(f, "H") - v(f, "F") - v(f, "I")),
    ich: v(f, "I"),
    fan: v(f, "Fn"),
  };
}

export interface ReachInfo {
  gain: number;
  /** Upstream and downstream gauge, for the card text. */
  a: string;
  b: string;
  n: number;
  note?: string;
}

export function reachInfo(f: Flows, counts: Partial<Record<Reach, number>>): Partial<Record<Reach, ReachInfo>> {
  const g = reachGains(f);
  return {
    r441: { gain: g.r441, a: "River Rise", b: "US 441", n: counts.r441 ?? 0 },
    rFW: { gain: g.rFW, a: "US 441", b: "Fort White", n: counts.rFW ?? 0 },
    rH: { gain: g.rH, a: "Fort White", b: "Hildreth", n: counts.rH ?? 0, note: `after subtracting the Ichetucknee's ${fmtCfs(f.I)} cfs` },
    ich: { gain: g.ich, a: "its head springs", b: "the US 27 gauge", n: counts.ich ?? 0 },
  };
}

/** Share of Fort White's flow that entered below O'Leno, mostly from springs. */
export const springShare = (f: Flows): number => Math.max(0, Math.min(1, (v(f, "F") - v(f, "O")) / v(f, "F")));
