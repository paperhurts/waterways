// The curated snorkel spots (config/snorkel.json): springs from the journal's list that
// are good for snorkeling, and spots that aren't springs at all. Locations are from
// OpenStreetMap.

import file from "../../config/snorkel.json";
import type { SnorkelFile, SnorkelKind, SnorkelSpot } from "./types";

export const snorkel = file as SnorkelFile;
export const snorkelSprings = new Set(snorkel.springs);
export const snorkelSpots: SnorkelSpot[] = snorkel.spots;

/** A card's label for each kind of spot. */
export const KIND_LABEL: Record<SnorkelKind, string> = {
  reef: "Reef off the beach",
  offshore: "Offshore reef, by boat",
  lagoon: "In the lagoon",
  inlet: "Inlet",
  park: "Park",
  island: "Island",
  beach: "Beach",
  cave: "Spring in a cave",
  sinkhole: "Water-filled sinkhole",
};

export const osmUrl = (s: SnorkelSpot) => `https://www.openstreetmap.org/${s.osm}`;
