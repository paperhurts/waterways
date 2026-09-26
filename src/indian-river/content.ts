// Hand-authored content for the Indian River Lagoon map: views, labels, and card text.
// Numbers about the lagoon's flushing come from the data; the rest are from the IRL
// National Estuary Program, the St. Johns River Water Management District, and the
// studies they cite.

import { bounds } from "../shared/geo";
import type { IrlKey } from "../shared/types";

export const VIEWS = {
  /** Ponce de Leon Inlet to Jupiter Inlet. */
  all: bounds(-81.0, 26.92, -80.02, 29.08),
  north: bounds(-80.98, 28.25, -80.5, 29.08),
  middle: bounds(-80.75, 27.55, -80.3, 28.3),
  south: bounds(-80.45, 26.92, -80.03, 27.58),
};

/** Towns, named west of these points (they're on the mainland shore), or east for those out on the barrier island. */
export const TOWNS: [name: string, lon: number, lat: number, east?: true][] = [
  ["New Smyrna Beach", -80.927, 29.026], ["Titusville", -80.808, 28.612], ["Cocoa", -80.742, 28.386], ["Cape Canaveral", -80.604, 28.405, true],
  ["Melbourne", -80.608, 28.084], ["Palm Bay", -80.588, 28.034], ["Sebastian", -80.47, 27.816], ["Vero Beach", -80.397, 27.638],
  ["Fort Pierce", -80.326, 27.447], ["Port St. Lucie", -80.358, 27.294], ["Stuart", -80.253, 27.198], ["Jupiter", -80.094, 26.934],
];

/** Where each part of the lagoon is named. */
export const WATERS: [name: string, lon: number, lat: number][] = [
  ["Mosquito Lagoon", -80.82, 28.9],
  ["Banana River", -80.64, 28.3],
  ["Indian River", -80.76, 28.5],
  ["Indian River", -80.42, 27.72],
];

export const LAGOON = {
  length: 156,
  depthFt: 4,
  /** Days for half of the water to be replaced (the lagoon's 50% renewal time). */
  northDays: 107,
  bananaDays: 156,
  farNorthDays: 230,
  /** The watershed, in acres, before drainage (1913) and after (2013). */
  shedBefore: 572_000,
  shedAfter: 1_400_000,
};

export const lagoonText = (miles: number, inlet: string) =>
  `About <b>${miles < 1 ? "less than a mile" : `${Math.round(miles)} mile${Math.round(miles) === 1 ? "" : "s"}`}</b> by water from the nearest inlet, ${inlet}. ` +
  `The farther from an inlet, the longer the water sits: half of the northern lagoon's water is still there after about ${LAGOON.northDays} days, and the Banana River's after ${LAGOON.bananaDays}. ` +
  `Water that sits keeps what runs into it. In 2011 an algae "superbloom" covered more than 130,000 acres and shaded out the seagrass; most of the lagoon's seagrass has died since, and with it the manatees' food. ` +
  `In 2021, 1,101 manatees died in Florida, a record, many of them starving here.`;

export const inletText = (cut: number | undefined) =>
  (cut
    ? `Dug through the barrier island in ${cut}, one of three inlets people made. `
    : "One of the lagoon's two natural inlets. ") +
  "Twice a day the tide pushes seawater in and draws lagoon water out, but only so far: the exchange fades within a few miles.";

export const HAULOVER_TEXT =
  "A cut across the north end of Merritt Island that joins Mosquito Lagoon to the Indian River; the Intracoastal Waterway runs through it. Wind and tide push water through it either way, and USGS counts east, toward Mosquito Lagoon, as positive.";

export const STREAM_TEXT: Record<Exclude<IrlKey, "HAUL">, string> = {
  EG: "The Eau Gallie River drains part of Melbourne. Its lower reach is tidal, lagoon water already.",
  CRANE: "Crane Creek drains downtown Melbourne into the lagoon.",
  TURKEY: "Turkey Creek drains Palm Bay. Its lower reach is tidal, lagoon water already.",
  SEBN: "The North Prong of the St. Sebastian River, which meets the lagoon near Sebastian Inlet.",
  FELL: "A canal draining the farmland around Fellsmere toward the St. Sebastian River and the lagoon.",
  SEBS: "The South Prong of the St. Sebastian River. Its lower reach is tidal, lagoon water already.",
  NCAN: "One of Vero Beach's drainage canals, dug to drain the flatwoods west of town for citrus groves and farms. It carries that runoff straight to the lagoon.",
  MCAN: "Vero Beach's Main Canal, dug to drain the flatwoods west of town for citrus groves and farms. It carries that runoff straight to the lagoon.",
  SCAN: "One of Vero Beach's drainage canals, dug to drain the flatwoods west of town for citrus groves and farms. It carries that runoff straight to the lagoon.",
};

export const CANAL_KEYS: IrlKey[] = ["FELL", "NCAN", "MCAN", "SCAN"];
