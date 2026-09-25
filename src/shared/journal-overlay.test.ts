import { describe, expect, it, vi } from "vitest";
import { escapeHtml } from "./data";
import { hitSighting, journalCardHtml, sightingCard, type JournalOverlay, type OverlaySighting } from "./journal-overlay";

// The journal modules reach for the page at import, and journalUrl resolves against
// it; tests have no page. vi.hoisted runs before the imports above.
vi.hoisted(() => {
  (globalThis as { document?: unknown }).document = { baseURI: "https://waterways.test/rain.html" };
});

const visit = (date: string, notes: string | null = null) => ({ date, who: "Nanny <b>", rating: 4, notes, saw: [{ species: "West Indian manatee", count: 3 }], photos: 2 });

const sighting: OverlaySighting = {
  xy: [0, 0], group: "manatees", species: "West Indian manatee", count: 3, notes: "Calf <script>alert(1)</script>",
  date: "2026-09-24", who: "Grampy", springId: "blue-spring-volusia", springName: "Blue Spring",
};

const overlay = {
  visited: new Map([["rainbow-springs-marion", { visits: 4, rating: 4 }]]),
  visits: new Map([["rainbow-springs-marion", [visit("2026-09-24", "Clear as glass <3"), visit("2026-06-01"), visit("2025-12-30"), visit("2025-07-04")]]]),
  sightings: [sighting],
} as unknown as JournalOverlay;

describe("journalCardHtml", () => {
  const html = journalCardHtml(overlay, "rainbow-springs-marion");

  it("lists the newest visits with who, rating, notes, and what was seen, escaping member text", () => {
    expect(html).toContain(`Nanny ${escapeHtml("<b>")}`);
    expect(html).toContain("4 ★");
    expect(html).toContain(escapeHtml("Clear as glass <3"));
    expect(html).toContain("Saw West Indian manatee ×3.");
    expect(html).toContain("2 photos.");
    expect(html).not.toContain("<b>Nanny");
  });

  it("shows three visits, then says how many more", () => {
    expect(html.match(/class="journal-visit"/g)).toHaveLength(4);
    expect(html).toContain("And 1 more.");
    expect(html).toContain("journal.html#spring=rainbow-springs-marion");
  });

  it("offers to log a visit at a spring with none", () => {
    const empty = journalCardHtml(overlay, "unvisited");
    expect(empty).toContain("#log=unvisited");
    expect(empty).not.toContain("journal-visit");
  });
});

describe("sightingCard", () => {
  it("names the animal, place, date, and who saw it, with the note escaped", () => {
    const card = sightingCard(sighting);
    expect(card.title).toBe("West Indian manatee ×3");
    expect(card.kind).toBe("Manatees · Blue Spring");
    expect(card.body).toContain("by Grampy");
    expect(card.body).toContain(escapeHtml("Calf <script>"));
    expect(card.body).not.toContain("<script>");
    expect(card.body).toContain("#spring=blue-spring-volusia");
  });
});

describe("hitSighting", () => {
  const same = (v: number) => v;
  it("finds a sighting within a few pixels of the tap, and nothing farther", () => {
    expect(hitSighting(overlay, same, same, 5, 5)).toBe(sighting);
    expect(hitSighting(overlay, same, same, 20, 0)).toBeNull();
  });
});
