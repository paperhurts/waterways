import { describe, expect, it } from "vitest";
import { bounds, edgeRuns, locate, nearestDistance, pointAt, polyline, project } from "./geo";

describe("project", () => {
  it("puts the reference point at the origin with north up", () => {
    expect(project(-82.6, 29.8)).toEqual([0, -0]);
    const [, yNorth] = project(-82.6, 30);
    expect(yNorth).toBeLessThan(0);
  });

  it("shrinks longitude by cos(latitude) so axes share a scale", () => {
    const [x] = project(-81.6, 29.8);
    expect(x).toBeCloseTo(Math.cos((29.8 * Math.PI) / 180), 10);
  });

  it("builds bounds with the northern edge first", () => {
    const [x0, y0, x1, y1] = bounds(-83, 29.5, -82, 30);
    expect(x0).toBeLessThan(x1);
    expect(y0).toBeLessThan(y1);
  });
});

describe("edgeRuns", () => {
  it("flags an edge only when both ends are flagged, sharing boundary vertices", () => {
    expect(edgeRuns([0, 0, 1, 1, 1, 0])).toEqual([
      { flagged: false, from: 0, to: 2 },
      { flagged: true, from: 2, to: 4 },
      { flagged: false, from: 4, to: 5 },
    ]);
  });

  it("returns nothing for a single vertex", () => {
    expect(edgeRuns([1])).toEqual([]);
  });
});

describe("polyline", () => {
  const line = polyline([[0, 0], [3, 4], [3, 10]]);

  it("accumulates segment lengths", () => {
    expect(line.cum).toEqual([0, 5, 11]);
    expect(line.len).toBe(11);
  });

  it("gives zero-length lines a tiny positive length", () => {
    expect(polyline([[1, 1], [1, 1]]).len).toBeGreaterThan(0);
  });

  it("clamps positions to the ends", () => {
    expect(pointAt(line, -1)).toEqual([0, 0]);
    expect(pointAt(line, 99)).toEqual([3, 10]);
    expect(locate(line, 99)).toEqual({ lo: 2, hi: 2, t: 0 });
  });

  it("interpolates within a segment", () => {
    expect(pointAt(line, 2.5)).toEqual([1.5, 2]);
    expect(pointAt(line, 8)).toEqual([3, 7]);
  });

  it("finds the nearest vertex's distance along the line", () => {
    expect(nearestDistance(line, 3.2, 9)).toBe(11);
    expect(nearestDistance(line, 2.9, 4.2)).toBe(5);
  });
});
