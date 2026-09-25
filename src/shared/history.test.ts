import { describe, expect, it } from "vitest";
import { ticks } from "./history";

describe("ticks", () => {
  it("steps in clean numbers and covers the maximum", () => {
    expect(ticks(897)).toEqual([0, 250, 500, 750, 1000]);
    expect(ticks(2400)).toEqual([0, 500, 1000, 1500, 2000, 2500]);
    expect(ticks(4000)).toEqual([0, 1000, 2000, 3000, 4000]);
  });

  it("reaches below zero when values do", () => {
    expect(ticks(3511, -173)).toEqual([-1000, 0, 1000, 2000, 3000, 4000]);
    expect(ticks(1200, -600)).toEqual([-1000, -500, 0, 500, 1000, 1500]);
  });
});
