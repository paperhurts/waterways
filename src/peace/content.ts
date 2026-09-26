// Hand-authored content for the Peace River map: views, towns, and card text. The facts
// are from the USGS (the upper Peace's streamflow losses to sinks), FDEP (mandatory
// phosphate reclamation), SWFWMD, and the history of Kissengen Spring (the Polk County
// Water Atlas; People for Protecting Peace River).

import { bounds } from "../shared/geo";

export const VIEWS = {
  /** Lake Hancock and Bartow down to Charlotte Harbor. */
  all: bounds(-82.22, 26.9, -81.6, 28.1),
  upper: bounds(-81.93, 27.72, -81.7, 27.97),
  mines: bounds(-82.12, 27.5, -81.7, 27.95),
  harbor: bounds(-82.2, 26.9, -81.8, 27.25),
};

export const TOWNS: [name: string, lon: number, lat: number, east?: boolean][] = [
  ["Lakeland", -81.95, 28.04], ["Bartow", -81.843, 27.896], ["Fort Meade", -81.8, 27.752, true], ["Bowling Green", -81.824, 27.638], ["Wauchula", -81.812, 27.547, true],
  ["Zolfo Springs", -81.797, 27.493], ["Arcadia", -81.859, 27.216, true], ["Punta Gorda", -82.045, 26.929, true], ["Port Charlotte", -82.09, 26.976],
];

export const KISSENGEN = {
  mgd: 20,
  dry: 1950,
};

export const KISSENGEN_TEXT =
  `Kissengen Spring once poured about ${KISSENGEN.mgd} million gallons of water a day into the Peace, and people swam in its pool. ` +
  `In ${KISSENGEN.dry} it went dry, the first big spring in Florida lost to pumping: wells for the phosphate mines and farms nearby had drawn the aquifer down below it.`;

export const SINK_TEXT =
  "A sink in the riverbed. The aquifer used to push water up into the upper Peace; since it was drawn down, the river leaks down into it instead, and in dry spells this stretch can run dry.";

export const MINE_TEXT = (km2: number) =>
  `Land mined for phosphate. Draglines strip the ground down to the phosphate rock for fertilizer, and since 1975 the state has required the land to be reclaimed. FDEP's map shows about ${Math.round((km2 * 247.105) / 1000) * 1000} acres mined here under that rule.`;

export const AQUIFER_TEXT = (now: number, dry: number, months: { now: string; dry: string }) =>
  now < 2
    ? "Here the aquifer is about where it was before the wells."
    : `Here the Upper Floridan aquifer is about <b>${now} feet</b> lower than before development (${months.now}), and ${dry} feet lower in the dry season (${months.dry}).`;

export const RIVER_TEXT =
  "The Peace runs 106 miles from Lake Hancock, near Bartow, to Charlotte Harbor. Its upper reach loses water into sinks, and the mines' clay settling ponds line it downstream.";
