// Hand-authored content for the Rainbow River map: views, place labels, and the
// cards for things that aren't gauges or vents. Numbers come from the data.

import { bounds } from "../shared/geo";

export const VIEWS = {
  /** The springshed and the river to the Gulf. */
  all: bounds(-82.8, 28.92, -82.05, 29.7),
  river: bounds(-82.8, 28.93, -82.25, 29.13),
  springs: bounds(-82.46, 29.064, -82.41, 29.108),
};

export const TOWNS: [string, number, number][] = [
  ["Dunnellon", -82.461, 29.049], ["Inglis", -82.669, 29.03], ["Yankeetown", -82.717, 29.03],
  ["Ocala", -82.14, 29.187], ["Williston", -82.447, 29.387], ["Morriston", -82.444, 29.279], ["Holder", -82.335, 28.975],
];

export const LAKE_ROUSSEAU = {
  name: "Lake Rousseau",
  lon: -82.555,
  lat: 29.02,
  kind: "Reservoir",
  text: "The Withlacoochee and the Rainbow spread into this reservoir behind Inglis Dam. At its west end the water leaves two ways: through the bypass spillway down the river's old channel, or through the dam into the Cross Florida Barge Canal, a canal that was never finished. Both reach the Gulf near Yankeetown.",
};

export const CANAL_TEXT =
  "Lake Rousseau's dam releases run down this unfinished barge canal to the Gulf. The canal was begun in the 1960s to cross the peninsula and stopped in 1971; the route is now the Cross Florida Greenway.";

export const springshedText = (km2: number) =>
  `Rain that soaks into the ground anywhere in this ${Math.round(km2 / 2.59).toLocaleString()} square miles can end up at Rainbow Springs. It takes years to decades underground. ` +
  "The Southwest Florida Water Management District drew this outline from USGS maps of the aquifer in 1994. Springsheds shift as water levels change, so treat the edge as approximate. The moving dots show that connection, not the water's route underground.";

export const focusText = (km2: number) =>
  `FDEP's priority focus area for Rainbow Springs, about ${Math.round(km2 / 2.59)} square miles. It's the part of the springshed where the aquifer is most vulnerable and what soaks in reaches the springs fastest, and where Florida's springs law focuses its protections.`;

export const US41_NOTE =
  " This gauge sits in Lake Rousseau's backwater, so its readings swing with the dam. Over a year it matches the Withlacoochee from Holder plus the Rainbow; the map uses those two instead.";
