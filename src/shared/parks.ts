// Links to the state parks map from anything that names a park (springs.json's `park`).

import { escapeHtml } from "./data";

/** A park's id in the parks map's URL: its name, lowercased, in dashes. */
export const parkSlug = (name: string): string =>
  name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export const parkHref = (name: string): string => `parks.html#${parkSlug(name)}`;

/** "In <a>Park Name</a>." for a spring's card, or "" when it isn't in a park. */
export const parkLine = (name: string): string => (name ? `In <a href="${parkHref(name)}">${escapeHtml(name)}</a>. ` : "");
