// Hand-authored content for the Lake Okeechobee map: views, place labels, and the cards
// for things that aren't gauges. Numbers come from the data.

import { bounds } from "../shared/geo";

export const VIEWS = {
  /** The lake, the Caloosahatchee to Fort Myers, and the canals east and south. */
  all: bounds(-81.95, 26.3, -80.15, 27.45),
  lake: bounds(-81.25, 26.6, -80.55, 27.3),
  west: bounds(-81.95, 26.45, -81.0, 26.95),
};

export const TOWNS: [string, number, number][] = [
  ["Okeechobee", -80.829, 27.244], ["Clewiston", -80.934, 26.754], ["Moore Haven", -81.093, 26.833],
  ["Belle Glade", -80.668, 26.684], ["South Bay", -80.716, 26.664], ["Pahokee", -80.665, 26.82],
  ["LaBelle", -81.438, 26.762], ["Fort Myers", -81.872, 26.64], ["Port Mayaca", -80.611, 26.993],
  ["Lakeport", -81.125, 26.974], ["Stuart", -80.2528, 27.1975],
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
  lon: -80.83,
  lat: 26.95,
  text:
    "Florida's biggest lake, about 730 square miles and only about nine feet deep on average. Before the canals, it spilled over its south rim in wet years and spread through the sawgrass into the Everglades. " +
    "After hurricanes in 1926 and 1928 drowned thousands of people along its shore, the Herbert Hoover Dike was built to hold it in. The Army Corps of Engineers keeps its level on a schedule and releases water east, west, and south.",
};

export const KISSIMMEE_TEXT =
  "The Kissimmee River brings the lake more water than anything else, from central Florida's chain of lakes. In the 1960s it was dredged into a straight 56-mile canal. Since 1999 more than 40 miles of its old winding channel have been restored. " +
  "USGS stopped gauging it at the lake in 2004, so the map draws it without animating its flow.";

export const FISHEATING_TEXT = "The only one of the lake's big inflows that still runs free, with no dam or canal between its headwaters and the lake.";

export const CALOOSAHATCHEE_TEXT =
  "In 1881 Hamilton Disston's company began dredging a channel from the lake to the Caloosahatchee's headwaters, and the river has drained the lake ever since. It's a canal (C-43) from Moore Haven to LaBelle, then the river past Fort Myers to the Gulf. " +
  "Below the Franklin Lock (S-79) it meets the tide, and big releases freshen its estuary the way they do the St. Lucie's.";

export const SOUTH_TEXT =
  "The Miami, North New River, Hillsboro, and West Palm Beach canals were dug from 1906 to 1920 to drain the sawgrass south of the lake. The drained land became the Everglades Agricultural Area, about 700,000 acres, most of it sugarcane. " +
  "Water sent south now runs through treatment marshes that take out phosphorus before it reaches the Everglades.";

export const WPB_TEXT = "USGS stopped gauging this canal at the lake (S-352) in 2008, so the map draws it without animating its flow.";

export const BACKFLOW_TEXT =
  "Pump stations on the south shore can push farm runoff north into the lake. In the 1960s and '70s they often did, and the south canals ran backward for years at a time. The state has since curtailed it because of the fertilizer the water carried.";

export const ST_LUCIE_TEXT = "The lake's way east, to the St. Lucie River at Stuart.";
