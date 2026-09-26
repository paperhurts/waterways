// Hand-authored content for the Kissimmee River map: views, towns, and card text. The
// facts are from SFWMD, the Corps of Engineers (Jacksonville District), and reporting on
// the restoration's completion in July 2021 (NPR, Audubon Florida).

import { bounds } from "../shared/geo";
import type { KissClass, KissStructure } from "../shared/types";

export const VIEWS = {
  /** Lake Kissimmee down the river to Lake Okeechobee. */
  all: bounds(-81.36, 27.17, -80.84, 27.87),
  upper: bounds(-81.28, 27.55, -81.08, 27.85),
  restored: bounds(-81.2, 27.3, -81.0, 27.62),
  lower: bounds(-81.12, 27.18, -80.88, 27.42),
};

export const TOWNS: [name: string, lon: number, lat: number, east?: boolean][] = [
  ["Lake Wales", -81.586, 27.901], ["Frostproof", -81.53, 27.746], ["Sebring", -81.441, 27.496],
  ["Lorida", -81.24, 27.44], ["Basinger", -81.03, 27.39, true], ["Okeechobee", -80.83, 27.244, true], ["Yeehaw Junction", -80.904, 27.7, true],
];

export const HISTORY = {
  milesBefore: 103,
  canalMiles: 56,
  canalDepthFt: 30,
  canalWidthFt: 300,
  dug: [1962, 1971],
  filledMiles: 22,
  channelMiles: 44,
  wetlandAcres: 20000,
  floodplainSqMi: 40,
  done: 2021,
};

export const CLASS_TEXT: Record<KissClass, { title: string; body: string }> = {
  canal: {
    title: "C-38, still a canal",
    body:
      `The Corps of Engineers dug C-38 from ${HISTORY.dug[0]} to ${HISTORY.dug[1]}, ${HISTORY.canalDepthFt} feet deep and ${HISTORY.canalWidthFt} feet wide, straight where the river had wound. ` +
      "This stretch was left a canal: it still carries water fast to the next gate. The river's old bends lie beside it, cut off.",
  },
  river: {
    title: "The river, back in its bends",
    body:
      "Filling the canal here (the first stretch in 2001, more in 2010) sent the river back into the winding channel it had before the 1960s. " +
      "It runs slower, and in the wet season it spills over its floodplain again, the way it used to for months at a time.",
  },
  filled: {
    title: "Canal filled in 2021",
    body:
      "The restoration's last phase filled this stretch of C-38. The river runs in its old channel beside it now, and spreads across the floodplain in the wet season. " +
      "The USGS map this page is drawn from was last edited here in 2016, before the filling, so the dashed line is the canal that's gone, and the water spreading off it is the river finding its floodplain.",
  },
};

export const OLD_CHANNEL_TEXT =
  "The river's old channel. Where the canal is still open, these are the bends it cut off in the 1960s, holding still water. In the restored stretch, the river runs through them again.";

export const FLOODPLAIN_TEXT =
  "The river's floodplain marsh. With the canal, most of it dried out and turned to pasture. Since the restoration, the river spills over it again in the wet season, and wading birds and ducks have come back.";

export const ISTOKPOGA_TEXT =
  "Canal C-41A carries water from Lake Istokpoga, released at S-68, southeast to the Kissimmee just above S-65E.";

export const STRUCTURE_TEXT: Record<KissStructure["role"], string> = {
  outlet: "The gates at Lake Kissimmee's outlet, where the river starts. Two bays were added to it during the restoration, so more water can leave the lake in wet years.",
  pool: "A gate that splits the canal into pools, holding each at its own level on the way down to Lake Okeechobee.",
  removed: "The restoration demolished this structure in 2021, so its pool is river again. S-65B, upstream, went too.",
  mouth: "The last structure before Lake Okeechobee. The Kissimmee is the lake's biggest source of water, and this is where it's measured going in.",
  istokpoga: "Lake Istokpoga's outlet, into Canal C-41A and on to the Kissimmee.",
};
