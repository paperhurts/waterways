// The journal on the public maps, for signed-in members only. Visitors without
// a session never load any of this: the check reads localStorage and stops.

import { hasStoredSession, journalUrl } from "../journal/session";
import { loadData } from "./data";
import { project, type XY } from "./geo";
import type { SpringsFile, StatewideSpring } from "./types";

export interface OverlaySighting {
  xy: XY;
  group: string;
  species: string;
}

export interface JournalOverlay {
  /** Visited spring ids → visit count and mean rating. */
  visited: Map<string, { visits: number; rating: number | null }>;
  sightings: OverlaySighting[];
  color: (group: string, dark: boolean) => string;
  /** Statewide spring nearest to a point (within ~300 m), for maps whose springs have no id. */
  nearestSpring: (lon: number, lat: number) => StatewideSpring | null;
}

export async function loadJournalOverlay(): Promise<JournalOverlay | null> {
  if (!hasStoredSession()) return null;
  try {
    const [{ loadJournal, summarize }, { groupColor }, springs] = await Promise.all([
      import("../journal/api"),
      import("../journal/wildlife"),
      loadData<SpringsFile>("springs.json"),
    ]);
    const { members, visits } = await loadJournal();
    if (!members.length) return null;
    const byId = new Map(springs.springs.map((s) => [s[0], s]));
    const summary = summarize(visits);
    const sightings: OverlaySighting[] = [];
    for (const v of visits) {
      const s = byId.get(v.spring_id);
      for (const x of v.sightings) {
        const lon = x.from_gps && x.lon != null ? x.lon : s?.[3];
        const lat = x.from_gps && x.lat != null ? x.lat : s?.[4];
        if (lon != null && lat != null) sightings.push({ xy: project(lon, lat), group: x.animal_group, species: x.species });
      }
    }
    return {
      visited: new Map([...summary].map(([id, s]) => [id, { visits: s.visits, rating: s.rating }])),
      sightings,
      color: groupColor,
      nearestSpring: (lon, lat) => {
        let best: StatewideSpring | null = null;
        let bd = 0.003 ** 2;
        for (const s of springs.springs) {
          const d = (s[3] - lon) ** 2 + (s[4] - lat) ** 2;
          if (d < bd) {
            bd = d;
            best = s;
          }
        }
        return best;
      },
    };
  } catch (err) {
    console.warn("Journal layer unavailable:", err);
    return null;
  }
}

/** Card copy for a spring: its journal record and a link to log a visit. */
export function journalCardHtml(o: JournalOverlay, springId: string): string {
  const v = o.visited.get(springId);
  const record = v ? `In the journal: ${v.visits} visit${v.visits > 1 ? "s" : ""}${v.rating ? `, ${v.rating.toFixed(1)} ★` : ""}. ` : "";
  // springId is a slug (letters, digits, dashes), so it's safe in an href.
  return `<span class="journal-line">${record}<a href="${journalUrl(`#log=${springId}`)}">Log a visit</a> · <a href="${journalUrl(`#spring=${springId}`)}">Journal</a></span>`;
}

export function drawJournal(
  c: CanvasRenderingContext2D,
  o: JournalOverlay,
  X: (x: number) => number,
  Y: (y: number) => number,
  visitedSprings: { xy: XY; id: string }[],
  ink: string,
  dark: boolean,
): void {
  c.save();
  c.lineWidth = 1.5;
  c.strokeStyle = ink;
  for (const s of visitedSprings) {
    if (!o.visited.has(s.id)) continue;
    c.beginPath();
    c.arc(X(s.xy[0]), Y(s.xy[1]), 8, 0, 7);
    c.stroke();
  }
  for (const x of o.sightings) {
    c.beginPath();
    c.arc(X(x.xy[0]), Y(x.xy[1]), 4, 0, 7);
    c.fillStyle = o.color(x.group, dark);
    c.fill();
    c.lineWidth = 1.2;
    c.stroke();
  }
  c.restore();
}
