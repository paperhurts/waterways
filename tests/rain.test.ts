// Integrity checks on the statewide rain map's data: public/data/rain/base.json and
// every tile. Like tests/data.test.ts, these run against the checked-in files.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Fate, SegFlag, type RainBase, type RainSeg, type RainTile, type RainWater, type SpringsFile } from "../src/shared/types";

const root = new URL("../public/data/", import.meta.url);
const read = <T>(path: string): T => JSON.parse(readFileSync(new URL(path, root), "utf8"));
const base = read<RainBase>("rain/base.json");
const statewide = read<SpringsFile>("springs.json");
const { meta } = base;
const [ox, oy] = meta.coordOrigin;
const k = meta.coordScale;

/** Every segment by id, with its name and sink resolved from its own file. */
interface Row {
  seg: RainSeg;
  name: string | null;
  sink: string | null;
  level: number;
}
const rows: Row[] = new Array(meta.segCount);
const water: RainWater[] = [...base.water];
const tileFiles: { path: string; bytes: number; tile: RainTile }[] = [];
base.segs.forEach((seg, i) => (rows[i] = { seg, name: base.names[seg[4]] ?? null, sink: base.names[seg[5]] ?? null, level: 0 }));
meta.levels.forEach((lv, level) => {
  for (const [col, row] of lv.tiles) {
    const path = `rain/${level}/${col}-${row}.json`;
    const text = readFileSync(new URL(path, root), "utf8");
    const tile = JSON.parse(text) as RainTile;
    tileFiles.push({ path, bytes: text.length, tile });
    tile.segs.forEach((seg, i) => (rows[tile.first + i] = { seg, name: tile.names[seg[4]] ?? null, sink: tile.names[seg[5]] ?? null, level }));
    water.push(...tile.water);
  }
});

/** A segment's vertices in lon/lat. */
function lonLat(seg: RainSeg): [number, number][] {
  const c = seg[0];
  const out: [number, number][] = [];
  let x = 0;
  let y = 0;
  for (let i = 0; i < c.length; i += 2) {
    x += c[i];
    y += c[i + 1];
    out.push([x / k + ox, y / k + oy]);
  }
  return out;
}
/** Ids of the segments failing a check. Expecting on every one of 250,000 segments is too slow for CI. */
const failing = (bad: (r: Row, id: number) => boolean) => {
  const out: number[] = [];
  for (let i = 0; i < meta.segCount; i++) if (!rows[i] || bad(rows[i], i)) out.push(i);
  return out;
};
const named = (name: string) => rows.filter((r) => r.name === name);
const fatesOf = (name: string, where: (r: Row) => boolean = () => true) => new Set(named(name).filter(where).map((r) => r.seg[1]));

describe("rain/base.json and its tiles", () => {
  it("fills every id exactly once, the base first", () => {
    expect(meta.segCount).toBeGreaterThan(200_000);
    expect(base.segs.length).toBeGreaterThan(30_000);
    expect(failing(() => false)).toEqual([]);
    for (const { path, tile } of tileFiles) {
      const [col, row] = path.slice(path.lastIndexOf("/") + 1, -5).split("-").map(Number);
      const lv = meta.levels[Number(path.split("/")[1])];
      expect(lv.tiles.find((t) => t[0] === col && t[1] === row)?.slice(2)).toEqual([tile.first, tile.segs.length]);
    }
  });

  it("has valid field ranges", () => {
    const bad = failing(({ seg: [coords, fate, next, acc, , , flags] }) =>
      coords.length % 2 !== 0 || coords.length < 4 || fate < Fate.Gulf || fate > Fate.OffMap || next < -1 || next >= meta.segCount || acc < 0 || flags < 0 || flags >= 16,
    );
    expect(bad.slice(0, 10)).toEqual([]);
  });

  it("files each creek at its level of detail", () => {
    const [b, one, two] = meta.levels.map((l) => l.minAcc);
    const bad = failing(({ level, seg: [, , , acc] }) =>
      level === 0 ? acc < b - 0.05 : level === 1 ? acc < one - 0.05 || acc >= b + 0.05 : acc < two || acc >= one + 0.05,
    );
    expect(bad.slice(0, 10)).toEqual([]);
  });

  it("keeps files small enough for a phone", () => {
    expect(readFileSync(new URL("rain/base.json", root), "utf8").length).toBeLessThan(5_000_000);
    for (const { path, bytes } of tileFiles) expect(bytes, path).toBeLessThan(600_000);
  });

  it("keeps every vertex in Florida's box, give or take a border river", () => {
    const [w, s, e, n] = meta.bounds;
    const bad = failing((r) => lonLat(r.seg).some(([lon, lat]) => lon < w - 0.3 || lon > e + 0.3 || lat < s - 0.3 || lat > n + 0.3));
    expect(bad.slice(0, 10)).toEqual([]);
  });

  it("forms a network without cycles, each segment sharing its downstream neighbor's fate", () => {
    const depth = new Int32Array(meta.segCount).fill(-1);
    for (let start = 0; start < meta.segCount; start++) {
      const path: number[] = [];
      let i = start;
      while (i >= 0 && depth[i] < 0) {
        if (path.length > meta.segCount) throw new Error(`cycle through segment ${i}`);
        path.push(i);
        i = rows[i].seg[2];
      }
      let d = i < 0 ? 0 : depth[i];
      for (let p = path.length - 1; p >= 0; p--) depth[path[p]] = ++d;
    }
    expect(failing((r) => r.seg[2] >= 0 && rows[r.seg[2]].seg[1] !== r.seg[1]).slice(0, 10)).toEqual([]);
  });

  it("accumulates upstream length: acc never shrinks going downstream", () => {
    // acc is rounded to 0.1 km, so allow a rounding step.
    expect(failing((r) => r.seg[2] >= 0 && rows[r.seg[2]].seg[3] + 0.11 < r.seg[3]).slice(0, 10)).toEqual([]);
  });

  it("marks mouths only where the network ends at the sea", () => {
    const mouths = rows.filter((r) => r.seg[6] & SegFlag.Mouth);
    expect(mouths.length).toBeGreaterThan(500);
    for (const r of mouths) {
      expect(r.seg[2]).toBe(-1);
      expect([Fate.Gulf, Fate.Atlantic]).toContain(r.seg[1]);
    }
  });

  it("follows Florida's big rivers to their own seas", () => {
    const mouth = (name: string) => rows.map((r, i) => [r, i] as const).filter(([r]) => r.name === name && r.seg[6] & SegFlag.Mouth).sort((a, b) => b[0].seg[3] - a[0].seg[3])[0];
    const endOf = (i: number) => lonLat(rows[i].seg).at(-1)!;
    // Mayport, Suwannee Sound, and Apalachicola Bay.
    for (const [name, fate, lon, lat] of [["Saint Johns River", Fate.Atlantic, -81.4, 30.4], ["Suwannee River", Fate.Gulf, -83.16, 29.29], ["Apalachicola River", Fate.Gulf, -85.0, 29.75]] as const) {
      const m = mouth(name);
      expect(m, name).toBeDefined();
      expect(m[0].seg[1]).toBe(fate);
      const [x, y] = endOf(m[1]);
      expect(Math.abs(x - lon) < 0.15 && Math.abs(y - lat) < 0.15, `${name} ends at ${x},${y}`).toBe(true);
    }
  });

  it("sends the springs belt's own coastal rivers to the Gulf", () => {
    for (const river of ["Withlacoochee River", "Rainbow River", "Crystal River", "Homosassa River", "Waccasassa River", "Santa Fe River", "Ichetucknee River"]) {
      expect(fatesOf(river), river).toEqual(new Set([Fate.Gulf]));
    }
    expect(fatesOf("Ocklawaha River")).toEqual(new Set([Fate.Atlantic]));
  });

  it("sends the Panhandle's and southwest Florida's rivers to the Gulf", () => {
    for (const river of ["Apalachicola River", "Choctawhatchee River", "Escambia River", "Ochlockonee River", "Peace River", "Myakka River", "Caloosahatchee River", "Hillsborough River"]) {
      expect(fatesOf(river), river).toEqual(new Set([Fate.Gulf]));
    }
  });

  it("follows the St. Johns up to its headwaters", () => {
    // East of -81.8: Levy County has a Wekiva River of its own, which runs to the Gulf.
    const east = (r: Row) => lonLat(r.seg)[0][0] > -81.8;
    for (const river of ["Wekiva River", "Econlockhatchee River"]) expect(fatesOf(river, east), river).toEqual(new Set([Fate.Atlantic]));
    // NHD names the river's channel up to Lake Hell 'n' Blazes, its traditional head, and
    // Blue Cypress Creek carries on into the marshes around Blue Cypress Lake.
    const south = (name: string) => Math.min(...named(name).flatMap((r) => lonLat(r.seg).map(([, lat]) => lat)));
    expect(south("Saint Johns River")).toBeLessThan(28.0);
    expect(south("Blue Cypress Creek")).toBeLessThan(27.75);
    expect(fatesOf("Blue Cypress Creek")).toEqual(new Set([Fate.Atlantic]));
  });

  it("sends the Atlantic coast's rivers to the Atlantic", () => {
    for (const river of ["Saint Lucie Canal", "North Fork Saint Lucie River", "Saint Lucie River", "Loxahatchee River", "Saint Sebastian River", "Saint Marys River", "Tomoka River"]) {
      expect(fatesOf(river), river).toEqual(new Set([Fate.Atlantic]));
    }
  });

  it("flags water bound for Lake Okeechobee", () => {
    for (const river of ["Kissimmee River", "Fisheating Creek"]) {
      const rs = named(river);
      expect(rs.length, river).toBeGreaterThan(0);
      expect(rs.every((r) => r.seg[6] & SegFlag.LakeO), river).toBe(true);
    }
    expect(named("Peace River").some((r) => r.seg[6] & SegFlag.LakeO)).toBe(false);
  });

  it("gives sink names only to creeks that end in a sink", () => {
    expect(rows.filter((r) => r.sink && r.seg[1] !== Fate.Sink)).toHaveLength(0);
    const sinks = new Set(rows.map((r) => r.sink).filter(Boolean));
    for (const n of ["Alachua Sink", "Haile Sink", "Mill Creek Swallet"]) expect(sinks).toContain(n);
  });

  it("covers every fate the map explains", () => {
    const seen = new Set(rows.map((r) => r.seg[1]));
    for (const f of [Fate.Gulf, Fate.Atlantic, Fate.Sink, Fate.Inland]) expect(seen.has(f)).toBe(true);
    expect(meta.shares.reduce((a, b) => a + b)).toBeCloseTo(100, 0);
  });

  it("labels the swallets where creeks go underground, and the sinks where they end", () => {
    expect(base.swallets.map(([, , n]) => n)).toContain("Santa Fe River Sink");
    expect(base.sinks.map(([, , n]) => n)).toContain("Alachua Sink");
  });

  it("names the big rivers, not a delta's side channels", () => {
    const names = new Set(base.rivers.map(([, , n]) => n));
    for (const n of ["Apalachicola River", "Suwannee River", "Saint Johns River", "Peace River", "Kissimmee River", "Choctawhatchee River"]) expect(names).toContain(n);
    for (const n of ["Sams Creek Cutoff", "East River Cut Off"]) expect(names.has(n), n).toBe(false);
  });

  it("links the map's springs to the journal's statewide list", () => {
    const ids = new Set(statewide.springs.map((s) => s[0]));
    const linked = base.springs.filter((s) => s[4]);
    expect(linked.length).toBe(statewide.springs.length);
    for (const s of linked) expect(ids.has(s[4]), s[2]).toBe(true);
    const find = (name: string, lon: number, lat: number) => base.springs.find(([x, y, n]) => n === name && Math.abs(x - lon) < 0.05 && Math.abs(y - lat) < 0.05);
    expect(find("Volusia Blue Spring", -81.34, 28.95)?.[3]).toBe(1);
    expect(find("Wakulla Spring", -84.3, 30.23)?.[3]).toBe(1);
  });

  it("has the lakes and wetlands, as closed rings", () => {
    const names = new Set(water.map((w) => w.name));
    for (const n of ["Lake Okeechobee", "Lake George", "Lake Monroe", "Lake Harney", "Blue Cypress Lake", "Newnans Lake", "Lake Seminole", "Lake Tohopekaliga", "Lake Istokpoga"]) expect(names, n).toContain(n);
    expect(water.some((w) => w.kind === "swamp" && w.km2 > 1000)).toBe(true);
    for (const w of water) {
      expect(["sea", "lake", "swamp"]).toContain(w.kind);
      for (const r of w.rings) {
        expect(r.length % 2).toBe(0);
        expect(r.length).toBeGreaterThanOrEqual(8);
      }
    }
  });

  it("has sea on every coast, in the lagoons and bays, and none over land", () => {
    const rings = base.water.filter((w) => w.kind === "sea").flatMap((w) => w.rings);
    // Absolute coordinates for the even-odd test.
    const abs = rings.map((r) => {
      const out: number[] = [];
      let x = 0;
      let y = 0;
      for (let i = 0; i < r.length; i += 2) out.push((x += r[i]), (y += r[i + 1]));
      return out;
    });
    const inSea = (lon: number, lat: number) => {
      const [x, y] = [(lon - ox) * k, (lat - oy) * k];
      let inside = false;
      for (const r of abs) {
        for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
          if (r[i + 1] > y !== r[j + 1] > y && x < ((r[j] - r[i]) * (y - r[i + 1])) / (r[j + 1] - r[i + 1]) + r[i]) inside = !inside;
        }
      }
      return inside;
    };
    // Off Pensacola, Suwannee Sound, and Mayport; Tampa Bay, Charlotte Harbor, Florida Bay,
    // Biscayne Bay; the Indian River Lagoon at Vero Beach (land to the Census) and the St.
    // Lucie estuary at Stuart.
    for (const [lon, lat] of [[-87.2, 30.2], [-83.3, 29.25], [-81.3, 30.4], [-82.55, 27.75], [-82.08, 26.88], [-80.8, 25.05], [-80.23, 25.6], [-80.368, 27.63], [-80.207, 27.199]]) {
      expect(inSea(lon, lat), `${lon},${lat}`).toBe(true);
    }
    // Tallahassee, Gainesville, Orlando, the middle of Lake Okeechobee, the St. Johns at
    // downtown Jacksonville and in its headwater marshes, and downtown Stuart.
    for (const [lon, lat] of [[-84.28, 30.44], [-82.325, 29.652], [-81.38, 28.54], [-80.83, 26.95], [-81.656, 30.325], [-80.75, 27.9], [-80.245, 27.19]]) {
      expect(inSea(lon, lat), `${lon},${lat}`).toBe(false);
    }
  });
});
