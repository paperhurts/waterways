// Hand-authored content for the Apalachicola River map: views, cities, and card text.
// The facts are from the Supreme Court's opinion in Florida v. Georgia (April 1, 2021),
// FWC (the oyster closure and the 2026 reopening), the Corps of Engineers (its dams), and
// USGS records.

import { bounds } from "../shared/geo";
import type { ApRiver } from "../shared/types";

export const VIEWS = {
  /** Lake Lanier to Apalachicola Bay. */
  all: bounds(-85.45, 29.6, -83.8, 34.25),
  georgia: bounds(-85.35, 31.4, -83.8, 34.25),
  line: bounds(-85.3, 30.55, -84.4, 31.3),
  bay: bounds(-85.25, 29.6, -84.6, 30.3),
};

export const CITIES: [name: string, lon: number, lat: number, east?: boolean][] = [
  ["Atlanta", -84.39, 33.749, true], ["LaGrange", -85.031, 33.039], ["Columbus", -84.988, 32.461], ["Albany", -84.156, 31.578, true],
  ["Eufaula", -85.145, 31.891], ["Dothan", -85.39, 31.223], ["Bainbridge", -84.575, 30.904, true], ["Tallahassee", -84.28, 30.438, true],
  ["Marianna", -85.226, 30.775], ["Blountstown", -85.047, 30.444], ["Apalachicola", -84.983, 29.726, true],
];

export const FACTS = {
  courtYear: 2021,
  suedYear: 2013,
  collapse: "2012 and 2013",
  closed: 2020,
  reopened: "January 2026",
};

export const RIVER_TEXT: Record<ApRiver, string> = {
  "Chattahoochee River":
    "The Chattahoochee starts in the north Georgia mountains, fills Lake Lanier, and runs through Atlanta, which draws most of its water from the lake and the river. Below Atlanta it's the Georgia–Alabama line, held back behind the Corps of Engineers' dams at West Point and Eufaula.",
  "Flint River":
    "The Flint rises under Atlanta's airport and runs south through farm country. Southwest Georgia's farms irrigate from it and from the aquifer beneath it, most in the driest months, when the river is lowest.",
  "Apalachicola River":
    "Florida's biggest river by the water it carries. It starts at Jim Woodruff Dam, where the Chattahoochee and the Flint meet in Lake Seminole, and runs 106 miles through swamp forest to Apalachicola Bay. Its fresh water keeps the bay brackish, the way oysters need it.",
  "Chipola River":
    "The Chipola is fed by springs, Jackson Blue among them, and joins the Apalachicola in its lower swamp.",
};

export const OYSTER_TEXT =
  `Oyster beds in Apalachicola Bay, from FWC's statewide map. The bay's oysters were among Florida's most famous, until they collapsed in ${FACTS.collapse}. ` +
  `FWC closed the wild harvest in ${FACTS.closed} for five years, and reopened it in ${FACTS.reopened} with tight limits: only on reefs with enough legal oysters, and a tenth of them a year.`;

export const DAM_TEXT = (lake: string, built: number) =>
  `A Corps of Engineers dam, finished in ${built}, holding back ${lake}. The Corps runs the basin's dams together, balancing Atlanta's water supply, hydropower, barges, and the flow Florida gets downstream.`;

export const COURT_TEXT =
  `Florida sued Georgia in ${FACTS.suedYear}, saying Georgia's water use left too little for the river and the bay. In ${FACTS.courtYear} the Supreme Court ruled unanimously for Georgia: Florida hadn't proved that Georgia's use caused the oysters' collapse.`;
