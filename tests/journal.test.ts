import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { summarize, type Visit } from "../src/journal/api";
import { fitWithin } from "../src/journal/photos";
import { parseWhere } from "../src/journal/where";
import { GROUPS, SEA_SPECIES, SPECIES, speciesGroup } from "../src/journal/wildlife";
import { allPlaces, placeInfo } from "../src/shared/places";
import { KIND_LABEL } from "../src/shared/snorkel";
import type { MemberSpot } from "../src/shared/types";

const migration = readFileSync(new URL("../supabase/migrations/20260924000000_spring_journal.sql", import.meta.url), "utf8");
const spotsMigration = readFileSync(new URL("../supabase/migrations/20260925010000_member_spots.sql", import.meta.url), "utf8");

describe("wildlife groups", () => {
  it("match the database's allowed animal groups exactly", () => {
    const m = migration.match(/animal_group in \(([^)]*)\)/);
    const allowed = m![1].split(",").map((s) => s.trim().replace(/'/g, ""));
    expect(GROUPS.map((g) => g.id).sort()).toEqual(allowed.sort());
  });

  it("gives every quick-tap species a real group", () => {
    const ids = new Set(GROUPS.map((g) => g.id));
    for (const list of [SPECIES, SEA_SPECIES]) {
      for (const s of list) expect(ids.has(s.group), s.name).toBe(true);
      expect(new Set(list.map((s) => s.name)).size).toBe(list.length);
    }
    // An ocean animal typed into "Something else" still finds its group.
    expect(speciesGroup("Nurse shark")).toBe("fish");
  });

  it("files unknown animals under Other", () => {
    expect(speciesGroup("Manatee")).toBe("manatees");
    expect(speciesGroup("Pileated woodpecker")).toBe("other");
  });
});

describe("summarize", () => {
  const visit = (spring: string, date: string, rating: number | null, groups: string[] = []): Visit => ({
    id: `${spring}-${date}`,
    spring_id: spring,
    visited_on: date,
    rating,
    notes: null,
    created_by: "u",
    created_by_email: "a@example.com",
    created_at: "",
    sightings: groups.map((g, i) => ({ id: String(i), visit_id: "", species: g, animal_group: g as never, count: 1, lat: null, lon: null, from_gps: false, seen_at: "", notes: null, created_by: "u" })),
    photos: [],
  });

  it("counts visits, averages only rated ones, and keeps the latest date", () => {
    const s = summarize([visit("ginnie", "2026-05-01", 5, ["turtles"]), visit("ginnie", "2026-07-04", null, ["fish", "turtles"]), visit("ginnie", "2026-06-01", 3)]).get("ginnie")!;
    expect(s.visits).toBe(3);
    expect(s.rating).toBe(4);
    expect(s.last).toBe("2026-07-04");
    expect([...s.groups].sort()).toEqual(["fish", "turtles"]);
  });

  it("leaves the rating empty when no visit was rated", () => {
    expect(summarize([visit("x", "2026-01-01", null)]).get("x")!.rating).toBeNull();
  });
});

describe("fitWithin", () => {
  it("scales the long edge down to the limit and never upscales", () => {
    expect(fitWithin(4032, 3024, 1800)).toEqual([1800, 1350]);
    expect(fitWithin(3024, 4032, 1800)).toEqual([1350, 1800]);
    expect(fitWithin(800, 600, 1800)).toEqual([800, 600]);
  });
});

describe("snorkel spots in the journal", () => {
  const mine: MemberSpot = { id: "spot-abc", name: "Sailfish flats", kind: "lagoon", lat: 27.17, lon: -80.17, notes: null, created_by: "u", created_by_email: "a@example.com", created_at: "" };

  it("allows the same kinds of spot as the database", () => {
    const m = spotsMigration.match(/kind in \(([^)]*)\)/);
    const allowed = m![1].split(",").map((x) => x.trim().replace(/'/g, ""));
    expect(Object.keys(KIND_LABEL).sort()).toEqual(allowed.sort());
  });

  it("keeps the \"spot-\" id prefix for members' spots", () => {
    const springs = JSON.parse(readFileSync(new URL("../public/data/springs.json", import.meta.url), "utf8")).springs as [string][];
    const taken = [...springs.map((s) => s[0]), ...allPlaces([]).map((p) => p[0])].filter((id) => id.startsWith("spot-"));
    expect(taken).toEqual([]);
    expect(spotsMigration).toMatch(/check \(id like 'spot-%'/);
  });

  it("lists springs, curated spots, and members' spots together", () => {
    const places = allPlaces([["ginnie-spring--gilchrist", "Ginnie Spring", "Gilchrist", -82.7, 29.83, 0, 1, ""]], [mine]);
    const ids = places.map((p) => p[0]);
    expect(ids).toContain("ginnie-spring--gilchrist");
    expect(ids).toContain("bathtub-reef-beach--martin");
    expect(ids).toContain("spot-abc");
  });

  it("tells a spring from a spot, and salt water from fresh", () => {
    expect(placeInfo("ginnie-spring--gilchrist")).toMatchObject({ spring: true, snorkel: true, salt: false });
    expect(placeInfo("silver-spring--marion")).toMatchObject({ spring: true, snorkel: false });
    expect(placeInfo("bathtub-reef-beach--martin")).toMatchObject({ spring: false, snorkel: true, salt: true, kind: "reef" });
    expect(placeInfo("devils-den--levy")).toMatchObject({ spring: false, salt: false, kind: "cave" });
    expect(placeInfo("spot-abc", [mine])).toMatchObject({ spring: false, salt: true, member: mine });
  });

  it("reads coordinates the way map apps copy them", () => {
    expect(parseWhere("27.1859, -80.1607")).toEqual([27.1859, -80.1607]);
    expect(parseWhere(" 27.1859 -80.1607 ")).toEqual([27.1859, -80.1607]);
    expect(parseWhere("-80.1607, 27.1859")).toBeNull();
    expect(parseWhere("40.7, -74.0")).toBeNull();
    expect(parseWhere("somewhere")).toBeNull();
  });
});
