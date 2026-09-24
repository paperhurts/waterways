import { describe, expect, it } from "vitest";
import { blend, colorize, contour, decodeGrid } from "./aquifer";

const b64 = (bytes: number[]) => btoa(String.fromCharCode(...bytes));

describe("decodeGrid", () => {
  it("reads one byte of half-feet per cell", () => {
    expect([...decodeGrid(b64([0, 1, 80, 255]))]).toEqual([0, 0.5, 40, 127.5]);
  });
});

describe("blend", () => {
  it("interpolates cell by cell", () => {
    const a = Float32Array.from([0, 10]);
    const b = Float32Array.from([10, 30]);
    expect([...blend(a, b, 0.5)]).toEqual([5, 20]);
    expect(blend(a, b, 0)).toBe(a);
  });
});

describe("colorize", () => {
  it("flips rows so north is up and fades the edges", () => {
    const nx = 30;
    const ny = 30;
    const z = new Float32Array(nx * ny);
    z[0] = 90; // southwest corner of the grid
    const px = colorize(z, nx, ny, true);
    expect(px).toHaveLength(nx * ny * 4);
    const sw = ((ny - 1) * nx + 0) * 4; // bottom-left pixel
    expect([px[sw], px[sw + 1], px[sw + 2]]).toEqual([64, 128, 136]);
    expect(px[sw + 3]).toBe(0);
    const center = (15 * nx + 15) * 4;
    expect(px[center + 3]).toBe(255);
  });
});

describe("contour", () => {
  // A west-to-east ramp: 0, 10, 20 ft. The 5-ft line runs north-south halfway between columns 0 and 1.
  const g = { lon0: -83, lat0: 29, res: 0.1, nx: 3, ny: 3 };
  const z = Float32Array.from([0, 10, 20, 0, 10, 20, 0, 10, 20]);

  it("traces a straight line through a linear ramp", () => {
    const [line] = contour(z, g, [5]);
    expect(line.segs).toHaveLength(2);
    for (const [a, b] of line.segs) {
      expect(a[0]).toBeCloseTo(-82.95);
      expect(b[0]).toBeCloseTo(-82.95);
    }
  });

  it("returns no segments for a level outside the surface", () => {
    expect(contour(z, g, [50])[0].segs).toHaveLength(0);
  });
});
