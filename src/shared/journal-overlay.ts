// The journal on the public maps, for signed-in members only. Visitors without
// a session never load any of this: the check reads localStorage and stops.

import { hasStoredSession, journalUrl } from "../journal/session";
import type { CardContent } from "./card";
import { escapeHtml, loadData } from "./data";
import { project, type XY } from "./geo";
import type { SpringsFile, StatewideSpring } from "./types";

/** One journal visit, as its popup shows it. Notes, names, and species are member-entered: escape them. */
export interface OverlayVisit {
  date: string;
  who: string;
  rating: number | null;
  notes: string | null;
  saw: { species: string; count: number | null }[];
  photos: number;
}

export interface OverlaySighting {
  xy: XY;
  group: string;
  species: string;
  count: number | null;
  notes: string | null;
  date: string;
  who: string;
  springId: string;
  springName: string;
}

export interface JournalOverlay {
  /** Visited spring ids → visit count and mean rating. */
  visited: Map<string, { visits: number; rating: number | null }>;
  /** Visited spring ids → their visits, newest first. */
  visits: Map<string, OverlayVisit[]>;
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
    // Popups name people by their display name only, never their email.
    const names = new Map(members.map((m) => [m.email.toLowerCase(), m.display_name]));
    const who = (email: string) => names.get(email.toLowerCase()) || "A member";
    const sightings: OverlaySighting[] = [];
    const bySpring = new Map<string, OverlayVisit[]>();
    // loadJournal returns visits newest first, so each spring's list is too.
    for (const v of visits) {
      const s = byId.get(v.spring_id);
      const list = bySpring.get(v.spring_id) ?? [];
      list.push({ date: v.visited_on, who: who(v.created_by_email), rating: v.rating, notes: v.notes, saw: v.sightings.map((x) => ({ species: x.species, count: x.count })), photos: v.photos.length });
      bySpring.set(v.spring_id, list);
      for (const x of v.sightings) {
        const lon = x.from_gps && x.lon != null ? x.lon : s?.[3];
        const lat = x.from_gps && x.lat != null ? x.lat : s?.[4];
        if (lon == null || lat == null) continue;
        sightings.push({
          xy: project(lon, lat), group: x.animal_group, species: x.species, count: x.count, notes: x.notes,
          date: v.visited_on, who: who(v.created_by_email), springId: v.spring_id, springName: s?.[1] ?? "a spring",
        });
      }
    }
    return {
      visited: new Map([...summary].map(([id, s]) => [id, { visits: s.visits, rating: s.rating }])),
      visits: bySpring,
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

/** How many of a spring's visits its popup lists before "and N more". */
const VISITS_SHOWN = 3;
const NOTE_CHARS = 140;

const fmtDate = (iso: string) => new Date(`${iso}T12:00`).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
const clip = (t: string) => (t.length > NOTE_CHARS ? `${t.slice(0, NOTE_CHARS - 1).trimEnd()}…` : t);
const saw = (xs: { species: string; count: number | null }[]) => xs.map((x) => `${escapeHtml(x.species)}${x.count && x.count > 1 ? ` ×${x.count}` : ""}`).join(", ");

/** Card copy for a spring: its visits, newest first, and links to the journal. */
export function journalCardHtml(o: JournalOverlay, springId: string): string {
  const list = o.visits.get(springId) ?? [];
  const rows = list.slice(0, VISITS_SHOWN).map((v) => {
    const parts = [`<b>${fmtDate(v.date)}</b> · ${escapeHtml(v.who)}${v.rating ? ` · ${v.rating} ★` : ""}`];
    if (v.notes) parts.push(`“${escapeHtml(clip(v.notes))}”`);
    if (v.saw.length) parts.push(`Saw ${saw(v.saw)}.`);
    if (v.photos) parts.push(`${v.photos} photo${v.photos > 1 ? "s" : ""}.`);
    return `<span class="journal-visit">${parts.join(" ")}</span>`;
  });
  if (list.length > VISITS_SHOWN) rows.push(`<span class="journal-visit">And ${list.length - VISITS_SHOWN} more.</span>`);
  // springId is a slug (letters, digits, dashes), so it's safe in an href.
  const links = `<a href="${journalUrl(`#log=${springId}`)}">Log a visit</a>${list.length ? ` · <a href="${journalUrl(`#spring=${springId}`)}">All in the journal</a>` : ""}`;
  return `<span class="journal-line">${list.length ? "In the journal:" : ""}</span>${rows.join("")}<span class="journal-line">${links}</span>`;
}

/** The journal sighting drawn nearest a tap, if one is within `r` pixels. */
export function hitSighting(o: JournalOverlay, X: (x: number) => number, Y: (y: number) => number, x: number, y: number, r = 9): OverlaySighting | null {
  let best: OverlaySighting | null = null;
  let bd = r * r;
  for (const s of o.sightings) {
    const d = (X(s.xy[0]) - x) ** 2 + (Y(s.xy[1]) - y) ** 2;
    if (d < bd) {
      bd = d;
      best = s;
    }
  }
  return best;
}

/** Popup for one sighting: what, where, when, who, and their note. */
export function sightingCard(s: OverlaySighting): CardContent {
  const group = s.group.charAt(0).toUpperCase() + s.group.slice(1);
  return {
    title: `${s.species}${s.count && s.count > 1 ? ` ×${s.count}` : ""}`,
    kind: `${group} · ${s.springName}`,
    body:
      `Seen ${fmtDate(s.date)} by ${escapeHtml(s.who)}.${s.notes ? ` “${escapeHtml(clip(s.notes))}”` : ""}` +
      `<span class="journal-line"><a href="${journalUrl(`#spring=${s.springId}`)}">Open in the journal</a></span>`,
  };
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
