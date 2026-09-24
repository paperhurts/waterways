import { describe, expect, it } from "vitest";
import { Fate, type SegTuple, type StreamsFile } from "../shared/types";
import { decodeSegments, fateShares, sinkLabels, traceDownstream } from "./network";

// A tiny network:  0 → 1 → 2 (Gulf), 3 → 1, and a separate creek 4 into "Big Sink".
const seg = (coords: number[], fate: number, next: number, acc: number, name = -1, sink = -1, art = 0): SegTuple =>
  [coords, fate as Fate, next, acc, name, sink, 0, art as 0 | 1];
const file: StreamsFile = {
  meta: { generator: "test", generatedAt: "", coordOrigin: [-83, 29.5], coordScale: 1e4, segFields: [], fates: [], areas: [] },
  names: ["Mill Creek", "Santa Fe River", "Big Sink"],
  segs: [
    seg([0, 0, 100, 0], Fate.Gulf, 1, 1, 0),
    seg([100, 0, 200, 0], Fate.Gulf, 2, 3, 1),
    seg([200, 0, 300, 0], Fate.Gulf, -1, 4, 1, -1, 1),
    seg([100, 100, 100, 0], Fate.Gulf, 1, 1),
    seg([0, 500, 0, 600], Fate.Sink, -1, 20, -1, 2),
  ],
  springs: [],
  swallets: [],
};
const segs = decodeSegments(file);

describe("decodeSegments", () => {
  it("resolves names, sinks, and flags", () => {
    expect(segs[0].name).toBe("Mill Creek");
    expect(segs[3].name).toBeNull();
    expect(segs[4].sink).toBe("Big Sink");
    expect(segs[2].artificial).toBe(true);
  });

  it("decodes packed coordinates through the origin and scale", () => {
    // 100 units at scale 1e4 is 0.01° of longitude.
    const dx = segs[0].pts[1][0] - segs[0].pts[0][0];
    expect(dx).toBeCloseTo(0.01 * Math.cos((29.8 * Math.PI) / 180), 10);
  });
});

describe("traceDownstream", () => {
  it("follows next pointers to the terminus", () => {
    const t = traceDownstream(segs, 3);
    expect(t.path).toEqual([segs[3], segs[1], segs[2]]);
    expect(t.joins).toBe("Santa Fe River");
    expect(t.end).toEqual(segs[2].pts[1]);
  });

  it("doesn't report the starting creek as one it joins", () => {
    expect(traceDownstream(segs, 1).joins).toBe("Santa Fe River");
    expect(traceDownstream(segs, 0).joins).toBe("Santa Fe River");
  });

  it("stops on a cycle instead of looping forever", () => {
    const loop = decodeSegments({ ...file, segs: [seg([0, 0, 1, 0], 0, 1, 1), seg([1, 0, 2, 0], 0, 0, 1)] });
    expect(traceDownstream(loop, 0).path).toHaveLength(2);
  });
});

describe("fateShares", () => {
  it("measures real creek length only, skipping artificial paths", () => {
    const pct = fateShares(segs);
    expect(pct.reduce((a, b) => a + b)).toBeCloseTo(100);
    // Three 0.01°-ish Gulf creeks (one artificial, excluded) vs one 0.01° sink creek.
    expect(pct[Fate.Gulf]).toBeGreaterThan(pct[Fate.Sink]);
    expect(pct[Fate.Atlantic]).toBe(0);
  });
});

describe("sinkLabels", () => {
  it("labels each named sink at its largest inflow", () => {
    const more = decodeSegments({ ...file, segs: [...file.segs, seg([10, 10, 20, 20], Fate.Sink, -1, 50, -1, 2)] });
    const labels = sinkLabels(more);
    expect(labels).toHaveLength(1);
    expect(labels[0]).toMatchObject({ name: "Big Sink", acc: 50 });
  });
});
