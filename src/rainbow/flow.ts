// The flow model behind the Rainbow animation, from the six gauges:
// Holder (WH) on the Withlacoochee above Dunnellon, the upper Rainbow (RbN) below the
// last of its head springs, the Rainbow's mouth (Rb), US 41 (WD) below the confluence,
// and the two ways out of Lake Rousseau at Inglis: the bypass channel (WB) down the old
// river, and the dam (WI) into the Cross Florida Barge Canal.

import type { RainbowFlows } from "../shared/types";

const v = (f: RainbowFlows, k: keyof RainbowFlows) => f[k] ?? 0;

export interface RainbowModel {
  /** What the springs above the upper gauge put out together. */
  springs: number;
  /** Each mapped vent's even share of that; individual vents aren't gauged. */
  perVent: number;
  /** Water gained between the upper gauge and the mouth: seepage and small springs. */
  lowerGain: number;
  /** The Rainbow's share of the river below Dunnellon, or null without both gauges. */
  rainbowShare: number | null;
  /** Share of Lake Rousseau's outflow released at the dam into the barge canal. */
  damShare: number;
}

export function rainbowModel(f: RainbowFlows, vents: number): RainbowModel {
  // Without the upper gauge, the mouth's reading is the best stand-in for the springs.
  const springs = f.RbN ?? v(f, "Rb");
  const below = f.Rb != null && f.WH != null ? f.Rb + f.WH : 0;
  const out = v(f, "WI") + v(f, "WB");
  return {
    springs,
    perVent: vents ? springs / vents : 0,
    lowerGain: f.RbN != null && f.Rb != null ? Math.max(0, f.Rb - f.RbN) : 0,
    rainbowShare: below > 0 ? f.Rb! / below : null,
    damShare: out > 0 ? v(f, "WI") / out : 0,
  };
}

/** Million gallons a day from cubic feet per second. */
export const mgd = (cfs: number): number => cfs * 0.6463;

export interface HistorySummary {
  first: { from: number; to: number; mean: number };
  last: { from: number; to: number; mean: number };
  low: { year: number; cfs: number };
  high: { year: number; cfs: number };
  /** Highest over lowest year: how much each stream swings. */
  rainbowSwing: number;
  riverSwing: number;
  /** The driest year on the Withlacoochee, and the Rainbow's share of the river below Dunnellon that year. */
  dryYear: { year: number; share: number };
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** The numbers the history panel's text is built from. */
export function summarize(h: { years: number[]; Rb: (number | null)[]; WH: (number | null)[] }, span = 10): HistorySummary {
  const rows = h.years.map((year, i) => ({ year, rb: h.Rb[i], wh: h.WH[i] })).filter((r) => r.rb != null) as { year: number; rb: number; wh: number | null }[];
  const decade = (xs: typeof rows) => ({ from: xs[0].year, to: xs[xs.length - 1].year, mean: Math.round(mean(xs.map((r) => r.rb))) });
  const low = rows.reduce((a, b) => (b.rb < a.rb ? b : a));
  const high = rows.reduce((a, b) => (b.rb > a.rb ? b : a));
  const river = rows.filter((r) => r.wh != null) as { year: number; rb: number; wh: number }[];
  const dry = river.reduce((a, b) => (b.wh < a.wh ? b : a));
  const wet = river.reduce((a, b) => (b.wh > a.wh ? b : a));
  return {
    first: decade(rows.slice(0, span)),
    last: decade(rows.slice(-span)),
    low: { year: low.year, cfs: low.rb },
    high: { year: high.year, cfs: high.rb },
    rainbowSwing: high.rb / low.rb,
    riverSwing: wet.wh / dry.wh,
    dryYear: { year: dry.year, share: dry.rb / (dry.rb + dry.wh) },
  };
}
