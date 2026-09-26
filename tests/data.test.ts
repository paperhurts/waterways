// Integrity checks on the datasets the site ships. These run against the
// checked-in files, so a pipeline run that produces a broken network or a
// malformed grid fails CI before it can deploy.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FLOW_KEYS,
  IRL_KEYS,
  KISS_CLASSES,
  KISS_KEYS,
  OCK_KEYS,
  LAKEO_KEYS,
  PARK_WATER,
  RAINBOW_KEYS,
  SALINITY_KEYS,
  STLUCIE_KEYS,
  type AquiferFile,
  type ContoursFile,
  type GaugeConfig,
  type IndianRiverFile,
  type KissimmeeFile,
  type OcklawahaFile,
  type ReefsFile,
  type LakeOFile,
  type LakesFile,
  type ParksFile,
  type RainbowFile,
  type RiversFile,
  type Snapshot,
  type SalinityStation,
  type SnorkelFile,
  type SpringsFile,
  type StatewideFile,
  type StLucieFile,
} from "../src/shared/types";
import { MAP_LINKS, NOTES, PLAN_2024 } from "../src/parks/content";

const read = <T>(path: string): T => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
const rivers = read<RiversFile>("public/data/rivers.json");
const contours = read<ContoursFile>("public/data/contours.json");
const aquifer = read<AquiferFile>("public/data/aquifer.json");
const snapshot = read<Snapshot>("public/data/snapshot.json");
const lakeFiles = { "santa-fe": read<LakesFile>("public/data/lakes-santa-fe.json"), rainbow: read<LakesFile>("public/data/lakes-rainbow.json") };
const statewide = read<SpringsFile>("public/data/springs.json");
const rainbow = read<RainbowFile>("public/data/rainbow.json");
const statewideMap = read<StatewideFile>("public/data/statewide.json");
const stLucie = read<StLucieFile>("public/data/st-lucie.json");
const lakeO = read<LakeOFile>("public/data/lake-o.json");
const irl = read<IndianRiverFile>("public/data/indian-river.json");
const reefs = read<ReefsFile>("public/data/reefs.json");
const parks = read<ParksFile>("public/data/parks.json");
const kiss = read<KissimmeeFile>("public/data/kissimmee.json");
const ock = read<OcklawahaFile>("public/data/ocklawaha.json");
const gauges = read<GaugeConfig[]>("config/gauges.json");
const salinity = read<SalinityStation[]>("config/salinity.json");
const snorkel = read<SnorkelFile>("config/snorkel.json");

/** Delta-packed rings ([x0, y0, dx, dy, ...]) to plain packed ones. */
const undelta = (rings: number[][]): number[][] =>
  rings.map((r) => {
    const out: number[] = [];
    for (let i = 0; i < r.length; i += 2) out.push((out[i - 2] ?? 0) + r[i], (out[i - 1] ?? 0) + r[i + 1]);
    return out;
  });

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

  it("names each spring's state park, if it's in one, as parks.json does", () => {
    const names = new Set(parks.parks.map((p) => p.name));
    const inParks = springs.filter((s) => s[7]);
    expect(inParks.length).toBeGreaterThan(100);
    expect(inParks.filter((s) => !names.has(s[7])).map((s) => s[7])).toEqual([]);
    const park = (id: string) => springs.find((s) => s[0] === id)?.[7];
    expect(park("wakulla-spring--wakulla")).toBe("Edward Ball Wakulla Springs State Park");
    expect(park("manatee-spring--levy")).toBe("Manatee Springs State Park");
    // Ginnie is a private park.
    expect(park("ginnie-spring--gilchrist")).toBe("");
  });

  it("has the springs people actually go to", () => {
    const names = new Set(springs.map((s) => s[1]));
    for (const n of ["Silver Springs", "Rainbow Springs", "Ginnie Spring", "Manatee Spring"]) expect(names).toContain(n);
  });
});

describe("lakes-<map>.json", () => {
  // Each map's lakes, a point that must be sea, and points that must not be.
  const cases = {
    // Newnans, Santa Fe, and Lochloosa lakes; the Gulf off Suwannee Sound and near Cedar Key;
    // Gainesville, Palatka, and the Suwannee at Branford.
    "santa-fe": { lakes: ["Newnans Lake", "Santa Fe Lake", "Lochloosa Lake", "Orange Lake"], sea: [[-83.3, 29.25], [-83.05, 29.12]], land: [[-82.325, 29.652], [-81.637, 29.648], [-82.93, 29.96]] },
    // Lake Rousseau below Dunnellon, Tsala Apopka, Lake Weir, and the Harris Chain; the Gulf
    // off the Withlacoochee's mouth and Crystal River; Ocala, Dunnellon, and Lake George.
    rainbow: { lakes: ["Lake Rousseau", "Lake Weir", "Lake Harris", "Lake George", "Orange Lake"], sea: [[-82.8, 29.0], [-82.75, 28.88]], land: [[-82.14, 29.187], [-82.461, 29.049], [-81.6, 29.28]] },
  };

  for (const [map, c] of Object.entries(cases)) {
    const file = lakeFiles[map as keyof typeof lakeFiles];

    it(`has ${map}'s named lakes as closed rings`, () => {
      const named = new Set(file.bodies.map((b) => b.name));
      for (const n of c.lakes) expect(named, n).toContain(n);
      for (const b of file.bodies) {
        expect(["sea", "lake", "swamp"]).toContain(b.kind);
        for (const r of b.rings) {
          expect(r.length % 2).toBe(0);
          expect(r.length).toBeGreaterThanOrEqual(6);
        }
      }
    });

    it(`has sea off ${map}'s coast and none over land`, () => {
      const rings = file.bodies.filter((b) => b.kind === "sea").flatMap((b) => b.rings);
      const inSea = (lon: number, lat: number) => inPacked(rings, file.meta.coordOrigin, file.meta.coordScale, lon, lat);
      for (const [lon, lat] of c.sea) expect(inSea(lon, lat), `${lon},${lat}`).toBe(true);
      for (const [lon, lat] of c.land) expect(inSea(lon, lat), `${lon},${lat}`).toBe(false);
    });
  }
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
    // Gainesville, Tallahassee, and Coral Gables.
    for (const [lon, lat] of [[-82.325, 29.652], [-84.28, 30.438], [-80.27, 25.72]]) expect(inRings(statewideMap.land, lon, lat), `${lon},${lat}`).toBe(true);
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

  it("leaves the bays and lagoons the Census outlines count as land out of it", () => {
    // Choctawhatchee, Pensacola, and Tampa bays, Charlotte Harbor, and the Indian River Lagoon at Vero Beach.
    for (const [lon, lat] of [[-86.3, 30.45], [-87.15, 30.37], [-82.55, 27.75], [-82.08, 26.88], [-80.368, 27.63]]) {
      expect(inRings(statewideMap.land, lon, lat), `${lon},${lat}`).toBe(false);
    }
  });

  it("has Florida's lakes and wetlands", () => {
    const names = new Set(statewideMap.water.map((w) => w.name));
    for (const n of ["Lake Okeechobee", "Lake George", "Lake Tohopekaliga", "Lake Istokpoga", "Lake Seminole", "Newnans Lake"]) expect(names, n).toContain(n);
    expect(statewideMap.water.some((w) => w.kind === "swamp" && w.km2 > 1000)).toBe(true);
    for (const w of statewideMap.water) for (const r of w.rings) expect(r.length >= 8 && r.length % 2 === 0).toBe(true);
  });

  it("adds the springs NHD maps that FDEP doesn't, apart from FDEP's", () => {
    expect(statewideMap.extraSprings.length).toBeGreaterThan(20);
    const m = (a: number[], b: number[]) => Math.hypot((a[0] - b[0]) * 96_000, (a[1] - b[1]) * 110_500);
    for (const e of statewideMap.extraSprings) {
      const nearest = Math.min(...statewide.springs.map((s) => m([e[0], e[1]], [s[3], s[4]])));
      expect(nearest, e[2]).toBeGreaterThan(130);
    }
  });

  it("puts every spring in the springs list on Florida's land, or in its rivers and bays", () => {
    // Many vents are in the rivers NHD maps as wide water (the Suwannee, Kings Bay), which
    // is cut out of the land with the bays. None should be well out at sea.
    const step = 0.006;
    const nearLand = (lon: number, lat: number) => [[0, 0], [step, 0], [-step, 0], [0, step], [0, -step]].some(([dx, dy]) => inRings(statewideMap.land, lon + dx, lat + dy));
    const atSea = statewide.springs.filter(([, , , lon, lat]) => !nearLand(lon, lat));
    // A few are submarine springs or coastal vents.
    expect(atSea.map((s) => s[1]).length, atSea.map((s) => s[1]).join(", ")).toBeLessThan(25);
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

describe("indian-river.json", () => {
  const g = irl.grid;
  const km = Uint8Array.from(atob(g.km), (ch) => ch.charCodeAt(0));
  const at = (lon: number, lat: number) => km[Math.floor((lat - g.lat0) / g.res) * g.nx + Math.floor((lon - g.lon0) / g.res)];

  it("has a flushing grid of the right size, with the inlets at zero", () => {
    expect(km.length).toBe(g.nx * g.ny);
    expect(g.farthest).toBeGreaterThan(40);
    expect(irl.inlets.map((i) => i.name)).toEqual(["Ponce de Leon Inlet", "Sebastian Inlet", "Fort Pierce Inlet", "St. Lucie Inlet", "Jupiter Inlet"]);
    // Three were dug; Ponce de Leon and Jupiter are natural.
    expect(irl.inlets.filter((i) => i.cut).length).toBe(3);
    // The lagoon right inside each inlet is a km or two from it.
    for (const [lon, lat] of [[-80.458, 27.86], [-80.31, 27.47]]) expect(at(lon, lat), `${lon},${lat}`).toBeLessThanOrEqual(3);
  });

  it("puts the slowest water far from any inlet: the northern lagoon and the Banana River", () => {
    // The Banana River's north end, the Indian River at Titusville and at Cocoa, versus Melbourne.
    expect(at(-80.61, 28.47)).toBeGreaterThan(60);
    expect(at(-80.79, 28.61)).toBeGreaterThan(40);
    expect(at(-80.72, 28.36)).toBeGreaterThan(40);
    expect(at(-80.59, 28.08)).toBeLessThan(40);
    // Mainland and open sea aren't lagoon.
    expect(at(-80.9, 28.0)).toBe(255);
    expect(at(-80.2, 28.0)).toBe(255);
  });

  it("brings every gauge's water into the lagoon", () => {
    for (const k of IRL_KEYS) {
      const line = irl.streams[k];
      expect(line.length, k).toBeGreaterThanOrEqual(4);
      expect(line.length % 2).toBe(0);
    }
    // Haulover runs west to east, the way USGS counts positive.
    const h = irl.streams.HAUL;
    expect(h[h.length - 2]).toBeGreaterThan(h[0]);
  });

  it("has freshwater history from both groups", () => {
    const { years, canals, creeks } = irl.history;
    expect(canals.length).toBe(years.length);
    expect(creeks.length).toBe(years.length);
    expect(canals.filter((v) => v != null).length).toBeGreaterThan(20);
    expect(creeks.filter((v) => v != null).length).toBeGreaterThan(10);
    for (const v of [...canals, ...creeks]) if (v != null) expect(v).toBeGreaterThan(0);
  });
});

describe("reefs.json", () => {
  it("has the reef tract, patch reefs, hard bottom, and seagrass in both stations' regions", () => {
    for (const k of ["keys", "southeast"] as const) {
      expect(reefs.habitat.reef[k].length, k).toBeGreaterThan(50);
      expect(reefs.habitat.patches[k].length / 2, k).toBeGreaterThan(1000);
    }
    expect(reefs.habitat.hardbottom.length).toBeGreaterThan(100);
    expect(reefs.habitat.seagrass.length).toBeGreaterThan(100);
    for (const r of [...reefs.habitat.reef.keys, ...reefs.habitat.hardbottom, ...reefs.sea]) {
      expect(r.length % 2).toBe(0);
      expect(r.length).toBeGreaterThanOrEqual(8);
    }
  });

  it("names FWC's twelve reef regions, each covered by a station", () => {
    expect(reefs.regions).toHaveLength(12);
    for (const r of reefs.regions) expect(["keys", "southeast"]).toContain(r.station);
    const station = (n: string) => reefs.regions.find((r) => r.name === n)?.station;
    expect([station("Dry Tortugas"), station("Upper Keys"), station("Martin"), station("Biscayne")]).toEqual(["keys", "keys", "southeast", "southeast"]);
  });

  it("has NOAA's yearly heat stress since 1985, with 2023's record", () => {
    const { years, keys, southeast } = reefs.heat;
    expect(years[0]).toBe(1985);
    expect(keys.length).toBe(years.length);
    expect(southeast.length).toBe(years.length);
    for (const v of [...keys, ...southeast]) if (v != null) expect(v >= 0 && v < 60).toBe(true);
    expect(keys[years.indexOf(2023)]).toBeGreaterThan(20);
  });
});

describe("parks.json", () => {
  const byName = new Map(parks.parks.map((p) => [p.name, p]));
  const water = (n: string) => PARK_WATER[byName.get(n)?.water ?? -1];

  it("has every state park with its water, once each", () => {
    expect(parks.meta.classes).toEqual([...PARK_WATER]);
    expect(parks.parks.length).toBeGreaterThan(170);
    expect(byName.size).toBe(parks.parks.length);
    for (const p of parks.parks) {
      expect(PARK_WATER[p.water], p.name).toBeDefined();
      expect(p.acres, p.name).toBeGreaterThanOrEqual(0);
      if (p.url) expect(p.url).toMatch(/^https:\/\/www\.floridastateparks\.org\//);
      expect(p.rings.length, p.name).toBeGreaterThan(0);
      for (const r of p.rings) expect(r.length % 2).toBe(0);
    }
  });

  it("puts each park's marker inside it", () => {
    const outside = parks.parks.filter((p) => !inPacked(undelta(p.rings), parks.meta.coordOrigin, parks.meta.coordScale, ...p.at));
    expect(outside.map((p) => p.name)).toEqual([]);
  });

  it("shades the parks by the water they're known for", () => {
    expect(water("Edward Ball Wakulla Springs State Park")).toBe("springs");
    expect(water("Silver Springs State Park")).toBe("springs");
    expect(water("Ichetucknee Springs State Park")).toBe("springs");
    expect(water("John Pennekamp Coral Reef State Park")).toBe("reef");
    expect(water("Hillsborough River State Park")).toBe("rivers");
    expect(water("Kissimmee Prairie Preserve State Park")).toBe("lakes");
    expect(water("Honeymoon Island State Park")).toBe("coast");
    expect(water("Big Lagoon State Park")).toBe("coast");
    expect(water("San Pedro Underwater Archaeological Preserve State Park")).toBe("coast");
    expect(water("Ybor City Museum State Park")).toBe("land");
    // Windley Key's reef is a fossil, on land.
    expect(water("Windley Key Fossil Reef Geological State Park")).not.toBe("reef");
  });

  it("counts springs and first-magnitude springs the way springs.json does", () => {
    const counted = parks.parks.reduce((n, p) => n + p.springs, 0);
    expect(counted).toBe(statewide.springs.filter((s) => s[7]).length);
    const big = parks.parks.reduce((n, p) => n + p.big, 0);
    expect(big).toBeGreaterThan(5);
    expect(big).toBeLessThan(parks.firstMagnitude);
    expect(parks.firstMagnitude).toBeGreaterThan(20);
    expect(parks.firstMagnitude).toBeLessThan(40);
    expect(byName.get("Edward Ball Wakulla Springs State Park")?.big).toBe(1);
    // Silver's first-magnitude vents are one spring.
    expect(byName.get("Silver Springs State Park")?.big).toBe(1);
  });

  it("names only real parks in the page's hand-written content", () => {
    const named = [...PLAN_2024, ...Object.keys(NOTES), ...Object.keys(MAP_LINKS)];
    expect(named.filter((n) => !byName.has(n))).toEqual([]);
    expect(PLAN_2024.size).toBe(9);
  });
});

describe("kissimmee.json", () => {
  const [ox, oy] = kiss.meta.coordOrigin;
  const k = kiss.meta.coordScale;
  const lonlat = (flat: number[], i: number): [number, number] => [flat[i * 2] / k + ox, flat[i * 2 + 1] / k + oy];
  const km = (a: [number, number], b: [number, number]) => Math.hypot((a[0] - b[0]) * 98.7, (a[1] - b[1]) * 110.5);
  const at = (name: string): [number, number] => {
    const s = kiss.structures.find((q) => q.name === name)!;
    return [s.lon, s.lat];
  };

  it("runs the river from S-65 to S-65E, every vertex classed", () => {
    const { p, c } = kiss.river;
    expect(kiss.meta.classes).toEqual([...KISS_CLASSES]);
    expect(c.length).toBe(p.length / 2);
    expect(new Set(c)).toEqual(new Set([0, 1, 2]));
    expect(km(lonlat(p, 0), at("S-65"))).toBeLessThan(1);
    expect(km(lonlat(p, c.length - 1), at("S-65E"))).toBeLessThan(1);
    // It starts and ends as canal, with the bends between.
    expect([c[0], c[c.length - 1]]).toEqual([0, 0]);
  });

  it("measures the canal, the bends, and the filled stretch about right", () => {
    const { canal, river, filled } = kiss.river.miles;
    expect(canal + river + filled).toBeGreaterThan(50);
    expect(canal + river + filled).toBeLessThan(62);
    expect(river).toBeGreaterThan(15);
    expect(filled).toBeGreaterThan(3);
    expect(canal).toBeGreaterThan(15);
  });

  it("has the filled canal, the old channel, C-41A, and the floodplain", () => {
    expect(kiss.filled.length).toBeGreaterThanOrEqual(2);
    expect(kiss.oldChannel.length).toBeGreaterThan(50);
    expect(kiss.istokpoga.length).toBeGreaterThanOrEqual(8);
    expect(kiss.floodplain.length).toBeGreaterThan(0);
    expect(kiss.floodplainKm2).toBeGreaterThan(50);
    const lakes = new Set(kiss.water.map((b) => b.name));
    for (const n of ["Lake Kissimmee", "Lake Istokpoga", "Lake Okeechobee"]) expect(lakes, n).toContain(n);
    for (const r of [...kiss.filled, ...kiss.oldChannel, kiss.istokpoga]) expect(r.length % 2).toBe(0);
  });

  it("has the river's flow into the lake since 1929, from both sources", () => {
    const { years, S65E } = kiss.history;
    expect(years[0]).toBe(1929);
    expect(S65E.length).toBe(years.length);
    for (const v of S65E) if (v != null) expect(v).toBeGreaterThan(0);
    expect(S65E.slice(0, years.indexOf(2004) + 1).filter((v) => v != null).length).toBeGreaterThan(60);
    expect(S65E.slice(years.indexOf(2015)).filter((v) => v != null).length).toBeGreaterThan(5);
  });
});

describe("ocklawaha.json", () => {
  const [ox, oy] = ock.meta.coordOrigin;
  const k = ock.meta.coordScale;
  const lonlat = (flat: number[], i: number): [number, number] => [flat[i * 2] / k + ox, flat[i * 2 + 1] / k + oy];

  it("runs the Ocklawaha from Moss Bluff to the St. Johns, through the reservoir", () => {
    const { p, res } = ock.rivers["Ocklawaha River"];
    expect(res.length).toBe(p.length / 2);
    const [lon0, lat0] = lonlat(p, 0);
    const [lon1, lat1] = lonlat(p, res.length - 1);
    // Moss Bluff is south of the St. Johns, and west of it.
    expect(lat0).toBeLessThan(29.1);
    expect(lat1).toBeGreaterThan(29.45);
    expect(lon1).toBeGreaterThan(lon0);
    // In the reservoir somewhere in the middle, free at both ends.
    expect(res.filter((f) => f === 1).length).toBeGreaterThan(5);
    expect([res[0], res[res.length - 1]]).toEqual([0, 0]);
  });

  it("has the Silver River, Orange Creek, the canal, and the reservoir", () => {
    for (const n of ["Silver River", "Orange Creek"] as const) expect(ock.rivers[n].p.length, n).toBeGreaterThan(20);
    expect(ock.canal.length).toBeGreaterThan(0);
    expect(ock.reservoirKm2).toBeGreaterThan(20);
    expect(ock.reservoir.length).toBeGreaterThan(0);
    expect(ock.structures.map((s) => s.role).sort()).toEqual(["dam", "lock", "unfinished"]);
  });

  it("finds FDEP springs under the reservoir, all in springs.json", () => {
    const ids = new Set(statewide.springs.map((s) => s[0]));
    expect(ock.drowned.length).toBeGreaterThanOrEqual(5);
    for (const [id] of ock.drowned) expect(ids, id).toContain(id);
  });

  it("has Silver Springs' flow since the 1930s", () => {
    const { years, SILV, EUR } = ock.history;
    expect(years[0]).toBeLessThanOrEqual(1933);
    expect(SILV.length).toBe(years.length);
    expect(EUR.length).toBe(years.length);
    expect(SILV.filter((v) => v != null).length).toBeGreaterThan(80);
    for (const v of [...SILV, ...EUR]) if (v != null) expect(v).toBeGreaterThan(0);
  });
});

describe("gauges and snapshot", () => {
  const keys = [...FLOW_KEYS, ...RAINBOW_KEYS, ...STLUCIE_KEYS, ...LAKEO_KEYS, ...IRL_KEYS, ...KISS_KEYS, ...OCK_KEYS];

  it("has one gauge per flow key with unique site ids", () => {
    expect(gauges.map((g) => g.key).sort()).toEqual([...keys].sort());
    for (const g of gauges) expect(["santa-fe", "rainbow", "st-lucie", "lake-o", "indian-river", "kissimmee", "ocklawaha"]).toContain(g.page);
    expect(gauges.filter((g) => g.page === "ocklawaha").map((g) => g.key).sort()).toEqual([...OCK_KEYS].sort());
    expect(gauges.filter((g) => g.page === "kissimmee").map((g) => g.key).sort()).toEqual([...KISS_KEYS].sort());
    expect(gauges.filter((g) => g.page === "indian-river").map((g) => g.key).sort()).toEqual([...IRL_KEYS].sort());
    expect(gauges.filter((g) => g.page === "rainbow").map((g) => g.key).sort()).toEqual([...RAINBOW_KEYS].sort());
    expect(gauges.filter((g) => g.page === "st-lucie").map((g) => g.key).sort()).toEqual([...STLUCIE_KEYS].sort());
    // Only the canals' structures and Haulover Canal, which the wind and tide push either way, run backward.
    expect(gauges.filter((g) => g.signed).map((g) => g.key).sort()).toEqual([...STLUCIE_KEYS, ...LAKEO_KEYS.filter((k) => k !== "FEC"), "HAUL"].sort());
    expect(new Set(gauges.map((g) => g.id)).size).toBe(gauges.length);
    // USGS gauges go by site number; the Corps' CWMS ones by structure, with a flow series.
    for (const g of gauges) {
      if (g.source === "cwms") expect(g.ts?.startsWith(`${g.id}.Flow.`), g.key).toBe(true);
      else expect(g.id).toMatch(/^\d{8,15}$/);
    }
  });

  it("has one salinity station per key", () => {
    expect(salinity.map((s) => s.key).sort()).toEqual([...SALINITY_KEYS].sort());
    for (const s of salinity) expect(s.id).toMatch(/^\d{8,15}$/);
  });

  it("has the reef's heat stress, when NOAA answered", () => {
    if (!snapshot.reef) return;
    for (const h of Object.values(snapshot.reef)) {
      expect(h.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(h.dhw >= 0 && h.dhw <= h.peak + 0.05).toBe(true);
      expect(Number.isInteger(h.level) && h.level >= 0 && h.level <= 7).toBe(true);
    }
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
    for (const k of [...FLOW_KEYS, ...RAINBOW_KEYS, "FEC" as const, ...IRL_KEYS.filter((k) => k !== "HAUL"), ...KISS_KEYS, ...OCK_KEYS]) {
      const v = snapshot.cfs[k];
      if (v != null) expect(v).toBeGreaterThanOrEqual(0);
    }
  });
});
