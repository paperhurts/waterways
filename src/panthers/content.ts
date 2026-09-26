// Hand-authored content for the panther map: views, labels, and card text. The facts are
// from FWC (the population's low, the genetic restoration, the causes of death, the
// wildlife crossings, feline leukomyelopathy, and its March 27, 2017 release on kittens
// north of the Caloosahatchee), the 2017 USFWS/FWC population estimate, Johnson et al.
// 2010 in Science (the Texas females' litters), Aguilar-Gómez et al. 2025 in PNAS (Texas
// ancestry today), UF/IFAS (the breeding range's share of the original), USFWS (the
// Florida Panther National Wildlife Refuge), Local10's September 14, 2026 report of the
// Babcock Ranch trail camera video, and the Palm Beach Zoo's panther cam page.

import { bounds } from "../shared/geo";
import type { PantherCause, PantherZone } from "../shared/types";

export const VIEWS = {
  /** The breeding range, and the river north of it. */
  all: bounds(-82.25, 25.15, -80.35, 27.1),
  cypress: bounds(-81.75, 25.75, -80.85, 26.5),
  north: bounds(-82.15, 26.5, -81.2, 27.05),
};

/** Towns, and the map scale (px a unit) from which each is labeled, so a phone's whole-range view isn't a pile of names. */
export const TOWNS: [name: string, lon: number, lat: number, east: boolean, from: number][] = [
  ["Naples", -81.795, 26.142, false, 0], ["Fort Myers", -81.872, 26.64, false, 0], ["Homestead", -80.477, 25.468, true, 0], ["Immokalee", -81.417, 26.419, true, 350],
  ["Everglades City", -81.385, 25.857, true, 450], ["LaBelle", -81.438, 26.762, true, 450], ["Clewiston", -80.934, 26.754, true, 450], ["Punta Gorda", -82.045, 26.929, false, 350],
];

/** Wild places, in italics, and the scale from which each is labeled. */
export const PLACES: [name: string, lon: number, lat: number, from: number][] = [
  ["Big Cypress", -81.12, 25.98, 0], ["Everglades", -80.78, 25.5, 0], ["Babcock Ranch", -81.8, 26.87, 450], ["Florida Panther NWR", -81.5, 26.21, 450],
  ["Fakahatchee Strand", -81.62, 25.96, 450], ["Corkscrew", -81.62, 26.4, 600], ["Okaloacoochee Slough", -81.3, 26.52, 600],
];

/** Road names, small: [name, lon, lat]. */
export const ROADS: [name: string, lon: number, lat: number][] = [
  ["I-75, Alligator Alley", -81.05, 26.19], ["SR 29", -81.36, 26.3], ["US 41, Tamiami Trail", -81.05, 25.8], ["SR 82", -81.72, 26.52],
];

export const FACTS = {
  low: "20 to 30",
  now: "120 to 230",
  texas: 8,
  bred: 5,
  kittens: 20,
  litters: 12,
  released: 1995,
  removed: 2003,
  ancestry: "24 to 61",
  crossings: 24,
  bridges: 12,
  fencedMiles: 40,
  flmConfirmed: 15,
  flmBobcats: 12,
  flmProbable: 35,
  flmProbableBobcats: 41,
  refugeAcres: 26400,
};

export const CAM = { url: "https://www.palmbeachzoo.org/panthercam", zoo: "Palm Beach Zoo" };

export const RESCUE_TEXT =
  `By the early 1990s only ${FACTS.low} Florida panthers were left, so inbred that many had kinked tails and heart defects. ` +
  `In ${FACTS.released} biologists released eight female pumas from Texas to bring in new genes. Five of them had kittens: at least ${FACTS.kittens}, in ${FACTS.litters} litters. ` +
  `The last two were taken back out of the wild in ${FACTS.removed}; their kittens stayed.`;

export const ANCESTRY_TEXT =
  `So are today's panthers Texan? Partly. A 2025 study of 29 panthers born after the release found each carried ${FACTS.ancestry} percent Texas ancestry, ` +
  "and nowhere in the genome had it replaced the Florida line entirely.";

export const POP_TEXT =
  `About ${FACTS.now} adult and subadult panthers live in the wild (the 2017 estimate by the U.S. Fish and Wildlife Service and FWC; kittens aren't counted). ` +
  "Nearly all live south of the Caloosahatchee River, in a breeding range about 5 percent the size of the original.";

export const ROAD_SHORT = (vehicle: number, total: number, first: number) =>
  `Cars kill more panthers than anything else: ${vehicle} of the ${total} deaths FWC has recorded since ${first}.`;

export const ROAD_TEXT = (vehicle: number, total: number, first: number) =>
  `${ROAD_SHORT(vehicle, total, first)} ` +
  `Along ${FACTS.fencedMiles} miles of I-75's Alligator Alley, ${FACTS.crossings} wildlife crossings and ${FACTS.bridges} modified bridges, built in the early 1990s behind fencing, let panthers pass under the road.`;

export const RIVER_TEXT =
  "The Caloosahatchee, dredged in the 1880s to carry Lake Okeechobee's water to the Gulf, is the northern edge of the panthers' breeding range. Young males cross it; for decades females didn't. " +
  "In 2017 FWC confirmed kittens north of the river, born to the first wild female documented there since 1973. In September 2026, a trail camera at Babcock Ranch Preserve filmed a mother with three kittens.";

export const FLM_TEXT =
  "Since 2018, trail cameras have caught panthers and bobcats that wobble and can't walk straight: feline leukomyelopathy, a disease of the spinal cord. " +
  `As of April 2025, FWC had confirmed it in ${FACTS.flmConfirmed} panthers and ${FACTS.flmBobcats} bobcats, with ${FACTS.flmProbable} more panthers and ${FACTS.flmProbableBobcats} bobcats probable from video. The cause is still unknown.`;

export const SWAMP_TEXT =
  "Panthers keep to the slow water: the cypress strands, sloughs, pine flatwoods, and hammocks of the Big Cypress. The Fakahatchee Strand is the biggest strand in the Big Cypress swamp, " +
  `and the Florida Panther National Wildlife Refuge, set aside in 1989 at its northern end, protects ${FACTS.refugeAcres.toLocaleString()} acres of it.`;

export const CAM_TEXT =
  `Two panthers live at the ${CAM.zoo}, on a live cam it runs with WPTV: Sassy, who came to the zoo after her mother was hit by a car, and Mico. ` +
  `<a href="${CAM.url}" target="_blank" rel="noopener">Watch them live</a>.`;

export const ZONE_TEXT: Record<PantherZone, { title: string; body: string }> = {
  primary: { title: "Primary Zone", body: 'Drawn by the U.S. Fish and Wildlife Service\'s panther team as "all lands essential for the survival of the Florida panther in the wild."' },
  secondary: { title: "Secondary Zone", body: 'Lands next to the Primary Zone that panthers may already use, "where expansion of the Florida panther population is most likely to occur," as the Fish and Wildlife Service\'s panther team drew it.' },
  dispersal: { title: "Dispersal Zone", body: "A narrow way north the Fish and Wildlife Service's panther team marked as needed for panthers to reach and cross the Caloosahatchee." },
  north: { title: "North of the river", body: "The Fish and Wildlife Service's panther focus area north of the Caloosahatchee, where females have only lately returned." },
};

export const CAUSE_TEXT: Record<PantherCause, string> = {
  vehicle: "Hit by a vehicle",
  fight: "Killed by another panther",
  disease: "Disease",
  illegal: "Killed illegally",
  other: "Other causes",
};

/** A death's cause for its card, from FWC's own category. */
export function causeLine(group: PantherCause, fwc: string): string {
  if (group === "disease") {
    const what = fwc.replace(/^Infectious disease - /i, "").replace("FeLV", "feline leukemia virus").replace(/^Other$/, "an infection");
    return `Disease: ${what.charAt(0).toLowerCase()}${what.slice(1)}`;
  }
  if (group !== "other") return CAUSE_TEXT[group];
  return ({ Unknown: "Cause unknown", Predation: "Killed by a predator", Malnutrition: "Starved", "Capture related": "Died after capture" } as Record<string, string>)[fwc] ?? "Other causes";
}

/** What was happening, for the note under the clock: [from year, to year, text]. */
export const ERAS: [from: number, to: number, text: string][] = [
  [1981, 1984, "FWC puts its first radio collars on Florida panthers."],
  [1985, 1994, `Only ${FACTS.low} panthers are left, badly inbred.`],
  [1995, 2002, "Eight female pumas from Texas, in blue, bring in new genes. Five have kittens."],
  [2003, 2008, "The last two Texas pumas are taken out of the wild. Their kittens stay."],
  [2009, 2014, "Panthers spread through the Big Cypress, and more die on the roads."],
  [2015, 2016, "The most deaths on record, most of them on roads."],
  [2017, 2017, "Kittens north of the Caloosahatchee, the first there since 1973."],
  [2018, 2023, "Trail cameras catch panthers that wobble: a spinal disease, still unexplained."],
];
