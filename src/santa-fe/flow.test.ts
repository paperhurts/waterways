import { describe, expect, it } from "vitest";
import type { Flows } from "../shared/types";
import { reachGains, reachInfo, springShare } from "./flow";

const flows: Flows = { W: 40.9, O: 87.9, R: 94.9, U: 110, F: 664, I: 216, H: 1140, B: 2680, Bl: 3620, Wx: 5950, Fn: 71.8 };

describe("reachGains", () => {
  it("is the difference between the gauges bracketing each reach", () => {
    const g = reachGains(flows);
    expect(g.r441).toBeCloseTo(110 - 94.9);
    expect(g.rFW).toBeCloseTo(664 - 110);
    expect(g.ich).toBe(216);
    expect(g.fan).toBe(71.8);
  });

  it("subtracts the Ichetucknee from the Hildreth reach", () => {
    expect(reachGains(flows).rH).toBeCloseTo(1140 - 664 - 216);
  });

  it("never goes negative on a losing reach", () => {
    expect(reachGains({ ...flows, U: 50 }).r441).toBe(0);
  });

  it("treats missing gauges as zero", () => {
    expect(reachGains({ ...flows, Fn: null }).fan).toBe(0);
  });
});

describe("reachInfo", () => {
  it("carries spring counts and the Ichetucknee note", () => {
    const info = reachInfo(flows, { rFW: 13, rH: 4 });
    expect(info.rFW!.n).toBe(13);
    expect(info.r441!.n).toBe(0);
    expect(info.rH!.note).toContain("216");
  });
});

describe("springShare", () => {
  it("is Fort White's gain below O'Leno as a fraction", () => {
    expect(springShare(flows)).toBeCloseTo((664 - 87.9) / 664);
    expect(springShare({ ...flows, O: 900 })).toBe(0);
  });
});
