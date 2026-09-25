import { describe, expect, it } from "vitest";
import { caloosahatcheeRunoff, directions, summarize } from "./flow";

const none = { S308: null, S77: null, S79: null, S351H: null, S351N: null, S354: null, FEC: null };

describe("directions", () => {
  it("nets each way's gauges, keeping flow into the lake negative", () => {
    const d = directions({ ...none, S308: -557, S77: 900, S351H: 30, S351N: -10, S354: 200 });
    expect(d).toEqual({ east: -557, west: 900, south: 220 });
  });

  it("is null for a way with no reports, and sums the gauges that do report", () => {
    expect(directions({ ...none, S351H: 40 }).south).toBe(40);
    expect(directions(none).east).toBeNull();
  });
});

describe("caloosahatcheeRunoff", () => {
  it("is what the Franklin Lock passes beyond the lake's release", () => {
    expect(caloosahatcheeRunoff({ ...none, S77: 900, S79: 1800 })).toBe(900);
    expect(caloosahatcheeRunoff({ ...none, S77: -50, S79: 300 })).toBe(300);
    expect(caloosahatcheeRunoff({ ...none, S77: 900, S79: 700 })).toBe(0);
    expect(caloosahatcheeRunoff({ ...none, S77: 900 })).toBe(0);
  });
});

describe("summarize", () => {
  it("averages each way since 1982 and finds the decade the south canals ran backward", () => {
    const years = [1958, 1959, 1960, 1961, 1962, 1963, 1964, 1970, 1982, 1983];
    const h = {
      years,
      east: [null, null, null, null, null, null, null, null, 100, 300],
      west: years.map((y) => (y < 1982 ? 2500 : y === 1982 ? 1000 : 1400)),
      // Two years in the 1950s aren't enough to speak for the decade.
      south: [-900, -900, -500, -300, -400, -400, -400, -270, 200, 100],
    };
    const s = summarize(h);
    expect(s.mean).toEqual({ east: 200, west: 1200, south: 150 });
    expect(s.southBack).toEqual([1958, 1959, 1960, 1961, 1962, 1963, 1964, 1970]);
    expect(s.pumping).toEqual({ from: 1960, mean: -400 });
  });
});
