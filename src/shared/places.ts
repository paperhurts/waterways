// Every place the journal logs visits at, in the springs list's tuple shape so one
// lookup serves them all: FDEP's springs (springs.json), the curated snorkel spots
// (config/snorkel.json), and the spots members add (the journal's spots table, which
// only signed-in members can read).

import { KIND_LABEL, SALT_KINDS, snorkelSprings, snorkelSpots } from "./snorkel";
import type { MemberSpot, SpotKind, StatewideSpring } from "./types";

const tuple = (id: string, name: string, county: string, lon: number, lat: number): StatewideSpring => [id, name, county, lon, lat, 0, 0, ""];

export function allPlaces(springs: StatewideSpring[], members: MemberSpot[] = []): StatewideSpring[] {
  return [...springs, ...snorkelSpots.map((s) => tuple(s.id, s.name, s.county, s.lon, s.lat)), ...members.map((s) => tuple(s.id, s.name, "", s.lon, s.lat))];
}

export interface PlaceInfo {
  /** An FDEP spring (maybe one of the snorkel springs). */
  spring: boolean;
  /** On the snorkel list: a snorkel spring, a curated spot, or a member's spot. */
  snorkel: boolean;
  kind: SpotKind | null;
  /** Its label for the kind of place, or null for a spring (labeled by magnitude). */
  label: string | null;
  /** Salt water: the journal offers ocean animals to log there. */
  salt: boolean;
  member: MemberSpot | null;
}

const curated = new Map(snorkelSpots.map((s) => [s.id, s]));

export function placeInfo(id: string, members: MemberSpot[] = []): PlaceInfo {
  const spot = curated.get(id);
  const member = spot ? null : (members.find((m) => m.id === id) ?? null);
  const kind = spot?.kind ?? member?.kind ?? null;
  return {
    spring: !kind,
    snorkel: !!kind || snorkelSprings.has(id),
    kind,
    label: kind ? KIND_LABEL[kind] : null,
    salt: !!kind && SALT_KINDS.has(kind),
    member,
  };
}
