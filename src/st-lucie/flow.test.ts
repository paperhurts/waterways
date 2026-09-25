import { describe, expect, it } from "vitest";
import { SEAWATER, canalModel, reach, saltAt, saltProfile, stationSalinity, summarize } from "./flow";

describe("canalModel", () => {
  it("adds the canal's own runoff to lake releases on the way to the estuary", () => {
    const m = canalModel(1200, 1500);
    expect(m.fromLake).toBe(1200);
    expect(m.basin).toBe(300);
    expect(m.lakeShare).toBeCloseTo(0.8);
    expect(m.divide).toBe(0);
  });

  it("splits the runoff between the lake and the lock when the canal runs backward", () => {
    const m = canalModel(-600, 200);
    expect(m.fromLake).toBe(0);
    expect(m.toLake).toBe(600);
    expect(m.basin).toBe(800);
    expect(m.divide).toBeCloseTo(0.75);
    expect(m.lakeShare).toBe(0);
  });

  it("sends nothing through a closed lock", () => {
    const m = canalModel(-648, -81.7);
    expect(m.toEstuary).toBe(0);
    expect(m.basin).toBe(648);
    expect(m.divide).toBe(1);
  });

  it("never makes runoff negative when the lock passes less than the lake released", () => {
    expect(canalModel(900, 700).basin).toBe(0);
    expect(canalModel(900, 700).lakeShare).toBe(1);
    expect(canalModel(null, null)).toMatchObject({ fromLake: 0, toLake: 0, toEstuary: 0, basin: 0 });
  });
});

describe("stationSalinity", () => {
  it("averages the two sensors, or uses whichever is reporting", () => {
    expect(stationSalinity({ top: 13, bottom: 21 })).toBe(17);
    expect(stationSalinity({ top: 23, bottom: null })).toBe(23);
    expect(stationSalinity({ top: null, bottom: null })).toBeNull();
    expect(stationSalinity(undefined)).toBeNull();
  });
});

describe("saltProfile", () => {
  it("runs from seawater at the inlet through the stations to fresh water", () => {
    const k = saltProfile([{ d: 2, ppt: 20 }, { d: 1, ppt: 30 }], 4);
    expect(k).toEqual([[0, SEAWATER], [1, 30], [2, 20], [4, 0]]);
    expect(saltAt(k, 0.5)).toBeCloseTo(32.5);
    expect(saltAt(k, 3)).toBeCloseTo(10);
    expect(saltAt(k, 9)).toBe(0);
  });

  it("never gets saltier going upstream, and skips missing stations", () => {
    expect(saltProfile([{ d: 1, ppt: 10 }, { d: 2, ppt: 18 }, { d: 3, ppt: null }], 4)).toEqual([[0, SEAWATER], [1, 10], [2, 10], [4, 0]]);
  });
});

describe("reach", () => {
  it("inverts the profile: drops get as far as the salinity falls to their share of seawater", () => {
    const k = saltProfile([{ d: 1, ppt: 17.5 }], 2);
    expect(reach(k, 0)).toBe(2);
    expect(reach(k, 0.5)).toBeCloseTo(1);
    expect(reach(k, 0.75)).toBeCloseTo(0.5);
    for (let u = 0; u < 1; u += 0.05) expect(saltAt(k, reach(k, u))).toBeCloseTo(u * SEAWATER);
  });

  it("stops at a flat stretch rather than skipping past it", () => {
    const k = saltProfile([{ d: 1, ppt: 10 }, { d: 2, ppt: 10 }], 3);
    expect(reach(k, 10 / SEAWATER)).toBeCloseTo(1);
  });
});

describe("summarize", () => {
  it("finds the peak year, the biggest modern releases, and the years the lake took water back", () => {
    const h = { years: [1948, 1949, 1982, 1983, 1984, 1985], S308: [3511, 2206, 58, 1442, null, -25], S80: [4000, null, 125, 1677, 634, null] };
    const s = summarize(h, 2);
    expect(s.peak).toEqual({ year: 1948, cfs: 3511 });
    expect(s.bursts).toEqual([{ year: 1983, cfs: 1442 }, { year: 1982, cfs: 58 }]);
    expect(s.back).toEqual({ years: [1985], of: 3 });
    // The lock's biggest year counts only the modern record.
    expect(s.lock).toEqual({ year: 1983, cfs: 1677 });
  });
});
