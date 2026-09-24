// Wildlife groups (map layers) and the species offered as quick-tap chips.
//
// Colors are the validated categorical palette from the dataviz reference, in
// its fixed slot order; legend order follows the slots so adjacent swatches
// stay distinguishable under color-vision deficiency. "Other" is neutral gray
// rather than a ninth hue. Group ids must match the check constraint on
// sightings.animal_group (tests/journal.test.ts enforces that).

export type AnimalGroup = "manatees" | "otters" | "turtles" | "fish" | "birds" | "alligators" | "mammals" | "snakes" | "other";

export interface GroupDef {
  id: AnimalGroup;
  label: string;
  light: string;
  dark: string;
}

export const GROUPS: GroupDef[] = [
  { id: "manatees", label: "Manatees", light: "#2a78d6", dark: "#3987e5" },
  { id: "otters", label: "Otters", light: "#eb6834", dark: "#d95926" },
  { id: "turtles", label: "Turtles", light: "#1baf7a", dark: "#199e70" },
  { id: "fish", label: "Fish", light: "#eda100", dark: "#c98500" },
  { id: "birds", label: "Birds", light: "#e87ba4", dark: "#d55181" },
  { id: "alligators", label: "Alligators", light: "#008300", dark: "#008300" },
  { id: "mammals", label: "Other mammals", light: "#4a3aa7", dark: "#9085e9" },
  { id: "snakes", label: "Snakes", light: "#e34948", dark: "#e66767" },
  { id: "other", label: "Other", light: "#8b8577", dark: "#8c8577" },
];

export const groupDef = (id: string): GroupDef => GROUPS.find((g) => g.id === id) ?? GROUPS[GROUPS.length - 1];
export const groupColor = (id: string, dark: boolean): string => (dark ? groupDef(id).dark : groupDef(id).light);

/** Common at north and central Florida springs. Anything else goes in "Other". */
export const SPECIES: { name: string; group: AnimalGroup }[] = [
  { name: "Manatee", group: "manatees" },
  { name: "River otter", group: "otters" },
  { name: "River cooter", group: "turtles" },
  { name: "Softshell turtle", group: "turtles" },
  { name: "Snapping turtle", group: "turtles" },
  { name: "Musk turtle", group: "turtles" },
  { name: "Gar", group: "fish" },
  { name: "Mullet", group: "fish" },
  { name: "Largemouth bass", group: "fish" },
  { name: "Bream", group: "fish" },
  { name: "Catfish", group: "fish" },
  { name: "Great blue heron", group: "birds" },
  { name: "Great egret", group: "birds" },
  { name: "Anhinga", group: "birds" },
  { name: "Osprey", group: "birds" },
  { name: "Limpkin", group: "birds" },
  { name: "Kingfisher", group: "birds" },
  { name: "Wood duck", group: "birds" },
  { name: "Bald eagle", group: "birds" },
  { name: "Alligator", group: "alligators" },
  { name: "White-tailed deer", group: "mammals" },
  { name: "Raccoon", group: "mammals" },
  { name: "Wild hog", group: "mammals" },
  { name: "Armadillo", group: "mammals" },
  { name: "Water snake", group: "snakes" },
  { name: "Cottonmouth", group: "snakes" },
];

export const speciesGroup = (name: string): AnimalGroup => SPECIES.find((s) => s.name === name)?.group ?? "other";
