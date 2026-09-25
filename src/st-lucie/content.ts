// Hand-authored content for the St. Lucie map: views, place labels, and the cards for
// things that aren't gauges. Numbers come from the data.

import { bounds } from "../shared/geo";

export const VIEWS = {
  /** Lake Okeechobee's shore at Port Mayaca to the St. Lucie Inlet. */
  all: bounds(-80.72, 26.93, -80.1, 27.4),
  canal: bounds(-80.7, 26.94, -80.26, 27.14),
  estuary: bounds(-80.36, 27.1, -80.13, 27.3),
};

/** Towns, labeled just right of these points. Port Mayaca sits a little north of its gauge so the two don't overlap. */
export const TOWNS: [string, number, number][] = [
  ["Stuart", -80.2528, 27.1975], ["Palm City", -80.2662, 27.1678], ["Port St. Lucie", -80.3582, 27.2939],
  ["Jensen Beach", -80.2298, 27.2545], ["Sewall's Point", -80.2020, 27.1995], ["Hobe Sound", -80.1364, 27.0595],
  ["Indiantown", -80.4856, 27.0272], ["Port Mayaca", -80.611, 26.993],
];

export interface Place {
  name: string;
  kind: string;
  lon: number;
  lat: number;
  text: string;
}

export const LAKE: Place = {
  name: "Lake Okeechobee",
  kind: "Lake",
  lon: -80.69,
  lat: 26.97,
  text:
    "Florida's biggest lake, about 730 square miles, held in by the Herbert Hoover Dike. Before the canals, it spilled south over its rim into the Everglades. " +
    "Now the Army Corps of Engineers keeps its level on a schedule. When the lake runs high, the Corps releases water east down the St. Lucie Canal, west down the Caloosahatchee, and south toward the Everglades.",
};

export const INLET: Place = {
  name: "St. Lucie Inlet",
  kind: "Inlet",
  lon: -80.155,
  lat: 27.166,
  text:
    "Settlers dug this cut through the barrier island by hand in 1892. Twice a day the tide pushes seawater in through it, up the estuary and into the Indian River Lagoon, which runs 156 miles up the coast behind the barrier islands.",
};

export const canalText = (miles: number) =>
  `The St. Lucie Canal (C-44) was dug from 1916 to 1924 to drain floodwater off Lake Okeechobee and the farmland around it. It tied the St. Lucie River to a lake it had never drained. ` +
  `Along its ${miles} miles, farm ditches and creeks run into it too, so the water it sends to the estuary is the lake's plus the canal's own runoff.`;

export const NORTH_FORK_TEXT =
  "The North Fork drains Port St. Lucie and, through the C-23 and C-24 canals, the farmland and pasture to the west. USGS doesn't gauge it (the South Florida Water Management District meters its canals), so the map draws its channel without animating its flow. Its water is in the salinity readings downstream.";

export const SOUTH_FORK_TEXT =
  "Below the St. Lucie Lock, the canal's water joins the South Fork, which winds north past Palm City to meet the North Fork at Stuart.";

export const C23_TEXT =
  "C-23 drains pasture and groves west of Port St. Lucie into the North Fork. NHD calls it the County Line Canal: it runs along the line between Martin and St. Lucie counties.";

export const ESTUARY_TEXT =
  "Below Stuart the river widens into an estuary, where fresh water from the forks meets salt water from the inlet. Oysters and seagrass need that mix to stay brackish. " +
  "Big lake releases can keep the estuary nearly fresh for weeks. In 2016 and 2018 they also carried toxic blue-green algae from the lake into it, and both summers Florida declared a state of emergency.";

export const LAGOON_TEXT =
  "The Indian River Lagoon runs behind the barrier islands for 156 miles. Its south end shares the St. Lucie Inlet with the estuary, so fresh water from big releases spreads into the lagoon too.";

export const SALINITY_NOTE =
  "Seawater is about 35 parts per thousand. River water is fresh and lighter, so it spreads out over the salt water, and the surface reads fresher than the bottom. Oysters live on the bottom.";
