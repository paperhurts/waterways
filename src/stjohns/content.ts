// Hand-authored content for the St. Johns River map: views, towns, and card text. The
// facts are from the St. Johns River Water Management District, FDEP's St. Johns River
// Blueway guide, and NOAA's report on the river's currents.

import { bounds } from "../shared/geo";

export const VIEWS = {
  /** The headwater marshes to the Atlantic. */
  all: bounds(-81.8, 27.9, -80.6, 30.45),
  upper: bounds(-81.2, 27.9, -80.6, 28.8),
  middle: bounds(-81.75, 28.7, -81.15, 29.55),
  lower: bounds(-81.8, 29.5, -81.35, 30.45),
};

export const TOWNS: [name: string, lon: number, lat: number, east?: boolean][] = [
  ["Melbourne", -80.608, 28.084, true], ["Cocoa", -80.742, 28.386, true], ["Titusville", -80.808, 28.612, true], ["Sanford", -81.27, 28.8], ["DeLand", -81.303, 29.028, true],
  ["Astor", -81.53, 29.162], ["Palatka", -81.637, 29.648, true], ["Green Cove Springs", -81.678, 29.992], ["Jacksonville", -81.656, 30.332, true], ["Mayport", -81.41, 30.39, true],
];

export const FACTS = {
  miles: 310,
  fallFt: 30,
  tideMiles: 106,
};

export const RIVER_TEXT =
  `Florida's longest river, ${FACTS.miles} miles from the marshes west of Vero Beach to the Atlantic at Mayport, falling less than ${FACTS.fallFt} feet on the way: about an inch a mile. ` +
  "It runs north, slowly, widening into lakes (Harney, Monroe, George) and at its lower end into a tidal estuary miles wide.";

export const TIDE_TEXT =
  `The tide reaches ${FACTS.tideMiles} miles up the St. Johns, to Lake George. It pushes the river backward twice a day: upstream of Jacksonville, the flow can run south, toward the river's head, for hours at a time.`;

export const LAKE_GEORGE_TEXT =
  "Lake George, Florida's second-biggest lake. The river widens into it and slows almost to a stop; springs along its west shore, Silver Glen and Salt among them, feed it clear water.";

export const HEAD_TEXT =
  "The headwaters: a marsh, not a spring or a hill. Much of it was drained for farms and ranches; the St. Johns River Water Management District has restored large parts of it to marsh again.";
