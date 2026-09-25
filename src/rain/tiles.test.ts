import { describe, expect, it } from "vitest";
import { bounds } from "../shared/geo";
import type { RainBase } from "../shared/types";
import { TileIndex } from "./tiles";

// Two levels of tiles past the base (ids 0-99): 1° tiles holding ids 100-149 and
// 150-159, and 0.5° tiles holding 160-169, plus an empty one (lakes only).
const meta = {
  gridOrigin: [-83, 29],
  levels: [
    { minAcc: 8, tileDeg: 0, tiles: [] },
    { minAcc: 2, tileDeg: 1, tiles: [[0, 0, 100, 50], [1, 0, 150, 10], [2, 2, 170, 0]] },
    { minAcc: 0, tileDeg: 0.5, tiles: [[1, 1, 160, 10]] },
  ],
} as unknown as RainBase["meta"];
const index = new TileIndex(meta);

describe("TileIndex", () => {
  it("finds the tile holding an id, or none for the base", () => {
    expect(index.of(5)).toBeUndefined();
    expect(index.of(100)?.path).toBe("rain/1/0-0.json");
    expect(index.of(149)?.path).toBe("rain/1/0-0.json");
    expect(index.of(150)?.path).toBe("rain/1/1-0.json");
    expect(index.of(165)?.path).toBe("rain/2/1-1.json");
    expect(index.of(170)).toBeUndefined();
  });

  it("lists a level's tiles overlapping the view", () => {
    // The first 1° tile covers -83..-82 by 29..30.
    expect(index.visible(1, bounds(-82.9, 29.1, -82.8, 29.2)).map((t) => t.path)).toEqual(["rain/1/0-0.json"]);
    expect(index.visible(1, bounds(-82.5, 29.1, -81.5, 29.2)).map((t) => t.path)).toEqual(["rain/1/0-0.json", "rain/1/1-0.json"]);
    // The 0.5° tile at column 1, row 1 covers -82.5..-82 by 29.5..30.
    expect(index.visible(2, bounds(-82.4, 29.6, -82.3, 29.7))).toHaveLength(1);
    expect(index.visible(2, bounds(-82.9, 29.1, -82.8, 29.2))).toHaveLength(0);
    // A margin reaches the neighbor.
    expect(index.visible(2, bounds(-82.9, 29.1, -82.6, 29.2), 0.5)).toHaveLength(1);
  });
});
