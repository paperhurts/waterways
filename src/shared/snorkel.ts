// The curated snorkel spots (config/snorkel.json): springs from the journal's list that
// are good for snorkeling, and spots that aren't springs at all. Locations are from
// OpenStreetMap.

import file from "../../config/snorkel.json";
import type { SnorkelFile, SnorkelSpot, SpotKind } from "./types";

export const snorkel = file as SnorkelFile;
export const snorkelSprings = new Set(snorkel.springs);
export const snorkelSpots: SnorkelSpot[] = snorkel.spots;

/** A card's label for each kind of spot. */
export const KIND_LABEL: Record<SpotKind, string> = {
  reef: "Reef off the beach",
  offshore: "Offshore reef, by boat",
  lagoon: "In the lagoon",
  inlet: "Inlet",
  park: "Park",
  island: "Island",
  beach: "Beach",
  cave: "Spring in a cave",
  sinkhole: "Water-filled sinkhole",
  spring: "Spring",
  other: "Swim spot",
};

/** Kinds that are salt water, where the journal offers ocean animals to log. */
export const SALT_KINDS = new Set<SpotKind>(["reef", "offshore", "lagoon", "inlet", "park", "island", "beach"]);

export const osmUrl = (s: SnorkelSpot) => `https://www.openstreetmap.org/${s.osm}`;
