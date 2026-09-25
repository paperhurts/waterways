// Dev-only sample journal (journal.html?demo on the dev server) so the signed-in
// screens can be built and checked without an account. Vite drops this from
// production builds because the only import is behind import.meta.env.DEV.

import type { Journal, Visit } from "./api";

const s = (id: string, species: string, group: string, count = 1, gps?: [number, number]) => ({
  id,
  visit_id: "",
  species,
  animal_group: group as never,
  count,
  lat: gps?.[1] ?? null,
  lon: gps?.[0] ?? null,
  from_gps: !!gps,
  seen_at: "",
  notes: null,
  created_by: "demo-a",
});

const visits: Visit[] = [
  {
    id: "v1", spring_id: "silver-spring--marion", visited_on: "2026-08-16", rating: 5, notes: "Glass-bottom boat, then paddled the river. Water unreal.",
    created_by: "demo-a", created_by_email: "river@example.com", created_at: "",
    sightings: [s("s1", "Manatee", "manatees", 2, [-82.0412, 29.2152]), s("s2", "River cooter", "turtles", 6), s("s3", "Anhinga", "birds")], photos: [],
  },
  {
    id: "v2", spring_id: "ginnie-spring--gilchrist", visited_on: "2026-07-04", rating: 4, notes: "Crowded by noon. Get there early.",
    created_by: "demo-b", created_by_email: "spring@example.com", created_at: "",
    sightings: [s("s4", "Gar", "fish", 3), s("s5", "Softshell turtle", "turtles")], photos: [],
  },
  {
    id: "v3", spring_id: "ginnie-spring--gilchrist", visited_on: "2026-05-23", rating: 5, notes: null,
    created_by: "demo-a", created_by_email: "river@example.com", created_at: "",
    sightings: [s("s6", "River otter", "otters", 1, [-82.6995, 29.8358])], photos: [],
  },
  {
    id: "v4", spring_id: "bathtub-reef-beach--martin", visited_on: "2026-06-14", rating: 5, notes: "Calm at low tide, clear right up to the reef.",
    created_by: "demo-b", created_by_email: "spring@example.com", created_at: "",
    sightings: [s("s7", "Sergeant major", "fish", 12), s("s8", "Sea turtle", "turtles")], photos: [],
  },
  {
    id: "v5", spring_id: "spot-demo1", visited_on: "2026-06-15", rating: 4, notes: null,
    created_by: "demo-a", created_by_email: "river@example.com", created_at: "",
    sightings: [s("s9", "Stingray", "fish", 2)], photos: [],
  },
];

export const DEMO_EMAIL = "river@example.com";

export const DEMO_JOURNAL: Journal = {
  members: [
    { email: "river@example.com", display_name: "River", added_at: "" },
    { email: "spring@example.com", display_name: "Spring", added_at: "" },
  ],
  visits,
  spots: [{ id: "spot-demo1", name: "Sailfish Point flats", kind: "lagoon", lat: 27.176, lon: -80.172, notes: "Wade in from the sandbar.", created_by: "demo-a", created_by_email: "river@example.com", created_at: "" }],
};
