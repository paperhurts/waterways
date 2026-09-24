import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { summarize, type Visit } from "../src/journal/api";
import { fitWithin } from "../src/journal/photos";
import { GROUPS, SPECIES, speciesGroup } from "../src/journal/wildlife";

const migration = readFileSync(new URL("../supabase/migrations/20260924000000_spring_journal.sql", import.meta.url), "utf8");

describe("wildlife groups", () => {
  it("match the database's allowed animal groups exactly", () => {
    const m = migration.match(/animal_group in \(([^)]*)\)/);
    const allowed = m![1].split(",").map((s) => s.trim().replace(/'/g, ""));
    expect(GROUPS.map((g) => g.id).sort()).toEqual(allowed.sort());
  });

  it("gives every quick-tap species a real group", () => {
    const ids = new Set(GROUPS.map((g) => g.id));
    for (const s of SPECIES) expect(ids.has(s.group)).toBe(true);
    expect(new Set(SPECIES.map((s) => s.name)).size).toBe(SPECIES.length);
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
