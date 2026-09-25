import { describe, expect, it } from "vitest";
import { Fate, SegFlag, type RainSeg } from "../shared/types";
import { decodeSegments, traceDownstream, traceLoading, unpackDelta, type Segment } from "./network";

const packing = { coordOrigin: [-83, 29.5] as [number, number], coordScale: 1e4 };
const seg = (coords: number[], fate: number, next: number, acc: number, name = -1, sink = -1, flags = 0): RainSeg => [coords, fate as Fate, next, acc, name, sink, flags];
const names = ["Mill Creek", "Santa Fe River", "Big Sink"];

// A tiny network split like the real one: the base holds ids 0-2 (0 → 1 → 2, a mouth on
// the Gulf), and a tile holds ids 10-11 (10 → 1, and 11 into "Big Sink").
const base = decodeSegments(
  [seg([0, 0, 100, 0], Fate.Gulf, 1, 10, 0), seg([100, 0, 100, 0], Fate.Gulf, 2, 30, 1), seg([200, 0, 100, 0], Fate.Gulf, -1, 40, 1, -1, SegFlag.Mouth | SegFlag.Lake)],
  names,
  0,
  packing,
);
const tile = decodeSegments([seg([100, 100, 0, -100], Fate.Gulf, 1, 1), seg([0, 500, 0, 100], Fate.Sink, -1, 2, -1, 2, SegFlag.Underground)], names, 10, packing);
const byId = new Map<number, Segment>([...base, ...tile].map((s) => [s.id, s]));
const get = (id: number) => byId.get(id);

describe("decodeSegments", () => {
  it("numbers segments from the file's first id and resolves names, sinks, and flags", () => {
    expect(tile.map((s) => s.id)).toEqual([10, 11]);
    expect(base[0].name).toBe("Mill Creek");
    expect(tile[0].name).toBeNull();
    expect(tile[1].sink).toBe("Big Sink");
    expect([base[2].mouth, base[2].lake, base[2].underground, base[2].lakeo]).toEqual([true, true, false, false]);
    expect(tile[1].underground).toBe(true);
  });

  it("decodes delta-packed coordinates through the origin and scale", () => {
    // Each step of 100 at scale 1e4 is 0.01° of longitude.
    const pts = unpackDelta([0, 0, 100, 0, 100, 0], packing);
    expect(pts[2][0] - pts[1][0]).toBeCloseTo(0.01 * Math.cos((29.8 * Math.PI) / 180), 10);
    expect(pts[1][0] - pts[0][0]).toBeCloseTo(pts[2][0] - pts[1][0], 10);
    // Each segment's first point is absolute: the tile's creek starts 0.01° north and ends where the base's first creek does.
    expect(tile[0].pts[1]).toEqual(base[0].pts[1]);
  });
});

describe("traceDownstream", () => {
  it("follows ids from a tile into the base, to the terminus", () => {
    const t = traceDownstream(get, 10);
    expect(t.path.map((s) => s.id)).toEqual([10, 1, 2]);
    expect(t.joins).toBe("Santa Fe River");
    expect(t.end).toEqual(base[2].pts[1]);
    expect(t.toSea).toBe(true);
  });

  it("stops where the water leaves what's loaded", () => {
    const t = traceDownstream((id) => (id === 1 ? undefined : get(id)), 10);
    expect(t.path.map((s) => s.id)).toEqual([10]);
    expect(t.toSea).toBe(false);
  });

  it("doesn't report the starting creek as one it joins", () => {
    expect(traceDownstream(get, 1).joins).toBe("Santa Fe River");
    expect(traceDownstream(get, 0).joins).toBe("Santa Fe River");
  });

  it("stops on a cycle instead of looping forever", () => {
    const loop = decodeSegments([seg([0, 0, 1, 0], 0, 1, 1), seg([1, 0, 1, 0], 0, 0, 1)], names, 0, packing);
    expect(traceDownstream((id) => loop[id], 0).path).toHaveLength(2);
  });
});

describe("traceLoading", () => {
  it("loads the tiles along the path before tracing it", async () => {
    const loaded = new Map<number, Segment>(tile.map((s) => [s.id, s]));
    const asked: number[] = [];
    const t = await traceLoading(
      (id) => loaded.get(id),
      async (id) => {
        asked.push(id);
        for (const s of base) loaded.set(s.id, s);
        return true;
      },
      10,
    );
    expect(asked).toEqual([1]);
    expect(t.path.map((s) => s.id)).toEqual([10, 1, 2]);
  });
});
