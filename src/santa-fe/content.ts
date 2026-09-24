// Hand-authored content for the Santa Fe map: which reach each spring feeds,
// the sinks and dye traces worth explaining, and place labels.

import { bounds } from "../shared/geo";

/**
 * Reaches between gauges. A spring's flow is the gain measured across its
 * reach, split evenly among the mapped springs there.
 * r441: River Rise → US 441, rFW: US 441 → Fort White, rH: Fort White → Hildreth,
 * ich: Ichetucknee head springs → US 27, fan: Fanning (gauged directly).
 */
export type Reach = "r441" | "rFW" | "rH" | "ich" | "fan";

/** Names from the FDEP Florida Springs layer. */
export const SPRINGS: [name: string, lon: number, lat: number, reach: Reach][] = [
  ["Hornsby Spring", -82.5932, 29.8504, "r441"], ["Treehouse Spring", -82.6029, 29.8549, "r441"],
  ["Allen Spring", -82.646, 29.8273, "rFW"], ["Poe Spring", -82.649, 29.8257, "rFW"], ["Lilly Spring", -82.6612, 29.8297, "rFW"],
  ["Pickard Spring", -82.6621, 29.8305, "rFW"], ["Columbia Spring", -82.6567, 29.8312, "rFW"], ["Rum Island Spring", -82.6798, 29.8335, "rFW"],
  ["Gilchrist Blue Spring", -82.6829, 29.8299, "rFW"], ["Little Blue Spring", -82.6838, 29.8303, "rFW"], ["Ginnie Spring", -82.7001, 29.8363, "rFW"],
  ["Devil's Eye Spring", -82.6967, 29.8347, "rFW"], ["Devil's Ear Spring", -82.6966, 29.8353, "rFW"], ["July Spring", -82.6964, 29.8362, "rFW"],
  ["Twin Spring", -82.7059, 29.8405, "rFW"],
  ["Siphon Creek Rise", -82.7331, 29.8562, "rH"], ["Myrtles Fissure Spring", -82.734, 29.8579, "rH"], ["Columbia Spring (COL1012971)", -82.73, 29.8569, "rH"],
  ["Gilchrist Spring (GIL1012974)", -82.7401, 29.8645, "rH"],
  ["Ichetucknee Head Spring", -82.7619, 29.9842, "ich"], ["Blue Hole Spring", -82.7592, 29.9809, "ich"], ["Mission & Roaring Springs", -82.7579, 29.9762, "ich"],
  ["Mill Pond Springs", -82.76, 29.9664, "ich"], ["Devil's Eye Springs (Ichetucknee)", -82.7603, 29.9733, "ich"],
  ["Fanning Springs", -82.9353, 29.5876, "fan"],
];

export interface SinkSite {
  name: string;
  lon: number;
  lat: number;
  kind: string;
  text: string;
  /** Destination unproven; drawn with a "?". */
  q?: boolean;
}

export const SINKS: SinkSite[] = [
  { name: "Santa Fe River Sink", lon: -82.57295, lat: 29.91231, kind: "River swallet", text: "The whole river drops into the aquifer here, in O'Leno State Park, and runs underground for about three miles before surfacing again at River Rise." },
  { name: "Mill Creek Sink", lon: -82.50855, lat: 29.8017, kind: "Dye-traced sink", text: "A 2005 dye trace for Alachua County showed a direct connection to Hornsby Spring. Dye first appeared there after 12–13 days. The dotted line shows that path, not its exact route underground." },
  { name: "Lee Sink", lon: -82.47338, lat: 29.7743, kind: "Dye-traced sink", text: "The same 2005 study traced Lee Sink to Hornsby Spring in 28–31 days. Both sinks sit on the Cross-County Fracture Zone." },
  { name: "Devil's Millhopper", lon: -82.39445, lat: 29.70709, kind: "Sinkhole, on the fracture zone", text: "Streams trickle down the walls and vanish at the bottom. It lies on the same Cross-County Fracture Zone as Mill Creek Sink and Alachua Sink." },
  { name: "Haile Sink", lon: -82.41096, lat: 29.62878, kind: "Where Hogtown Creek ends", text: "Hogtown Creek drains most of west Gainesville, flows through Hogtown Prairie, and ends here, recharging the Floridan aquifer. Where it reappears hasn't been traced.", q: true },
  { name: "Alachua Sink", lon: -82.3055, lat: 29.6055, kind: "Paynes Prairie's drain", text: "Sweetwater Branch and Tumblin Creek end here. The popular claim that this water reaches the Santa Fe may trace back to an 1823 story, not a dye study. Its destination is unproven.", q: true },
];

/** Karst Environmental Services, Mill Creek and Lee Sinks Dye Trace (2005). */
export const TRACES: { from: string; to: [number, number]; days: string }[] = [
  { from: "Mill Creek Sink", to: [-82.5932, 29.8504], days: "12–13 days" },
  { from: "Lee Sink", to: [-82.5932, 29.8504], days: "28–31 days" },
];

export const TOWNS: [string, number, number][] = [
  ["Gainesville", -82.325, 29.665], ["High Springs", -82.585, 29.815], ["Fort White", -82.713, 29.905], ["Alachua", -82.47, 29.752],
];

export const VIEWS = {
  all: bounds(-82.98, 29.56, -82.3, 30.02),
  springs: bounds(-82.78, 29.8, -82.55, 29.94),
  gnv: bounds(-82.66, 29.58, -82.28, 29.95),
};

export const UNDERGROUND_TEXT =
  "The Santa Fe drops into River Sink in O'Leno State Park and resurfaces at River Rise about three miles away. NHD maps this stretch as an underground conduit.";
