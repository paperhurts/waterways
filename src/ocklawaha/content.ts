// Hand-authored content for the Ocklawaha River map: views, towns, and card text. The
// facts are from Florida State Parks and FDEP (the Rodman Reservoir drawdowns), the
// Corps of Engineers' history of the Cross Florida Barge Canal, the American Canal
// Society's record of the Eureka Lock and Dam, and reporting on the dam's politics
// (WUFT and Jacksonville Today, 2025; Florida Politics, 2026).

import { bounds } from "../shared/geo";
import type { OckStructure } from "../shared/types";

export const VIEWS = {
  /** Moss Bluff and Silver Springs down to the St. Johns. */
  all: bounds(-82.1, 29.05, -81.6, 29.6),
  upper: bounds(-82.08, 29.05, -81.84, 29.3),
  reservoir: bounds(-81.98, 29.35, -81.72, 29.57),
  mouth: bounds(-81.84, 29.44, -81.62, 29.6),
};

export const TOWNS: [name: string, lon: number, lat: number, east?: boolean][] = [
  ["Silver Springs", -82.03, 29.2, true], ["Ocklawaha", -81.93, 29.045, true], ["Fort McCoy", -81.96, 29.36], ["Orange Springs", -81.945, 29.507],
  ["Welaka", -81.672, 29.478, true], ["Palatka", -81.637, 29.648, true],
];

export const FACTS = {
  damBuilt: 1968,
  halted: 1971,
  reservoirAcres: 9500,
  reservoirMiles: 15,
  springs: 20,
  forestAcres: 7500,
  eurekaGapFt: 400,
  canalMiles: 107,
};

export const RIVER_TEXT =
  "The Ocklawaha runs free here, winding through cypress and gum swamp. It's fed by Lake Griffin upstream and by Silver Springs, whose clear water joins it through the Silver River.";

export const SILVER_TEXT =
  "The Silver River carries Silver Springs' water five miles to the Ocklawaha. The springs are among the biggest in Florida, and for most of a century their flow has been gauged here.";

export const RESERVOIR_TEXT =
  `Rodman Reservoir, which the USGS maps as Lake Ocklawaha. The Kirkpatrick Dam backs the river up for ${FACTS.reservoirMiles} miles over about ${FACTS.reservoirAcres.toLocaleString()} acres, drowning ${FACTS.forestAcres.toLocaleString()} acres of floodplain forest and about ${FACTS.springs} springs. ` +
  "Every few years the state draws it down to kill weeds, and the old river, its stumps, and some of its springs come back into the light for a few months.";

export const DROWNED_TEXT =
  "A spring the reservoir drowned. It still flows, under the water, and shows again when the reservoir is drawn down.";

export const CANAL_TEXT =
  `A cut of the Cross Florida Barge Canal, meant to carry barges ${FACTS.canalMiles} miles from the St. Johns to the Gulf. It leads from the reservoir to the St. Johns through Buckman Lock. About a third of the canal was dug before work stopped: this end, and the Gulf end at Inglis, on the Rainbow River map.`;

export const STRUCTURE_TEXT: Record<OckStructure["role"], string> = {
  dam: `Built in ${FACTS.damBuilt} across the Ocklawaha for the barge canal, and renamed in 1998 for State Senator George Kirkpatrick, its strongest defender. The canal was stopped in ${FACTS.halted}, but the dam still holds the river back. ` +
    "Taking it out has been argued over for decades: in 2025 the governor vetoed $6.25 million to plan its removal, and a 2026 bill to plan the river's restoration passed the House and then sank.",
  unfinished: `The Eureka Lock and Dam were built from 1966 to 1970, but the earthen dam was never closed. The river still runs through a ${FACTS.eurekaGapFt}-foot gap in it, past a lock that has never been used.`,
  lock: "The lock between the barge canal's cut and the St. Johns River, still worked for boats.",
};
