// Reading and writing the shared journal. Row-level security does the gating:
// a signed-in non-member simply gets empty results.

import type { MemberSpot, SpotKind } from "../shared/types";
import { supabase } from "./client";
import { preparePhoto } from "./photos";
import type { AnimalGroup } from "./wildlife";

export const PHOTO_BUCKET = "journal-photos";

export interface Member {
  email: string;
  display_name: string | null;
  added_at: string;
}

export interface Sighting {
  id: string;
  visit_id: string;
  species: string;
  animal_group: AnimalGroup;
  count: number | null;
  lat: number | null;
  lon: number | null;
  from_gps: boolean;
  seen_at: string;
  notes: string | null;
  created_by: string;
}

export interface Photo {
  id: string;
  visit_id: string;
  path: string;
  width: number | null;
  height: number | null;
  caption: string | null;
  created_by: string;
}

export interface Visit {
  id: string;
  spring_id: string;
  visited_on: string;
  rating: number | null;
  notes: string | null;
  created_by: string;
  created_by_email: string;
  created_at: string;
  sightings: Sighting[];
  photos: Photo[];
}

export interface Journal {
  members: Member[];
  visits: Visit[];
  /** Spots members added, besides the springs and the curated snorkel spots. */
  spots: MemberSpot[];
}

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

export async function loadJournal(): Promise<Journal> {
  const sb = supabase();
  const [members, visits, spots] = await Promise.all([
    sb.from("members").select("email, display_name, added_at").order("added_at"),
    sb.from("visits").select("*, sightings(*), photos(*)").order("visited_on", { ascending: false }).order("created_at", { ascending: false }),
    sb.from("spots").select("*").order("name"),
  ]);
  return { members: check(members) ?? [], visits: (check(visits) as Visit[]) ?? [], spots: (check(spots) as MemberSpot[]) ?? [] };
}

// ---------- summaries (pure) ----------

export interface SpringSummary {
  visits: number;
  /** Mean of rated visits, or null if none were rated. */
  rating: number | null;
  last: string;
  groups: Set<AnimalGroup>;
}

export function summarize(visits: Visit[]): Map<string, SpringSummary> {
  const out = new Map<string, SpringSummary>();
  const ratings = new Map<string, number[]>();
  for (const v of visits) {
    const s = out.get(v.spring_id) ?? { visits: 0, rating: null, last: v.visited_on, groups: new Set<AnimalGroup>() };
    s.visits++;
    if (v.visited_on > s.last) s.last = v.visited_on;
    for (const x of v.sightings) s.groups.add(x.animal_group);
    if (v.rating) ratings.set(v.spring_id, [...(ratings.get(v.spring_id) ?? []), v.rating]);
    out.set(v.spring_id, s);
  }
  for (const [id, rs] of ratings) out.get(id)!.rating = rs.reduce((a, b) => a + b, 0) / rs.length;
  return out;
}

// ---------- writing ----------

export interface SightingDraft {
  /** Set when editing an existing sighting. */
  id?: string;
  species: string;
  animal_group: AnimalGroup;
  count: number | null;
  lat: number | null;
  lon: number | null;
  from_gps: boolean;
  seen_at: string;
}

export interface VisitDraft {
  spring_id: string;
  visited_on: string;
  rating: number | null;
  notes: string;
  sightings: SightingDraft[];
  newPhotos: File[];
  removedPhotos: Photo[];
}

/** Create or update a visit with its sightings and photos. */
export async function saveVisit(draft: VisitDraft, existing: Visit | null, progress: (msg: string) => void = () => {}): Promise<void> {
  const sb = supabase();
  progress("Saving visit…");
  const row = { spring_id: draft.spring_id, visited_on: draft.visited_on, rating: draft.rating, notes: draft.notes.trim() || null };
  const visitId = existing
    ? (check(await sb.from("visits").update(row).eq("id", existing.id).select("id").single()) as { id: string }).id
    : (check(await sb.from("visits").insert(row).select("id").single()) as { id: string }).id;

  // Sightings: drop the removed ones, insert the new ones. Kept ones don't change.
  if (existing) {
    const kept = new Set(draft.sightings.map((s) => s.id).filter(Boolean));
    const gone = existing.sightings.filter((s) => !kept.has(s.id)).map((s) => s.id);
    if (gone.length) check(await sb.from("sightings").delete().in("id", gone));
  }
  const fresh = draft.sightings.filter((s) => !s.id).map(({ id: _id, ...s }) => ({ ...s, visit_id: visitId }));
  if (fresh.length) check(await sb.from("sightings").insert(fresh));

  for (const p of draft.removedPhotos) await deletePhoto(p);
  for (let i = 0; i < draft.newPhotos.length; i++) {
    progress(`Uploading photo ${i + 1} of ${draft.newPhotos.length}…`);
    const { blob, width, height } = await preparePhoto(draft.newPhotos[i]);
    const path = `${visitId}/${crypto.randomUUID()}.jpg`;
    const up = await sb.storage.from(PHOTO_BUCKET).upload(path, blob, { contentType: "image/jpeg", upsert: false });
    if (up.error) throw new Error(`Photo upload failed: ${up.error.message}`);
    const ins = await sb.from("photos").insert({ visit_id: visitId, path, width, height });
    if (ins.error) {
      // Don't leave an orphaned file behind if the row couldn't be written.
      await sb.storage.from(PHOTO_BUCKET).remove([path]);
      throw new Error(ins.error.message);
    }
  }
}

export async function deletePhoto(p: Photo): Promise<void> {
  const sb = supabase();
  const rm = await sb.storage.from(PHOTO_BUCKET).remove([p.path]);
  if (rm.error) throw new Error(rm.error.message);
  check(await sb.from("photos").delete().eq("id", p.id));
}

export async function deleteVisit(v: Visit): Promise<void> {
  const sb = supabase();
  if (v.photos.length) {
    const rm = await sb.storage.from(PHOTO_BUCKET).remove(v.photos.map((p) => p.path));
    if (rm.error) throw new Error(rm.error.message);
  }
  // Sightings and photo rows go with it (on delete cascade).
  check(await sb.from("visits").delete().eq("id", v.id));
}

/** Short-lived URLs for private photos. */
export async function photoUrls(paths: string[]): Promise<Map<string, string>> {
  if (!paths.length) return new Map();
  const res = await supabase().storage.from(PHOTO_BUCKET).createSignedUrls(paths, 3600);
  if (res.error) throw new Error(res.error.message);
  const out = new Map<string, string>();
  for (const d of res.data) if (d.path && d.signedUrl) out.set(d.path, d.signedUrl);
  return out;
}

export interface SpotDraft {
  name: string;
  kind: SpotKind;
  lat: number;
  lon: number;
  notes: string;
}

/** Add a spot, or change one of your own. Returns its id. */
export async function saveSpot(draft: SpotDraft, existing: MemberSpot | null): Promise<string> {
  const sb = supabase();
  const row = { name: draft.name.trim(), kind: draft.kind, lat: draft.lat, lon: draft.lon, notes: draft.notes.trim() || null };
  const res = existing ? await sb.from("spots").update(row).eq("id", existing.id).select("id").single() : await sb.from("spots").insert(row).select("id").single();
  return (check(res) as { id: string }).id;
}

export async function deleteSpot(id: string): Promise<void> {
  check(await supabase().from("spots").delete().eq("id", id));
}

export async function inviteMember(email: string, displayName: string): Promise<void> {
  check(await supabase().from("members").insert({ email: email.trim().toLowerCase(), display_name: displayName.trim() || null }));
}

export async function removeMember(email: string): Promise<void> {
  check(await supabase().from("members").delete().eq("email", email));
}
