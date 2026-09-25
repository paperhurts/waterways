// Integrity checks on the datasets the site ships. These run against the
// checked-in files, so a pipeline run that produces a broken network or a
// malformed grid fails CI before it can deploy.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FLOW_KEYS,
  RAINBOW_KEYS,
  Fate,
  type AquiferFile,
  type ContoursFile,
  type GaugeConfig,
  type LakesFile,
  type RainbowFile,
  type RiversFile,
  type Snapshot,
  type SpringsFile,
  type StreamsFile,
} from "../src/shared/types";

const read = <T>(path: string): T => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
const streams = read<StreamsFile>("public/data/streams.json");
const rivers = read<RiversFile>("public/data/rivers.json");
const contours = read<ContoursFile>("public/data/contours.json");
const aquifer = read<AquiferFile>("public/data/aquifer.json");
const snapshot = read<Snapshot>("public/data/snapshot.json");
const lakes = read<LakesFile>("public/data/lakes.json");
const statewide = read<SpringsFile>("public/data/springs.json");
const rainbow = read<RainbowFile>("public/data/rainbow.json");
const gauges = read<GaugeConfig[]>("config/gauges.json");

// The rain map's study area (a union of boxes), padded for features that cross an edge:
// a whole flowline is kept when it touches a box, and the longest reach about 0.13°.
const PAD = 0.15;
const inBox = (lon: number, lat: number) =>
  streams.meta.areas.some(([w, s, e, n]) => lon >= w - PAD && lon <= e + PAD && lat >= s - PAD && lat <= n + PAD);

describe("streams.json", () => {
  const { segs, names } = streams;
  const [ox, oy] = streams.meta.coordOrigin;
  const k = streams.meta.coordScale;

  it("has thousands of segments and valid field ranges", () => {
    expect(segs.length).toBeGreaterThan(5000);
    for (const [coords, fate, next, acc, name, sink, ug, art, route] of segs) {
      expect(coords.length % 2).toBe(0);
      expect(coords.length).toBeGreaterThanOrEqual(4);
      expect(fate).toBeGreaterThanOrEqual(Fate.Gulf);
      expect(fate).toBeLessThanOrEqual(Fate.OffMap);
      expect(next).toBeGreaterThanOrEqual(-1);
      expect(next).toBeLessThan(segs.length);
      expect(acc).toBeGreaterThanOrEqual(0);
      expect(name).toBeLessThan(names.length);
      expect(sink).toBeLessThan(names.length);
      expect([0, 1]).toContain(ug);
      expect([0, 1]).toContain(art);
      expect([0, 1]).toContain(route);
    }
  });

  it("keeps every vertex inside the study area, except the route to the sea", () => {
    for (const [coords, , , , , , , , route] of segs) {
      if (route) continue;
      for (let i = 0; i < coords.length; i += 2) expect(inBox(coords[i] / k + ox, coords[i + 1] / k + oy)).toBe(true);
    }
  });

  it("follows the Suwannee to the Gulf and the St. Johns to the Atlantic", () => {
    const end = (i: number) => {
      const c = segs[i][0];
      return [c[c.length - 2] / k + ox, c[c.length - 1] / k + oy];
    };
    // Coastal creeks all have mouths; each sea's biggest is its big river.
    const biggestMouth = (fate: Fate) => streams.mouths.filter((i) => segs[i][1] === fate).reduce((a, b) => (segs[b][3] > segs[a][3] ? b : a));
    const gulf = biggestMouth(Fate.Gulf);
    const atl = biggestMouth(Fate.Atlantic);
    expect(names[segs[gulf][4]]).toBe("Suwannee River");
    expect(names[segs[atl][4]]).toBe("Saint Johns River");
    // Suwannee Sound and Mayport.
    expect(end(gulf)[0]).toBeCloseTo(-83.16, 1);
    expect(end(gulf)[1]).toBeCloseTo(29.29, 1);
    expect(end(atl)[0]).toBeCloseTo(-81.4, 1);
    expect(end(atl)[1]).toBeCloseTo(30.4, 1);
    for (const i of streams.mouths) {
      expect(segs[i][2]).toBe(-1);
      expect([Fate.Gulf, Fate.Atlantic]).toContain(segs[i][1]);
    }
    // The route is a continuation of the map, not its own network: every route segment
    // drains to a mouth, and so do the map's biggest Gulf and Atlantic rivers.
    const mouthOf = (i: number) => {
      while (segs[i][2] >= 0) i = segs[i][2];
      return i;
    };
    for (let i = 0; i < segs.length; i++) if (segs[i][8]) expect(streams.mouths).toContain(mouthOf(i));
    for (const fate of [Fate.Gulf, Fate.Atlantic]) {
      let biggest = -1;
      segs.forEach((s, i) => {
        if (s[1] === fate && !s[8] && (biggest < 0 || s[3] > segs[biggest][3])) biggest = i;
      });
      expect(streams.mouths).toContain(mouthOf(biggest));
    }
  });

  it("sends the springs belt's own coastal rivers to the Gulf", () => {
    const fatesOf = (name: string) => new Set(segs.filter((s) => names[s[4]] === name).map((s) => s[1]));
    for (const river of ["Withlacoochee River", "Rainbow River", "Crystal River", "Homosassa River", "Waccasassa River"]) {
      expect(fatesOf(river)).toEqual(new Set([Fate.Gulf]));
    }
    expect(fatesOf("Ocklawaha River")).toEqual(new Set([Fate.Atlantic]));
  });

  it("forms a network without cycles", () => {
    // Every walk downstream must end within segs.length steps.
    const depth = new Int32Array(segs.length).fill(-1);
    const walk = (i: number): number => {
      const path: number[] = [];
      while (i >= 0 && depth[i] < 0) {
        if (path.length > segs.length) throw new Error(`cycle through segment ${i}`);
        path.push(i);
        i = segs[i][2];
      }
      let d = i < 0 ? 0 : depth[i];
      for (let p = path.length - 1; p >= 0; p--) depth[path[p]] = ++d;
      return d;
    };
    for (let i = 0; i < segs.length; i++) expect(walk(i)).toBeGreaterThan(0);
  });

  it("gives each segment the same fate as the segment it drains into", () => {
    const bad = segs.filter(([, fate, next]) => next >= 0 && segs[next][1] !== fate);
    expect(bad).toHaveLength(0);
  });

  it("gives sink names only to creeks that end in a sink", () => {
    const stray = segs.filter(([, fate, , , , sink]) => sink >= 0 && fate !== Fate.Sink);
    expect(stray).toHaveLength(0);
    const named = new Set(segs.filter((s) => s[5] >= 0).map((s) => names[s[5]]));
    for (const n of ["Alachua Sink", "Haile Sink", "Mill Creek Swallet"]) expect(named).toContain(n);
  });

  it("labels the swallets where creeks go underground", () => {
    const names = streams.swallets.map(([, , n]) => n);
    expect(names).toContain("Santa Fe River Sink");
    for (const [lon, lat] of streams.swallets) expect(inBox(lon, lat)).toBe(true);
  });

  it("accumulates upstream length: acc never shrinks going downstream", () => {
    // acc is rounded to 0.1 km, so allow a rounding step.
    const shrinking = segs.filter(([, , next, acc]) => next >= 0 && segs[next][3] + 0.11 < acc);
    expect(shrinking).toHaveLength(0);
  });

  it("covers every fate the map explains", () => {
    const seen = new Set(segs.map((s) => s[1]));
    for (const f of Object.values(Fate)) expect(seen.has(f)).toBe(true);
  });

  it("places springs inside the study area, with a magnitude class", () => {
    expect(streams.springs.length).toBeGreaterThan(100);
    for (const [lon, lat, name, mag] of streams.springs) {
      expect(inBox(lon, lat)).toBe(true);
      expect(name.length).toBeGreaterThan(0);
      expect(Number.isInteger(mag) && mag >= 0 && mag <= 8).toBe(true);
    }
  });

  it("links map springs to the journal's statewide list", () => {
    const ids = new Set(statewide.springs.map((s) => s[0]));
    const linked = streams.springs.filter((s) => s[4]);
    expect(linked.length).toBeGreaterThan(150);
    for (const s of linked) expect(ids.has(s[4]), s[2]).toBe(true);
  });

  it("follows the Atlantic route to Silver Springs and Lake George", () => {
    const silver = streams.springs.find(([, , n]) => n === "Silver Springs");
    expect(silver?.[3]).toBe(1);
    expect(lakes.bodies.map((b) => b.name)).toContain("Lake George");
    expect(streams.meta.areas.length).toBeGreaterThan(1);
  });
});

describe("rivers.json", () => {
  it("has the rivers the Santa Fe map wires together", () => {
    for (const r of ["Santa Fe River", "Ichetucknee River", "Suwannee River"]) expect(rivers.rivers[r]).toBeDefined();
  });

  it("flags underground vertices one-for-one", () => {
    for (const r of Object.values(rivers.rivers)) expect(r.u).toHaveLength(r.p.length);
  });

  it("has one continuous underground reach on the Santa Fe", () => {
    const u = rivers.rivers["Santa Fe River"].u;
    const runs = u.filter((v, i) => v && !u[i - 1]).length;
    expect(runs).toBe(1);
  });
});

describe("contours.json", () => {
  it("has 10-ft contours with real geometry", () => {
    expect(contours.contours.length).toBeGreaterThan(0);
    for (const c of contours.contours) {
      expect(c.v % contours.meta.intervalFt).toBe(0);
      expect(c.p.length).toBeGreaterThan(1);
    }
  });
});

describe("aquifer.json", () => {
  const { nx, ny } = aquifer.grid;

  it("decodes every grid to nx × ny cells", () => {
    for (const [name, b64] of Object.entries(aquifer.grids)) {
      expect(Buffer.from(b64, "base64").length, name).toBe(nx * ny);
    }
  });

  it("references only grids that exist", () => {
    for (const s of aquifer.steps) expect(aquifer.grids[s.grid], s.label).toBeDefined();
    expect(aquifer.grids[aquifer.now.grid]).toBeDefined();
  });

  it("has flows for every gauge in every step", () => {
    for (const s of aquifer.steps) {
      expect(Object.keys(s.flows).sort()).toEqual([...FLOW_KEYS].sort());
      for (const k of s.est) expect(FLOW_KEYS).toContain(k);
      expect(s.flows.F, `${s.label} needs Fort White`).toBeGreaterThan(0);
    }
  });

  it("keeps plausible Upper Floridan levels in the averaging window", () => {
    for (const s of [...aquifer.steps, aquifer.now]) {
      expect(s.mean).toBeGreaterThan(20);
      expect(s.mean).toBeLessThan(70);
    }
  });
});

describe("springs.json", () => {
  const { springs } = statewide;

  it("covers Florida's springs with unique, URL-safe ids", () => {
    expect(springs.length).toBeGreaterThan(700);
    expect(new Set(springs.map((s) => s[0])).size).toBe(springs.length);
    for (const [id, name, , lon, lat, mag, onMap] of springs) {
      expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*--[a-z0-9-]+$/);
      expect(name.length).toBeGreaterThan(0);
      expect(lon).toBeGreaterThan(-88);
      expect(lon).toBeLessThan(-79.8);
      expect(lat).toBeGreaterThan(24.3);
      expect(lat).toBeLessThan(31.1);
      expect(mag >= 0 && mag <= 8).toBe(true);
      expect([0, 1]).toContain(onMap);
    }
  });

  it("has the springs people actually go to", () => {
    const names = new Set(springs.map((s) => s[1]));
    for (const n of ["Silver Springs", "Rainbow Springs", "Ginnie Spring", "Manatee Spring"]) expect(names).toContain(n);
  });
});

describe("lakes.json", () => {
  it("has the big named lakes as closed rings", () => {
    const named = new Set(lakes.bodies.map((b) => b.name));
    for (const n of ["Newnans Lake", "Santa Fe Lake", "Lochloosa Lake"]) expect(named).toContain(n);
    for (const b of lakes.bodies) {
      expect(["sea", "lake", "swamp"]).toContain(b.kind);
      for (const r of b.rings) {
        expect(r.length % 2).toBe(0);
        expect(r.length).toBeGreaterThanOrEqual(6);
      }
    }
  });

  it("has sea off both river mouths and none over land", () => {
    const [ox, oy] = lakes.meta.coordOrigin;
    const k = lakes.meta.coordScale;
    const rings = lakes.bodies.filter((b) => b.kind === "sea").flatMap((b) => b.rings);
    // Even-odd ray casting, the same rule the map fills with.
    const inSea = (lon: number, lat: number) => {
      const [x, y] = [(lon - ox) * k, (lat - oy) * k];
      let inside = false;
      for (const r of rings) {
        for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
          if (r[i + 1] > y !== r[j + 1] > y && x < ((r[j] - r[i]) * (y - r[i + 1])) / (r[j + 1] - r[i + 1]) + r[i]) inside = !inside;
        }
      }
      return inside;
    };
    // Off Suwannee Sound, off Mayport, and near Cedar Key.
    for (const [lon, lat] of [[-83.3, 29.25], [-81.3, 30.4], [-83.05, 29.12]]) expect(inSea(lon, lat)).toBe(true);
    // Gainesville, Palatka, Lake George, and the St. Johns at downtown Jacksonville.
    for (const [lon, lat] of [[-82.325, 29.652], [-81.637, 29.648], [-81.6, 29.28], [-81.656, 30.325]]) expect(inSea(lon, lat)).toBe(false);
  });
});

describe("rainbow.json", () => {
  const near = ([x, y]: number[], [lon, lat]: number[], tol: number) => Math.abs(x - lon) < tol && Math.abs(y - lat) < tol;
  const [ox, oy] = rainbow.meta.coordOrigin;
  const k = rainbow.meta.coordScale;
  /** Even-odd ray casting over packed rings. */
  const inRings = (rings: number[][], lon: number, lat: number) => {
    const [x, y] = [(lon - ox) * k, (lat - oy) * k];
    let inside = false;
    for (const r of rings) {
      for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
        if (r[i + 1] > y !== r[j + 1] > y && x < ((r[j] - r[i]) * (y - r[i + 1])) / (r[j + 1] - r[i + 1]) + r[i]) inside = !inside;
      }
    }
    return inside;
  };

  it("runs the Rainbow from its head springs and the Withlacoochee to the Gulf", () => {
    const rb = rainbow.rivers["Rainbow River"].p;
    const wl = rainbow.rivers["Withlacoochee River"].p;
    expect(rb.length).toBeGreaterThan(20);
    expect(near(rb[0], [-82.4377, 29.1027], 0.01)).toBe(true);
    expect(near(rb[rb.length - 1], [-82.458, 29.047], 0.01)).toBe(true);
    expect(near(wl[wl.length - 1], [-82.755, 28.998], 0.02)).toBe(true);
    expect(rainbow.rivers["Cross Florida Barge Canal"].p.length).toBeGreaterThan(5);
  });

  it("has the head spring vents, on the upper river", () => {
    const names = rainbow.vents.map((v) => v[0]);
    expect(names).toContain("Rainbow Springs");
    expect(rainbow.vents.length).toBeGreaterThanOrEqual(10);
    for (const [, lon, lat] of rainbow.vents) expect(lon > -82.46 && lon < -82.4 && lat > 29.07 && lat < 29.11).toBe(true);
  });

  it("has a springshed and focus area around the springs", () => {
    expect(rainbow.springshed.km2).toBeGreaterThan(1000);
    expect(rainbow.springshed.km2).toBeLessThan(3000);
    expect(rainbow.focusArea.km2).toBeGreaterThan(50);
    expect(rainbow.focusArea.km2).toBeLessThan(rainbow.springshed.km2);
    for (const area of [rainbow.springshed, rainbow.focusArea]) {
      for (const r of area.rings) {
        expect(r.length % 2).toBe(0);
        expect(r.length).toBeGreaterThanOrEqual(8);
      }
    }
    // A spot just east of the head springs is inside both; the Gulf coast is inside neither.
    expect(inRings(rainbow.springshed.rings, -82.42, 29.11)).toBe(true);
    expect(inRings(rainbow.focusArea.rings, -82.42, 29.11)).toBe(true);
    expect(inRings(rainbow.springshed.rings, -82.75, 29.0)).toBe(false);
    expect(rainbow.contours.length).toBeGreaterThan(3);
  });

  it("has decades of finished water years for both rivers", () => {
    const { years, Rb, WH } = rainbow.history;
    expect(years.length).toBeGreaterThanOrEqual(50);
    years.forEach((y, i) => i && expect(y).toBe(years[i - 1] + 1));
    expect(years[years.length - 1]).toBeLessThan(new Date().getFullYear() + 1);
    expect(Rb.length).toBe(years.length);
    expect(WH.length).toBe(years.length);
    for (const v of Rb) expect(v).toBeGreaterThan(300);
  });
});

describe("gauges and snapshot", () => {
  it("has one gauge per flow key with unique site ids", () => {
    expect(gauges.map((g) => g.key).sort()).toEqual([...FLOW_KEYS, ...RAINBOW_KEYS].sort());
    for (const g of gauges) expect(["santa-fe", "rainbow"]).toContain(g.page);
    expect(gauges.filter((g) => g.page === "rainbow").map((g) => g.key).sort()).toEqual([...RAINBOW_KEYS].sort());
    expect(new Set(gauges.map((g) => g.id)).size).toBe(gauges.length);
    for (const g of gauges) expect(g.id).toMatch(/^\d{8,15}$/);
  });

  it("has a dated reading for every gauge", () => {
    expect(Number.isNaN(Date.parse(snapshot.time))).toBe(false);
    for (const k of [...FLOW_KEYS, ...RAINBOW_KEYS]) expect(snapshot.cfs).toHaveProperty(k);
  });
});
