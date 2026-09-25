// Integrity checks on the datasets the site ships. These run against the
// checked-in files, so a pipeline run that produces a broken network or a
// malformed grid fails CI before it can deploy.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FLOW_KEYS,
  LAKEO_KEYS,
  RAINBOW_KEYS,
  SALINITY_KEYS,
  STLUCIE_KEYS,
  Fate,
  type AquiferFile,
  type ContoursFile,
  type GaugeConfig,
  type LakeOFile,
  type LakesFile,
  type RainbowFile,
  type RiversFile,
  type Snapshot,
  type SalinityStation,
  type SnorkelFile,
  type SpringsFile,
  type StatewideFile,
  type StLucieFile,
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
const statewideMap = read<StatewideFile>("public/data/statewide.json");
const stLucie = read<StLucieFile>("public/data/st-lucie.json");
const lakeO = read<LakeOFile>("public/data/lake-o.json");
const gauges = read<GaugeConfig[]>("config/gauges.json");
const salinity = read<SalinityStation[]>("config/salinity.json");
const snorkel = read<SnorkelFile>("config/snorkel.json");

/** Even-odd ray casting over packed rings, the same rule the maps fill with. */
function inPacked(rings: number[][], [ox, oy]: [number, number], k: number, lon: number, lat: number): boolean {
  const [x, y] = [(lon - ox) * k, (lat - oy) * k];
  let inside = false;
  for (const r of rings) {
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      if (r[i + 1] > y !== r[j + 1] > y && x < ((r[j] - r[i]) * (y - r[i + 1])) / (r[j + 1] - r[i + 1]) + r[i]) inside = !inside;
    }
  }
  return inside;
}

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

  it("follows the St. Johns up to its headwaters", () => {
    // East of -81.8: Levy County has a Wekiva River of its own, which runs to the Gulf.
    const east = (c: number[]) => c[0] / k + ox > -81.8;
    const fatesOf = (name: string) => new Set(segs.filter((s) => names[s[4]] === name && east(s[0])).map((s) => s[1]));
    for (const river of ["Wekiva River", "Econlockhatchee River"]) expect(fatesOf(river), river).toEqual(new Set([Fate.Atlantic]));
    // NHD names the river's channel up to Lake Hell 'n' Blazes, its traditional head, and
    // Blue Cypress Creek carries on into the marshes around Blue Cypress Lake.
    const lat = (c: number[]) => Math.min(...c.filter((_, i) => i % 2).map((y) => y / k + oy));
    const south = (name: string) => Math.min(...segs.filter((s) => names[s[4]] === name && !s[8]).map((s) => lat(s[0])));
    expect(south("Saint Johns River")).toBeLessThan(28.0);
    expect(south("Blue Cypress Creek")).toBeLessThan(27.75);
    expect(new Set(segs.filter((s) => names[s[4]] === "Blue Cypress Creek").map((s) => s[1]))).toEqual(new Set([Fate.Atlantic]));
    // Blue Spring, where the manatees winter, and the Wekiva's head spring.
    const near = (name: string, lon: number, lat: number) => streams.springs.find(([x, y, n]) => n === name && Math.abs(x - lon) < 0.05 && Math.abs(y - lat) < 0.05);
    expect(near("Volusia Blue Spring", -81.34, 28.95)?.[3]).toBe(1);
    expect(near("Wekiwa Spring (Orange)", -81.46, 28.71)).toBeDefined();
    for (const n of ["Lake Monroe", "Lake Harney", "Lake Jesup", "Lake Poinsett", "Lake Washington", "Blue Cypress Lake"]) expect(lakes.bodies.map((b) => b.name), n).toContain(n);
  });

  it("sends the Treasure Coast's rivers to the Atlantic", () => {
    const fatesOf = (name: string) => new Set(segs.filter((s) => names[s[4]] === name).map((s) => s[1]));
    for (const river of ["Saint Lucie Canal", "North Fork Saint Lucie River", "Saint Lucie River", "Loxahatchee River", "Saint Sebastian River"]) {
      expect(fatesOf(river), river).toEqual(new Set([Fate.Atlantic]));
    }
    expect(lakes.bodies.map((b) => b.name)).toContain("Lake Okeechobee");
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
    // Off Suwannee Sound, off Mayport, near Cedar Key; the Indian River Lagoon at Vero Beach and
    // Sebastian, which the Census outlines count as land; and the St. Lucie estuary at Stuart.
    for (const [lon, lat] of [[-83.3, 29.25], [-81.3, 30.4], [-83.05, 29.12], [-80.368, 27.63], [-80.44, 27.8], [-80.207, 27.199]]) expect(inSea(lon, lat), `${lon},${lat}`).toBe(true);
    // Gainesville, Palatka, Lake George, the St. Johns at downtown Jacksonville and in its
    // headwater marshes, and downtown Stuart and Vero Beach.
    for (const [lon, lat] of [[-82.325, 29.652], [-81.637, 29.648], [-81.6, 29.28], [-81.656, 30.325], [-80.75, 27.9], [-80.245, 27.19], [-80.4, 27.64]]) {
      expect(inSea(lon, lat), `${lon},${lat}`).toBe(false);
    }
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

describe("statewide.json", () => {
  const [ox, oy] = statewideMap.meta.coordOrigin;
  const k = statewideMap.meta.coordScale;
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

  it("outlines Florida's land against the sea", () => {
    for (const [lon, lat] of [[-82.325, 29.652], [-84.28, 30.438], [-80.19, 25.77]]) expect(inRings(statewideMap.land, lon, lat)).toBe(true);
    for (const [lon, lat] of [[-84.0, 28.5], [-79.8, 28.0]]) expect(inRings(statewideMap.land, lon, lat)).toBe(false);
  });

  it("has the springs cleanup plans and focus areas, named, around their springs", () => {
    expect(statewideMap.plans.length).toBeGreaterThanOrEqual(13);
    expect(statewideMap.focusAreas.length).toBeGreaterThanOrEqual(15);
    for (const a of [...statewideMap.plans, ...statewideMap.focusAreas]) {
      expect(a.name.length).toBeGreaterThan(0);
      expect(a.km2).toBeGreaterThan(0);
    }
    const plan = (name: string) => statewideMap.plans.find((p) => p.name === name)!;
    // Wakulla Spring and Silver Springs sit inside their own plans.
    expect(inRings(plan("Wakulla Spring").rings, -84.3, 30.235)).toBe(true);
    expect(inRings(plan("Silver and Rainbow Springs").rings, -82.05, 29.215)).toBe(true);
  });

  it("has Florida's coastal lagoons as water, with their names inside them", () => {
    const lagoon = (name: string) => statewideMap.lagoons.find((l) => l.name === name);
    for (const n of ["Indian River Lagoon", "Mosquito Lagoon", "Lake Worth Lagoon", "Biscayne Bay", "Santa Rosa Sound", "Big Lagoon"]) expect(lagoon(n), n).toBeDefined();
    // The Indian River Lagoon at Vero Beach, which the Census outlines count as land.
    expect(inRings(lagoon("Indian River Lagoon")!.rings, -80.368, 27.63)).toBe(true);
    for (const l of statewideMap.lagoons) {
      expect(l.km2, l.name).toBeGreaterThan(5);
      expect(inRings(l.rings, ...l.label!), `${l.name} label`).toBe(true);
    }
  });

  it("puts every spring in the springs list on Florida's land", () => {
    const off = statewide.springs.filter(([, , , lon, lat]) => !inRings(statewideMap.land, lon, lat));
    // A few springs are offshore or on the waterline (submarine springs, coastal vents).
    expect(off.length).toBeLessThan(40);
  });
});

describe("st-lucie.json", () => {
  const near = ([x, y]: number[], [lon, lat]: number[], tol: number) => Math.abs(x - lon) < tol && Math.abs(y - lat) < tol;
  const r = stLucie.rivers;
  const first = (name: string) => r[name].p[0];
  const last = (name: string) => r[name].p[r[name].p.length - 1];

  it("runs the canal from the lake to the lock, and the river from the forks to the inlet", () => {
    for (const name of ["Saint Lucie Canal", "South Fork Saint Lucie River", "North Fork Saint Lucie River", "Saint Lucie River", "County Line Canal", "Indian River"]) {
      expect(r[name]?.p.length, name).toBeGreaterThan(3);
      expect(r[name].u).toHaveLength(r[name].p.length);
    }
    // Port Mayaca at the lake end, then east past the St. Lucie Lock.
    expect(first("Saint Lucie Canal")[0]).toBeLessThan(-80.6);
    expect(near(last("Saint Lucie Canal"), [-80.29, 27.11], 0.06)).toBe(true);
    // The forks meet at Stuart; the estuary ends at the St. Lucie Inlet.
    expect(near(last("North Fork Saint Lucie River"), [-80.26, 27.2], 0.05)).toBe(true);
    expect(near(last("South Fork Saint Lucie River"), [-80.26, 27.19], 0.05)).toBe(true);
    expect(near(last("Saint Lucie River"), [-80.155, 27.166], 0.04)).toBe(true);
  });

  it("has the sea, estuary, and lagoon as water, and Lake Okeechobee", () => {
    const sea = stLucie.water.filter((b) => b.kind === "sea").flatMap((b) => b.rings);
    const inSea = (lon: number, lat: number) => inPacked(sea, stLucie.meta.coordOrigin, stLucie.meta.coordScale, lon, lat);
    // Offshore, the estuary at the A1A bridge, and the lagoon off Jensen Beach.
    for (const [lon, lat] of [[-80.1, 27.3], [-80.207, 27.199], [-80.215, 27.25]]) expect(inSea(lon, lat), `${lon},${lat}`).toBe(true);
    // Downtown Stuart, Indiantown, and Palm City are land.
    for (const [lon, lat] of [[-80.245, 27.19], [-80.486, 27.027], [-80.3, 27.16]]) expect(inSea(lon, lat), `${lon},${lat}`).toBe(false);
    expect(stLucie.water.some((b) => b.name === "Lake Okeechobee")).toBe(true);
    for (const b of stLucie.water) for (const ring of b.rings) expect(ring.length % 2).toBe(0);
  });

  it("has decades of releases at both ends of the canal, with backflow years", () => {
    const { years, S308, S80 } = stLucie.history;
    years.forEach((y, i) => i && expect(y).toBe(years[i - 1] + 1));
    expect(years[0]).toBeLessThanOrEqual(1932);
    expect(years[years.length - 1]).toBeLessThan(new Date().getFullYear() + 1);
    expect(S308.length).toBe(years.length);
    expect(S80.length).toBe(years.length);
    expect(S308.filter((v) => v != null).length).toBeGreaterThan(55);
    expect(S80.filter((v) => v != null).length).toBeGreaterThan(50);
    expect(S308.some((v) => v != null && v < 0)).toBe(true);
    for (const v of [...S308, ...S80]) if (v != null) expect(Math.abs(v)).toBeLessThan(10000);
  });
});

describe("lake-o.json", () => {
  const r = lakeO.rivers;
  const sea = lakeO.water.filter((b) => b.kind === "sea").flatMap((b) => b.rings);
  const inSea = (lon: number, lat: number) => inPacked(sea, lakeO.meta.coordOrigin, lakeO.meta.coordScale, lon, lat);
  const lake = lakeO.water.find((b) => b.name === "Lake Okeechobee");
  const inLake = (lon: number, lat: number) => inPacked(lake!.rings, lakeO.meta.coordOrigin, lakeO.meta.coordScale, lon, lat);

  it("has the lake, and every path stops at its shore", () => {
    expect(lake).toBeDefined();
    expect(inLake(-80.83, 26.95)).toBe(true);
    const inflows = new Set(["Kissimmee River", "Fisheating Creek"]);
    for (const [name, river] of Object.entries(r)) {
      expect(river.p.length, name).toBeGreaterThan(3);
      expect(river.u).toHaveLength(river.p.length);
      // Only the few vertices where it meets the shore can be in the lake: an inflow's last
      // ones, an outlet's first ones. None runs across it.
      const wet = river.p.flatMap(([lon, lat], i) => (inLake(lon, lat) ? [i] : []));
      const n = river.p.length;
      for (const i of wet) expect(inflows.has(name) ? i >= n - 4 : i < 4, `${name} vertex ${i} of ${n}`).toBe(true);
    }
    // The inflows end at the lake, and the outlets start there.
    const last = (n: string) => r[n].p[r[n].p.length - 1];
    expect(last("Kissimmee River")[1]).toBeLessThan(27.3);
    expect(r["Caloosahatchee River"].p[0][0]).toBeGreaterThan(-81.2);
    expect(last("Caloosahatchee River")[0]).toBeLessThan(-81.8);
    expect(r["Saint Lucie Canal"].p[0][0]).toBeLessThan(-80.55);
  });

  it("has the Gulf and the Atlantic as sea, and farmland south of the lake as land", () => {
    for (const [lon, lat] of [[-82.3, 26.4], [-80.0, 27.0]]) expect(inSea(lon, lat), `${lon},${lat}`).toBe(true);
    for (const [lon, lat] of [[-80.668, 26.684], [-81.438, 26.762]]) expect(inSea(lon, lat), `${lon},${lat}`).toBe(false);
  });

  it("has decades of flow each way, with the south canals running backward in some", () => {
    const { years, east, west, south } = lakeO.history;
    years.forEach((y, i) => i && expect(y).toBe(years[i - 1] + 1));
    for (const s of [east, west, south]) expect(s.length).toBe(years.length);
    expect(west.filter((v) => v != null).length).toBeGreaterThan(70);
    expect(south.filter((v) => v != null).length).toBeGreaterThan(55);
    expect(south.some((v) => v != null && v < 0)).toBe(true);
    for (const v of [...east, ...west, ...south]) if (v != null) expect(Math.abs(v)).toBeLessThan(10000);
  });
});

describe("config/snorkel.json", () => {
  const springIds = new Set(statewide.springs.map((x) => x[0]));
  const kinds = ["reef", "offshore", "lagoon", "inlet", "park", "island", "beach", "cave", "sinkhole"];

  it("flags springs that are in the journal's list", () => {
    expect(snorkel.springs.length).toBeGreaterThan(10);
    for (const id of snorkel.springs) expect(springIds.has(id), id).toBe(true);
    expect(new Set(snorkel.springs).size).toBe(snorkel.springs.length);
  });

  it("has spots with unique ids that never clash with a spring's, in Florida", () => {
    const ids = snorkel.spots.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const x of snorkel.spots) {
      expect(x.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*--[a-z0-9-]+$/);
      expect(springIds.has(x.id), `${x.id} is a spring's id`).toBe(false);
      expect(kinds).toContain(x.kind);
      expect(x.osm).toMatch(/^(node|way|relation)\/\d+$/);
      if (x.web) expect(x.web).toMatch(/^https?:\/\//);
      expect(x.lon > -87.7 && x.lon < -79.9 && x.lat > 24.3 && x.lat < 31.1, x.name).toBe(true);
    }
  });
});

describe("gauges and snapshot", () => {
  const keys = [...FLOW_KEYS, ...RAINBOW_KEYS, ...STLUCIE_KEYS, ...LAKEO_KEYS];

  it("has one gauge per flow key with unique site ids", () => {
    expect(gauges.map((g) => g.key).sort()).toEqual([...keys].sort());
    for (const g of gauges) expect(["santa-fe", "rainbow", "st-lucie", "lake-o"]).toContain(g.page);
    expect(gauges.filter((g) => g.page === "rainbow").map((g) => g.key).sort()).toEqual([...RAINBOW_KEYS].sort());
    expect(gauges.filter((g) => g.page === "st-lucie").map((g) => g.key).sort()).toEqual([...STLUCIE_KEYS].sort());
    // Only the canals' structures run backward; the rivers and creeks can't.
    expect(gauges.filter((g) => g.signed).map((g) => g.key).sort()).toEqual([...STLUCIE_KEYS, ...LAKEO_KEYS.filter((k) => k !== "FEC")].sort());
    expect(new Set(gauges.map((g) => g.id)).size).toBe(gauges.length);
    for (const g of gauges) expect(g.id).toMatch(/^\d{8,15}$/);
  });

  it("has one salinity station per key", () => {
    expect(salinity.map((s) => s.key).sort()).toEqual([...SALINITY_KEYS].sort());
    for (const s of salinity) expect(s.id).toMatch(/^\d{8,15}$/);
  });

  it("has a dated reading for every gauge and station", () => {
    expect(Number.isNaN(Date.parse(snapshot.time))).toBe(false);
    for (const k of keys) expect(snapshot.cfs).toHaveProperty(k);
    for (const k of SALINITY_KEYS) {
      expect(snapshot.ppt[k]).toHaveProperty("top");
      expect(snapshot.ppt[k]).toHaveProperty("bottom");
      for (const v of [snapshot.ppt[k].top, snapshot.ppt[k].bottom]) if (v != null) expect(v >= 0 && v <= 45).toBe(true);
    }
    // Only the canals' structures can read below zero.
    for (const k of [...FLOW_KEYS, ...RAINBOW_KEYS, "FEC" as const]) {
      const v = snapshot.cfs[k];
      if (v != null) expect(v).toBeGreaterThanOrEqual(0);
    }
  });
});
