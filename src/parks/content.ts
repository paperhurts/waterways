// Hand-authored content for the state parks map: views, the water classes' names and
// card text, and links to the other maps. The facts are from FDEP (the Division of
// Recreation and Parks) and the Florida Legislature.

import { bounds } from "../shared/geo";
import type { ParkWater } from "../shared/types";

export const VIEWS = {
  all: bounds(-87.6, 24.5, -79.9, 31.1),
  pan: bounds(-87.5, 29.6, -84.2, 31.0),
  bend: bounds(-84.5, 28.9, -82.2, 30.7),
  ne: bounds(-82.2, 28.8, -80.9, 30.75),
  central: bounds(-82.9, 27.3, -80.6, 29.3),
  sw: bounds(-82.9, 25.8, -81.0, 27.7),
  se: bounds(-80.95, 25.5, -79.95, 27.9),
  keys: bounds(-82.95, 24.4, -80.1, 25.6),
};

export const CITIES: [string, number, number][] = [
  ["Pensacola", -87.217, 30.421], ["Panama City", -85.66, 30.159], ["Tallahassee", -84.28, 30.438], ["Jacksonville", -81.656, 30.332],
  ["Gainesville", -82.325, 29.652], ["Ocala", -82.14, 29.187], ["Orlando", -81.379, 28.538], ["Tampa", -82.458, 27.948], ["Fort Myers", -81.872, 26.64],
  ["West Palm Beach", -80.053, 26.715], ["Miami", -80.19, 25.77], ["Key West", -81.78, 24.555],
];

/** Each water class: its color token and its name in the legend and cards. */
export const WATER: Record<ParkWater, { token: string; name: string }> = {
  springs: { token: "--spring", name: "Springs" },
  rivers: { token: "--tannin", name: "Rivers" },
  lakes: { token: "--park-lake", name: "Lakes and wetlands" },
  coast: { token: "--park-coast", name: "Coast" },
  reef: { token: "--park-reef", name: "Reef" },
  land: { token: "--muted", name: "Mostly dry land" },
};

/** The nine parks in DEP's 2024 "Great Outdoors Initiative," which proposed golf, pickleball, and lodges in them. */
export const PLAN_2024 = new Set([
  "Anastasia State Park",
  "Camp Helen State Park",
  "Dr. Von D. Mizell-Eula Johnson State Park",
  "Grayton Beach State Park",
  "Hillsborough River State Park",
  "Honeymoon Island State Park",
  "Jonathan Dickinson State Park",
  "Oleta River State Park",
  "Topsail Hill Preserve State Park",
]);
export const PLAN_TEXT =
  "One of nine parks in a state plan, made public in August 2024, to add golf courses, pickleball courts, or lodges. After an outcry the plan was dropped, and in 2025 the Legislature unanimously passed the State Park Preservation Act, which keeps them out of every state park.";

/** Extra lines for a few parks' cards. */
export const NOTES: Record<string, string> = {
  "John Pennekamp Coral Reef State Park": "The first undersea park in the United States, opened in 1963. Most of it is the Atlantic, out to the reef tract off Key Largo.",
  "St. Lucie Inlet Preserve State Park": "Its reef is built by worms: sabellariid worms cement sand into tubes along the nearshore rock, the northern end of Florida's Coral Reef.",
  "Jonathan Dickinson State Park": "The 2024 plan would have put three golf courses here, along the Loxahatchee, Florida's first federally designated Wild and Scenic River.",
  "Edward Ball Wakulla Springs State Park": "Wakulla Spring is one of the largest and deepest freshwater springs in the world.",
};

/** Links to the other maps, for parks they show. */
export const MAP_LINKS: Record<string, [href: string, label: string][]> = {
  "Rainbow Springs State Park": [["rainbow.html", "The Rainbow River map"]],
  "Ichetucknee Springs State Park": [["santa-fe.html", "The Santa Fe map"]],
  "O'Leno State Park": [["santa-fe.html", "The Santa Fe map"]],
  "River Rise Preserve State Park": [["santa-fe.html", "The Santa Fe map"]],
  "Ruth B. Kirby Gilchrist Blue Springs State Park": [["santa-fe.html", "The Santa Fe map"]],
  "John Pennekamp Coral Reef State Park": [["reefs.html", "The coral reef map"]],
  "St. Lucie Inlet Preserve State Park": [["reefs.html", "The coral reef map"], ["indian-river.html", "The Indian River Lagoon map"]],
  "Sebastian Inlet State Park": [["indian-river.html", "The Indian River Lagoon map"]],
  "Fort Pierce Inlet State Park": [["indian-river.html", "The Indian River Lagoon map"]],
  "Indian River Lagoon Preserve State Park": [["indian-river.html", "The Indian River Lagoon map"]],
  "Savannas Preserve State Park": [["indian-river.html", "The Indian River Lagoon map"]],
  "Avalon State Park": [["indian-river.html", "The Indian River Lagoon map"]],
  "Okeechobee Battlefield Historic State Park": [["lake-o.html", "The Lake Okeechobee map"]],
};
