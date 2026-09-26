// Hand-authored content for the coral reef map: views, labels, and card text. The
// facts are from FDEP's Coral Reef Conservation Program, FWC, NOAA (Coral Reef Watch and
// the Florida Keys National Marine Sanctuary), and the 2025 study in Science.

import { bounds } from "../shared/geo";

export const VIEWS = {
  /** The St. Lucie Inlet to the Dry Tortugas. */
  all: bounds(-83.05, 24.4, -79.95, 27.25),
  keys: bounds(-82.05, 24.4, -80.15, 25.4),
  southeast: bounds(-80.45, 25.3, -79.95, 27.25),
  tortugas: bounds(-83.05, 24.55, -82.72, 24.76),
};

export const TOWNS: [string, number, number][] = [
  ["Key West", -81.78, 24.555], ["Marathon", -81.09, 24.713], ["Islamorada", -80.628, 24.924], ["Key Largo", -80.447, 25.087],
  ["Miami", -80.19, 25.77], ["Fort Lauderdale", -80.137, 26.122], ["Boca Raton", -80.083, 26.359], ["West Palm Beach", -80.053, 26.715],
  ["Jupiter", -80.094, 26.934], ["Stuart", -80.253, 27.198],
];

export const STATION_NAME = { keys: "the Florida Keys", southeast: "Southeast Florida" } as const;

/** NOAA's bleaching alert levels, 0 to 7, in plain words. */
export const LEVEL_TEXT = [
  "no heat stress",
  "a bleaching watch",
  "a bleaching warning",
  "Alert Level 1: significant bleaching likely",
  "Alert Level 2: bleaching, with heat-sensitive corals dying",
  "Alert Level 3: many kinds of coral dying",
  "Alert Level 4: more than half the corals dying",
  "Alert Level 5: more than 80% of the corals dying",
];
export const LEVEL_SHORT = ["No stress", "Watch", "Warning", "Alert 1", "Alert 2", "Alert 3", "Alert 4", "Alert 5"];
/** Which color step a level takes: calm, watch and warning, Alert Levels 1-2, Alert Levels 3-5. */
export const tierOf = (level: number) => (level <= 0 ? 0 : level <= 2 ? 1 : level <= 4 ? 2 : 3);

export const REEF_TEXT =
  "The reef itself: banks and spur-and-groove ridges built up by corals, where the Keys' outer reef meets deep water.";
export const PATCH_TEXT =
  "A patch reef: a mound of coral inshore of the outer reef, in the shallower water between it and the islands.";
export const HARDBOTTOM_TEXT = "Hard bottom: flat rock with sponges, sea fans, soft corals, and scattered stony corals.";
export const SEAGRASS_TEXT = "Seagrass meadows of turtle grass and manatee grass: a nursery for fish, and food for sea turtles and manatees.";
export const ARTIFICIAL_TEXT = "An artificial reef: a ship, bridge rubble, concrete, or another structure sunk on purpose for reef life to grow on.";
export const WORM_REEF_TEXT =
  "Bathtub Reef isn't coral. Tiny sabellariid worms build it, cementing sand grains into tubes. More than 500 species use worm reefs like it, sea turtles among them. " +
  "Being buried under beach renourishment sand is the worst threat to them.";

export const LOSS = {
  miles: 350,
  pillar: 2020,
  acropora: 2023,
  diseaseFound: 2014,
  diseaseEverywhere: 2021,
  iconic: ["Carysfort", "Horseshoe", "Cheeca Rocks", "Sombrero", "Newfound Harbor", "Looe Key", "Eastern Dry Rocks"],
};
