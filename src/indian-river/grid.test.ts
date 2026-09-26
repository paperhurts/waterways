import { describe, expect, it } from "vitest";
import { FlushGrid, NOT_LAGOON } from "./grid";

// A 3 x 2 grid of 0.1° cells from (-81, 27): row 0 (south) is 0, 1, 2 km; row 1 is land, 3, land.
const L = NOT_LAGOON;
const km = btoa(String.fromCharCode(0, 1, 2, L, 3, L));
const grid = new FlushGrid({ lon0: -81, lat0: 27, res: 0.1, nx: 3, ny: 2, km, farthest: 3 });

describe("FlushGrid", () => {
  it("reads km at a point, row 0 at the south edge", () => {
    expect(grid.at(-80.95, 27.05)).toBe(0);
    expect(grid.at(-80.75, 27.05)).toBe(2);
    expect(grid.at(-80.85, 27.15)).toBe(3);
    expect(grid.at(-80.95, 27.15)).toBe(NOT_LAGOON);
    expect(grid.at(-82, 27.05)).toBe(NOT_LAGOON);
  });

  it("steps toward the nearest inlet, through lagoon cells only", () => {
    // From the 2 km cell, west to the 1 km cell.
    expect(grid.downhill(-80.75, 27.05)).toEqual([-1, 0]);
    // From the 3 km cell, the lowest neighbor is the 0 km cell to the southwest.
    const [dx, dy] = grid.downhill(-80.85, 27.15)!;
    expect(dx).toBeCloseTo(-Math.SQRT1_2);
    expect(dy).toBeCloseTo(-Math.SQRT1_2);
    // At an inlet, or off the lagoon, there's nowhere lower to go.
    expect(grid.downhill(-80.95, 27.05)).toBeNull();
    expect(grid.downhill(-80.95, 27.15)).toBeNull();
  });

  it("steps away from the inlets, and follows the water to one", () => {
    expect(grid.uphill(-80.95, 27.05, 0)).toEqual([1, 0]);
    // The 2 km cell's only farther neighbor is the 3 km cell to its northwest.
    const [dx, dy] = grid.uphill(-80.75, 27.05, 0.9)!;
    expect([Math.sign(dx), Math.sign(dy)]).toEqual([-1, 1]);
    // The farthest cell has nowhere farther.
    expect(grid.uphill(-80.85, 27.15, 0.5)).toBeNull();
    const [lon, lat] = grid.toInlet(-80.75, 27.05)!;
    expect(grid.at(lon, lat)).toBe(0);
    expect(grid.toInlet(-80.95, 27.15)).toBeNull();
  });
});
