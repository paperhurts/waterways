import { describe, expect, it } from "vitest";
import { RAINBOW_KEYS, type RainbowFlows } from "../shared/types";
import { mgd, rainbowModel, summarize } from "./flow";

const flows = (f: Partial<RainbowFlows>): RainbowFlows => ({ ...(Object.fromEntries(RAINBOW_KEYS.map((k) => [k, null])) as RainbowFlows), ...f });

describe("rainbowModel", () => {
  it("spreads the upper gauge evenly over the vents and finds the lower river's gain", () => {
    const m = rainbowModel(flows({ WH: 432, RbN: 447, Rb: 493, WB: 482, WI: 0 }), 20);
    expect(m.springs).toBe(447);
    expect(m.perVent).toBeCloseTo(22.35);
    expect(m.lowerGain).toBe(46);
    expect(m.rainbowShare).toBeCloseTo(493 / 925);
    expect(m.damShare).toBe(0);
  });

  it("never shows the lower Rainbow losing water", () => {
    expect(rainbowModel(flows({ RbN: 500, Rb: 480 }), 4).lowerGain).toBe(0);
  });

  it("splits Lake Rousseau's outflow between the dam and the bypass", () => {
    expect(rainbowModel(flows({ WB: 993, WI: 662 }), 1).damShare).toBeCloseTo(662 / 1655);
  });

  it("falls back to the mouth when the upper gauge is out, and gives no share without Holder", () => {
    const m = rainbowModel(flows({ Rb: 600 }), 3);
    expect(m.springs).toBe(600);
    expect(m.lowerGain).toBe(0);
    expect(m.rainbowShare).toBeNull();
  });
});

describe("mgd", () => {
  it("converts cubic feet per second to million gallons a day", () => {
    expect(mgd(100)).toBeCloseTo(64.63);
  });
});

describe("summarize", () => {
  const years = Array.from({ length: 30 }, (_, i) => 1966 + i);
  const Rb = years.map((y) => (y < 1976 ? 750 : y > 1985 ? 650 : 700));
  const WH = years.map((y) => (y === 1981 ? 150 : y === 1970 ? 3000 : 900));

  it("compares the first and last ten years", () => {
    const s = summarize({ years, Rb, WH });
    expect(s.first).toEqual({ from: 1966, to: 1975, mean: 750 });
    expect(s.last).toEqual({ from: 1986, to: 1995, mean: 650 });
  });

  it("measures how much the spring and the river swing", () => {
    const s = summarize({ years, Rb, WH });
    expect(s.rainbowSwing).toBeCloseTo(750 / 650);
    expect(s.riverSwing).toBeCloseTo(3000 / 150);
    expect(s.dryYear).toEqual({ year: 1981, share: 700 / 850 });
  });
});
