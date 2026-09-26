import "./journal.css";
import "../shared/nav";
import type { Session } from "@supabase/supabase-js";
import { loadData } from "../shared/data";
import { parkHref } from "../shared/parks";
import { isDark, onColorSchemeChange } from "../shared/theme";
import { allPlaces, placeInfo } from "../shared/places";
import { KIND_LABEL } from "../shared/snorkel";
import type { MemberSpot, SpotKind, SpringsFile, StatewideSpring } from "../shared/types";
import { deleteSpot, deleteVisit, inviteMember, loadJournal, photoUrls, removeMember, saveSpot, saveVisit, summarize, type Journal, type Photo, type SightingDraft, type SpringSummary, type Visit } from "./api";
import { supabase } from "./client";
import { $, h } from "./dom";
import type { JournalMap, LayerId } from "./sightings-map";
import { parseWhere } from "./where";
import { GROUPS, SEA_SPECIES, SPECIES, groupColor, groupDef, speciesGroup, type AnimalGroup } from "./wildlife";

const MAG_LABEL = ["", "First magnitude", "Second magnitude", "Third magnitude", "Fourth magnitude", "Fifth magnitude", "Sixth magnitude", "Seventh magnitude", "Eighth magnitude"];
const PENDING_KEY = "waterways.journal.pending";
const DRAFT_KEY = "waterways.journal.draft";
const GPS_KEY = "waterways.journal.gps";
const BASEMAP_KEY = "waterways.journal.basemap";

const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string | null) => {
    try {
      if (v == null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch {
      /* private mode: drafts just won't persist */
    }
  },
};

const formatDate = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const stars = (n: number) => "★".repeat(Math.round(n)) + "☆".repeat(5 - Math.round(n));
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const km = (a: [number, number], b: [number, number]) => {
  const k = Math.cos(((a[1] + b[1]) / 2) * (Math.PI / 180));
  return Math.hypot((a[0] - b[0]) * 111.32 * k, (a[1] - b[1]) * 110.54);
};

// ---------- state ----------
/** FDEP's springs, from springs.json. */
let fdep: StatewideSpring[] = [];
/** Every place visits can be logged at: the springs, the curated snorkel spots, and members' spots. */
let springs: StatewideSpring[] = [];
/** Refilled in place, never replaced: the map holds on to it. */
const byId = new Map<string, StatewideSpring>();
let session: Session | null = null;
let journal: Journal = { members: [], visits: [], spots: [] };
let summary = new Map<string, SpringSummary>();
let filter: "all" | "snorkel" | "visited" | "todo" = "all";
let here: [number, number] | null = null;
let map: JournalMap | null = null;

/** Dev-only: journal.html?demo shows sample data and saves nothing. */
const demo = import.meta.env.DEV && new URLSearchParams(location.search).has("demo");

const nameOf = (email: string) => journal.members.find((m) => m.email === email)?.display_name || email.split("@")[0];
const myId = () => session?.user.id;
const info = (id: string) => placeInfo(id, journal.spots);

/** Rebuild the place list: members' spots come and go with the journal. */
function setPlaces() {
  springs = allPlaces(fdep, journal.spots);
  byId.clear();
  for (const s of springs) byId.set(s[0], s);
  dupes = new Set();
  const seen = new Set<string>();
  for (const s of springs) {
    const k = `${s[1]}|${s[2]}`;
    if (seen.has(k)) dupes.add(k);
    seen.add(k);
  }
}

// ---------- boot & auth ----------
async function main() {
  const file = await loadData<SpringsFile>("springs.json");
  fdep = file.springs;
  setPlaces();
  if (demo) {
    const { DEMO_JOURNAL, DEMO_EMAIL } = await import("./demo");
    journal = structuredClone(DEMO_JOURNAL);
    session = { user: { id: "demo-a", email: DEMO_EMAIL } } as Session;
    $("boot").hidden = true;
    renderWho();
    $("app").hidden = false;
    refresh();
    return;
  }
  const sb = supabase();
  // Remember a deep link (from a map's spring card) across the sign-in email round trip.
  if (location.hash.startsWith("#log=") || location.hash.startsWith("#spring=")) store.set(PENDING_KEY, location.hash);
  sb.auth.onAuthStateChange((event, s) => {
    if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "INITIAL_SESSION") void route(s);
  });
}

async function route(s: Session | null) {
  session = s;
  $("boot").hidden = true;
  renderWho();
  if (!s) {
    $("app").hidden = true;
    $("gate").hidden = false;
    return;
  }
  $("gate").hidden = true;
  try {
    journal = await loadJournal();
  } catch (err) {
    $("gate").hidden = false;
    $("gateMsg").textContent = `Couldn't load the journal: ${(err as Error).message}`;
    return;
  }
  if (!journal.members.length) {
    $("app").hidden = true;
    $("gate").hidden = false;
    $("signin").hidden = true;
    $("gateMsg").textContent = `You're signed in as ${s.user.email}, but that email isn't on this journal's list. Ask someone on it to add you under People.`;
    return;
  }
  $("app").hidden = false;
  refresh();
  const pending = location.hash.startsWith("#log=") || location.hash.startsWith("#spring=") ? location.hash : store.get(PENDING_KEY);
  store.set(PENDING_KEY, null);
  if (pending) {
    history.replaceState(null, "", location.pathname);
    const [kind, id] = pending.slice(1).split("=");
    if (byId.has(id)) kind === "log" ? openVisitForm(id, null) : openSpring(id);
  }
}

function renderWho() {
  const who = $("who");
  who.replaceChildren();
  if (!session) return;
  who.append(
    h("span", { class: "muted" }, session.user.email ?? ""),
    h("button", { type: "button", class: "linkish", onclick: () => void supabase().auth.signOut() }, "Sign out"),
  );
}

$("signin").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = ($("email") as HTMLInputElement).value.trim();
  const msg = $("gateMsg");
  msg.textContent = "Sending…";
  const { error } = await supabase().auth.signInWithOtp({ email, options: { emailRedirectTo: new URL("journal.html", document.baseURI).href } });
  msg.textContent = error ? `That didn't send: ${error.message}` : `Check ${email} for a sign-in link. Open it on this device.`;
});

async function reload() {
  if (!demo) journal = await loadJournal();
  refresh();
}

function refresh() {
  setPlaces();
  summary = summarize(journal.visits);
  $("nVisited").textContent = String(summary.size);
  renderList();
  renderPeople();
  if (map) {
    map.setData(journal.visits, summary);
    renderLayers();
  }
}

// ---------- tabs ----------
for (const tab of ["springs", "map", "people"]) {
  $(`tab-${tab}`).addEventListener("click", () => showTab(tab));
}
async function showTab(tab: string) {
  for (const t of ["springs", "map", "people"]) {
    $(`tab-${t}`).setAttribute("aria-selected", String(t === tab));
    $(`pane-${t}`).hidden = t !== tab;
  }
  if (tab === "map") {
    if (!map) {
      const { JournalMap } = await import("./sightings-map");
      const saved = store.get(BASEMAP_KEY);
      map = new JournalMap($("jmap"), byId, (id) => !info(id).spring, openSpring, isDark(), saved === "imagery" || saved === "topo" ? saved : isDark() ? "imagery" : "topo");
      map.setData(journal.visits, summary);
      map.fitData();
      renderLayers();
    }
    map.resize();
  }
}

// ---------- springs list ----------
$("q").addEventListener("input", renderList);
for (const b of document.querySelectorAll<HTMLButtonElement>(".seg button")) {
  b.addEventListener("click", () => {
    filter = b.dataset.f as typeof filter;
    for (const o of document.querySelectorAll<HTMLButtonElement>(".seg button")) o.setAttribute("aria-pressed", String(o === b));
    renderList();
  });
}
$("nearMe").addEventListener("click", () => {
  const btn = $("nearMe");
  if (here) {
    here = null;
    btn.setAttribute("aria-pressed", "false");
    renderList();
    return;
  }
  $("listMsg").textContent = "Finding you…";
  navigator.geolocation.getCurrentPosition(
    (p) => {
      here = [p.coords.longitude, p.coords.latitude];
      btn.setAttribute("aria-pressed", "true");
      $("listMsg").textContent = "";
      renderList();
    },
    (err) => ($("listMsg").textContent = `Couldn't get your location: ${err.message}`),
    { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 },
  );
});

function renderList() {
  const q = fold(($("q") as HTMLInputElement).value.trim());
  let rows = springs.filter((s) => {
    const seen = summary.has(s[0]);
    if (filter === "snorkel" && !info(s[0]).snorkel) return false;
    if (filter === "visited" && !seen) return false;
    if (filter === "todo" && seen) return false;
    return !q || fold(s[1]).includes(q) || fold(s[2]).includes(q);
  });
  if (here) rows.sort((a, b) => km(here!, [a[3], a[4]]) - km(here!, [b[3], b[4]]));
  else if (q) rows.sort((a, b) => Number(!fold(a[1]).startsWith(q)) - Number(!fold(b[1]).startsWith(q)) || a[1].localeCompare(b[1]));
  else rows.sort((a, b) => (summary.get(b[0])?.last ?? "").localeCompare(summary.get(a[0])?.last ?? "") || a[1].localeCompare(b[1]));
  const shown = rows.slice(0, 150);
  $("listMsg").textContent = !rows.length ? (filter === "visited" ? "No visits logged yet. Find a place and log one." : "Nothing matches that.") : rows.length > shown.length ? `Showing ${shown.length} of ${rows.length}. Search to narrow it down.` : "";
  $("list").replaceChildren(...shown.map(springRow));
}

/** Same name in the same county (FDEP reuses generic names): show where each one is. */
let dupes = new Set<string>();
const coords = (s: StatewideSpring) => `${s[4].toFixed(3)}° N, ${Math.abs(s[3]).toFixed(3)}° W`;

/** What kind of place, for its list row and sheet: a spring's magnitude, or a spot's kind and who added it. */
function kindBits(s: StatewideSpring): string[] {
  const p = info(s[0]);
  if (p.member) return [p.label ?? "", `added by ${memberName(p.member)}`];
  if (!p.spring) return ["Snorkel spot", (p.label ?? "").toLowerCase()];
  return [MAG_LABEL[s[5]], p.snorkel ? "good snorkeling" : ""];
}
const memberName = (m: MemberSpot) => (m.created_by === myId() ? "you" : nameOf(m.created_by_email));

function springRow(s: StatewideSpring) {
  const sum = summary.get(s[0]);
  const bits = [s[2] ? `${s[2]} County` : "", dupes.has(`${s[1]}|${s[2]}`) ? coords(s) : "", ...kindBits(s)];
  if (here) {
    const d = km(here, [s[3], s[4]]) * 0.621;
    bits.unshift(`${d < 10 ? d.toFixed(1) : Math.round(d)} mi`);
  }
  return h(
    "li",
    {},
    h(
      "button",
      { type: "button", class: `row-btn${sum ? " seen" : ""}${info(s[0]).spring ? "" : " spot"}`, onclick: () => openSpring(s[0]) },
      h("span", { class: "name" }, s[1]),
      h("span", { class: "meta" }, bits.filter(Boolean).join(" · ")),
      sum
        ? h(
            "span",
            { class: "stat" },
            sum.rating ? h("span", { class: "stars", "aria-label": `${sum.rating.toFixed(1)} of 5` }, stars(sum.rating)) : null,
            ` ${sum.visits} visit${sum.visits > 1 ? "s" : ""}, last ${formatDate(sum.last)}`,
            ...[...sum.groups].map((g) => h("i", { class: "dot", style: `background:${groupColor(g, isDark())}`, title: groupDef(g).label })),
          )
        : null,
    ),
  );
}

// ---------- spring detail ----------
function openSpring(id: string) {
  const s = byId.get(id);
  if (!s) return;
  const sum = summary.get(id);
  $("springTitle").textContent = s[1];
  $("springMeta").textContent = [s[2] ? `${s[2]} County` : "", dupes.has(`${s[1]}|${s[2]}`) ? coords(s) : "", s[7], ...kindBits(s), sum ? `${sum.visits} visit${sum.visits > 1 ? "s" : ""}` : "Not visited yet", sum?.rating ? `${sum.rating.toFixed(1)} ★` : ""].filter(Boolean).join(" · ");
  const spot = info(id).member;
  $("springNotes").textContent = spot?.notes ?? "";
  $("springNotes").hidden = !spot?.notes;
  const actions: HTMLElement[] = [
    h("button", { type: "button", class: "primary", onclick: () => openVisitForm(id, null) }, "Log a visit"),
    h("button", { type: "button", class: "chip", onclick: () => { closeDlg("springDlg"); void showTab("map").then(() => map?.focus(id)); } }, "Show on map"),
  ];
  // A plain link, not a chip: chips act here, links go to another page.
  if (s[6]) actions.push(h("a", { class: "go", href: `rain.html#${s[3]},${s[4]}` }, "See it on the Rain map"));
  if (s[7]) actions.push(h("a", { class: "go", href: parkHref(s[7]) }, "Its state park"));
  if (spot && spot.created_by === myId()) actions.push(h("button", { type: "button", class: "chip", onclick: () => openSpotForm(spot) }, "Edit spot"));
  $("springActions").replaceChildren(...actions);
  const mine = journal.visits.filter((v) => v.spring_id === id);
  $("visits").replaceChildren(...mine.map(visitItem));
  void fillPhotos(mine.flatMap((v) => v.photos));
  openDlg("springDlg");
}

function visitItem(v: Visit) {
  const own = v.created_by === myId();
  return h(
    "li",
    { class: "visit" },
    h("div", { class: "visit-head" }, h("b", {}, formatDate(v.visited_on)), v.rating ? h("span", { class: "stars", "aria-label": `${v.rating} of 5` }, stars(v.rating)) : null, h("span", { class: "muted" }, nameOf(v.created_by_email)), own ? h("button", { type: "button", class: "linkish", onclick: () => openVisitForm(v.spring_id, v) }, "Edit") : null),
    v.sightings.length
      ? h("ul", { class: "seen-list" }, ...v.sightings.map((x) => h("li", {}, h("i", { class: "dot", style: `background:${groupColor(x.animal_group, isDark())}` }), x.count && x.count > 1 ? `${x.species} × ${x.count}` : x.species, x.from_gps ? h("span", { class: "muted", title: "Pinned by GPS" }, " 📍") : null)))
      : null,
    v.notes ? h("p", { class: "notes" }, v.notes) : null,
    v.photos.length ? h("div", { class: "thumbs" }, ...v.photos.map((p) => h("a", { class: "thumb", target: "_blank", rel: "noopener", "data-path": p.path }, h("span", { class: "muted" }, "…")))) : null,
  );
}

async function fillPhotos(photos: Photo[]) {
  if (!photos.length) return;
  let urls: Map<string, string>;
  try {
    urls = await photoUrls(photos.map((p) => p.path));
  } catch {
    return;
  }
  for (const a of document.querySelectorAll<HTMLAnchorElement>("#visits a.thumb")) {
    const url = urls.get(a.dataset.path!);
    if (!url) continue;
    a.href = url;
    a.replaceChildren(h("img", { src: url, alt: "Visit photo", loading: "lazy" }));
  }
}

// ---------- visit form ----------
interface FormState {
  springId: string;
  existing: Visit | null;
  sightings: SightingDraft[];
  newPhotos: File[];
  removed: Photo[];
}
let form: FormState | null = null;

function openVisitForm(springId: string, existing: Visit | null) {
  const s = byId.get(springId)!;
  closeDlg("springDlg");
  const draft = !existing ? readDraft(springId) : null;
  form = {
    springId,
    existing,
    sightings: existing ? existing.sightings.map((x) => ({ ...x })) : (draft?.sightings ?? []),
    newPhotos: [],
    removed: [],
  };
  $("visitTitle").textContent = existing ? "Edit visit" : "Log a visit";
  $("visitSpring").textContent = s[1];
  ($("vDate") as HTMLInputElement).value = existing?.visited_on ?? draft?.date ?? today();
  ($("vNotes") as HTMLTextAreaElement).value = existing?.notes ?? draft?.notes ?? "";
  renderStars(existing?.rating ?? draft?.rating ?? null);
  ($("useGps") as HTMLInputElement).checked = store.get(GPS_KEY) === "1";
  ($("vPhotos") as HTMLInputElement).value = "";
  $("vDelete").hidden = !existing;
  $("visitMsg").textContent = draft ? "Picked up your unsaved draft." : "";
  $("gpsMsg").textContent = "";
  renderChips(info(springId).salt);
  renderSightings();
  renderPhotos();
  openDlg("visitDlg");
}

function renderStars(value: number | null) {
  const fs = $("vRating");
  fs.replaceChildren(h("legend", {}, "How was it?"));
  for (let n = 1; n <= 5; n++) {
    const input = h("input", { type: "radio", name: "rating", value: n, id: `r${n}`, "aria-label": `${n} of 5` });
    if (value === n) input.checked = true;
    fs.append(input, h("label", { for: `r${n}`, title: `${n} of 5` }, "★"));
  }
  fs.append(h("button", { type: "button", class: "linkish", onclick: () => renderStars(null) }, "No rating"));
  fs.addEventListener("change", saveDraft, { once: true });
}

/** Quick-tap animals: the springs' list, or the ocean's at a salt-water spot. */
function renderChips(salt: boolean) {
  const wrap = $("chips");
  wrap.replaceChildren();
  for (const g of GROUPS) {
    const species = (salt ? SEA_SPECIES : SPECIES).filter((s) => s.group === g.id);
    if (!species.length) continue;
    wrap.append(
      h(
        "div",
        { class: "chipgroup" },
        h("span", { class: "chipgroup-label" }, h("i", { class: "dot", style: `background:${groupColor(g.id, isDark())}` }), g.label),
        ...species.map((s) => h("button", { type: "button", class: "chip", onclick: () => addSighting(s.name, s.group) }, s.name)),
      ),
    );
  }
  $("otherGroup").replaceChildren(...GROUPS.map((g) => h("option", { value: g.id, selected: g.id === "other" }, g.label)));
}

$("otherAdd").addEventListener("click", () => {
  const input = $("otherName") as HTMLInputElement;
  const name = input.value.trim();
  if (!name) return input.focus();
  addSighting(name, ($("otherGroup") as HTMLSelectElement).value as AnimalGroup);
  input.value = "";
});
$("otherName").addEventListener("input", (e) => {
  // Typing a known species picks its group automatically.
  const g = speciesGroup((e.target as HTMLInputElement).value.trim());
  if (g !== "other") ($("otherGroup") as HTMLSelectElement).value = g;
});
$("useGps").addEventListener("change", (e) => store.set(GPS_KEY, (e.target as HTMLInputElement).checked ? "1" : "0"));

function addSighting(species: string, group: AnimalGroup) {
  if (!form) return;
  const same = form.sightings.find((x) => !x.id && x.species === species && !x.from_gps);
  const useGps = ($("useGps") as HTMLInputElement).checked;
  if (same && !useGps) {
    same.count = (same.count ?? 1) + 1;
    renderSightings();
    return saveDraft();
  }
  const s = byId.get(form.springId)!;
  const draft: SightingDraft = { species, animal_group: group, count: 1, lat: s[4], lon: s[3], from_gps: false, seen_at: new Date().toISOString() };
  form.sightings.push(draft);
  renderSightings();
  saveDraft();
  if (!useGps) return;
  // Capture where it was seen right now, while the animal is in view.
  $("gpsMsg").textContent = `Pinning the ${species.toLowerCase()}…`;
  navigator.geolocation.getCurrentPosition(
    (p) => {
      draft.lat = p.coords.latitude;
      draft.lon = p.coords.longitude;
      draft.from_gps = true;
      $("gpsMsg").textContent = `Pinned within about ${Math.round(p.coords.accuracy)} m.`;
      renderSightings();
      saveDraft();
    },
    (err) => ($("gpsMsg").textContent = `No GPS fix (${err.message}), so it's logged at the ${info(form!.springId).spring ? "spring" : "spot"}.`),
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
  );
}

function renderSightings() {
  if (!form) return;
  $("sightings").replaceChildren(
    ...form.sightings.map((x, i) =>
      h(
        "li",
        {},
        h("i", { class: "dot", style: `background:${groupColor(x.animal_group, isDark())}` }),
        h("span", { class: "sp" }, x.species),
        h(
          "span",
          { class: "count" },
          h("button", { type: "button", class: "step", "aria-label": `One fewer ${x.species}`, disabled: (x.count ?? 1) <= 1, onclick: () => { x.count = Math.max(1, (x.count ?? 1) - 1); renderSightings(); saveDraft(); } }, "−"),
          h("span", { "aria-live": "polite" }, x.count ?? 1),
          h("button", { type: "button", class: "step", "aria-label": `One more ${x.species}`, onclick: () => { x.count = (x.count ?? 1) + 1; renderSightings(); saveDraft(); } }, "+"),
        ),
        h("span", { class: "muted where" }, x.from_gps ? "📍 GPS" : info(form!.springId).spring ? "at the spring" : "at the spot"),
        h("button", { type: "button", class: "x small", "aria-label": `Remove ${x.species}`, onclick: () => { form!.sightings.splice(i, 1); renderSightings(); saveDraft(); } }, "×"),
      ),
    ),
  );
}

$("vPhotos").addEventListener("change", (e) => {
  if (!form) return;
  form.newPhotos.push(...Array.from((e.target as HTMLInputElement).files ?? []));
  (e.target as HTMLInputElement).value = "";
  renderPhotos();
});

function renderPhotos() {
  if (!form) return;
  const f = form;
  const kept = (f.existing?.photos ?? []).filter((p) => !f.removed.includes(p));
  $("photoList").replaceChildren(
    ...kept.map((p) => h("li", { class: "thumb" }, h("span", { class: "muted" }, "Saved photo"), h("button", { type: "button", class: "x small", "aria-label": "Remove photo", onclick: () => { f.removed.push(p); renderPhotos(); } }, "×"))),
    ...f.newPhotos.map((file, i) => {
      const url = URL.createObjectURL(file);
      return h("li", { class: "thumb" }, h("img", { src: url, alt: file.name, onload: () => URL.revokeObjectURL(url) }), h("button", { type: "button", class: "x small", "aria-label": `Remove ${file.name}`, onclick: () => { f.newPhotos.splice(i, 1); renderPhotos(); } }, "×"));
    }),
  );
}

for (const id of ["vDate", "vNotes"]) $(id).addEventListener("input", saveDraft);

function currentRating(): number | null {
  const r = document.querySelector<HTMLInputElement>('#vRating input[name="rating"]:checked');
  return r ? Number(r.value) : null;
}

/** Unsaved visits survive a dropped signal or a closed tab (photos can't be kept). */
function saveDraft() {
  if (!form || form.existing) return;
  store.set(DRAFT_KEY, JSON.stringify({ springId: form.springId, date: ($("vDate") as HTMLInputElement).value, rating: currentRating(), notes: ($("vNotes") as HTMLTextAreaElement).value, sightings: form.sightings }));
}
function readDraft(springId: string): { date: string; rating: number | null; notes: string; sightings: SightingDraft[] } | null {
  try {
    const d = JSON.parse(store.get(DRAFT_KEY) ?? "null");
    return d?.springId === springId ? d : null;
  } catch {
    return null;
  }
}

$("visitForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!form) return;
  const date = ($("vDate") as HTMLInputElement).value;
  if (!date) {
    $("visitMsg").textContent = "Add the date of the visit.";
    return;
  }
  const save = $("vSave") as HTMLButtonElement;
  if (demo) {
    const v: Visit = { id: crypto.randomUUID(), spring_id: form.springId, visited_on: date, rating: currentRating(), notes: ($("vNotes") as HTMLTextAreaElement).value || null, created_by: "demo-a", created_by_email: session!.user.email!, created_at: "", sightings: form.sightings.map((x, i) => ({ ...x, id: x.id ?? `new${i}`, visit_id: "", notes: null, created_by: "demo-a" })), photos: [] };
    journal.visits = [v, ...journal.visits.filter((x) => x.id !== form!.existing?.id)];
    const id = form.springId;
    closeDlg("visitDlg");
    await reload();
    openSpring(id);
    return;
  }
  save.disabled = true;
  try {
    await saveVisit(
      { spring_id: form.springId, visited_on: date, rating: currentRating(), notes: ($("vNotes") as HTMLTextAreaElement).value, sightings: form.sightings, newPhotos: form.newPhotos, removedPhotos: form.removed },
      form.existing,
      (msg) => ($("visitMsg").textContent = msg),
    );
    if (!form.existing) store.set(DRAFT_KEY, null);
    const id = form.springId;
    closeDlg("visitDlg");
    await reload();
    openSpring(id);
  } catch (err) {
    $("visitMsg").textContent = `Not saved: ${(err as Error).message}. Your entry is still here; try again when you have signal.`;
  } finally {
    save.disabled = false;
  }
});

$("vDelete").addEventListener("click", async () => {
  if (!form?.existing || !confirm("Delete this visit, its sightings, and its photos? This can't be undone.")) return;
  try {
    const id = form.springId;
    await deleteVisit(form.existing);
    closeDlg("visitDlg");
    await reload();
    openSpring(id);
  } catch (err) {
    $("visitMsg").textContent = `Couldn't delete: ${(err as Error).message}`;
  }
});

// ---------- adding a spot ----------
let spotEditing: MemberSpot | null = null;
$("sKind").replaceChildren(...(Object.keys(KIND_LABEL) as SpotKind[]).map((k) => h("option", { value: k }, KIND_LABEL[k])));
$("addSpot").addEventListener("click", () => openSpotForm(null));

function openSpotForm(existing: MemberSpot | null, at?: [number, number]) {
  spotEditing = existing;
  closeDlg("springDlg");
  $("spotTitle").textContent = existing ? "Edit spot" : "Add a spot";
  ($("sName") as HTMLInputElement).value = existing?.name ?? "";
  ($("sKind") as HTMLSelectElement).value = existing?.kind ?? "reef";
  ($("sNotes") as HTMLTextAreaElement).value = existing?.notes ?? "";
  const where = at ?? (existing ? [existing.lat, existing.lon] : null);
  ($("sWhere") as HTMLInputElement).value = where ? `${where[0].toFixed(5)}, ${where[1].toFixed(5)}` : "";
  // A spot someone has logged visits at stays, so their visits keep a place.
  $("sDelete").hidden = !existing || journal.visits.some((v) => v.spring_id === existing.id);
  $("spotMsg").textContent = "";
  openDlg("spotDlg");
}

$("sGps").addEventListener("click", () => {
  $("spotMsg").textContent = "Finding you…";
  navigator.geolocation.getCurrentPosition(
    (p) => {
      ($("sWhere") as HTMLInputElement).value = `${p.coords.latitude.toFixed(5)}, ${p.coords.longitude.toFixed(5)}`;
      $("spotMsg").textContent = `Within about ${Math.round(p.coords.accuracy)} m.`;
    },
    (err) => ($("spotMsg").textContent = `Couldn't get your location: ${err.message}`),
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
  );
});

$("sPick").addEventListener("click", async () => {
  // Close the form, take one tap on the map, then come back with it filled in.
  const draft = { name: ($("sName") as HTMLInputElement).value, kind: ($("sKind") as HTMLSelectElement).value, notes: ($("sNotes") as HTMLTextAreaElement).value };
  const editing = spotEditing;
  closeDlg("spotDlg");
  await showTab("map");
  $("pickMsg").hidden = false;
  const at = await map!.pick();
  $("pickMsg").hidden = true;
  openSpotForm(editing, at ?? undefined);
  ($("sName") as HTMLInputElement).value = draft.name;
  ($("sKind") as HTMLSelectElement).value = draft.kind;
  ($("sNotes") as HTMLTextAreaElement).value = draft.notes;
});
$("pickCancel").addEventListener("click", () => map?.cancelPick());

$("spotForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = ($("sName") as HTMLInputElement).value.trim();
  const where = parseWhere(($("sWhere") as HTMLInputElement).value);
  if (!name) return void ($("spotMsg").textContent = "Give the spot a name.");
  if (!where) return void ($("spotMsg").textContent = "Add where it is: latitude, longitude in Florida, your location, or a tap on the map.");
  const draft = { name, kind: ($("sKind") as HTMLSelectElement).value as SpotKind, lat: where[0], lon: where[1], notes: ($("sNotes") as HTMLTextAreaElement).value };
  const save = $("sSave") as HTMLButtonElement;
  save.disabled = true;
  try {
    let id: string;
    if (demo) {
      id = spotEditing?.id ?? `spot-demo${Date.now()}`;
      journal.spots = [...journal.spots.filter((x) => x.id !== id), { id, ...draft, notes: draft.notes || null, created_by: myId()!, created_by_email: session!.user.email!, created_at: "" }];
    } else {
      id = await saveSpot(draft, spotEditing);
    }
    closeDlg("spotDlg");
    await reload();
    openSpring(id);
  } catch (err) {
    $("spotMsg").textContent = `Not saved: ${(err as Error).message}`;
  } finally {
    save.disabled = false;
  }
});

$("sDelete").addEventListener("click", async () => {
  if (!spotEditing || !confirm(`Delete ${spotEditing.name}? This can't be undone.`)) return;
  try {
    if (demo) journal.spots = journal.spots.filter((x) => x.id !== spotEditing!.id);
    else await deleteSpot(spotEditing.id);
    closeDlg("spotDlg");
    await reload();
  } catch (err) {
    $("spotMsg").textContent = `Couldn't delete: ${(err as Error).message}`;
  }
});

// ---------- map layers ----------
function renderLayers() {
  if (!map) return;
  const m = map;
  const fs = $("layers");
  fs.replaceChildren(h("legend", {}, "Show on the map"));
  const base = (b: "imagery" | "topo", label: string) =>
    h("label", { class: "layer" }, h("input", { type: "radio", name: "basemap", checked: m.basemap === b, onchange: () => { m.setBasemap(b); store.set(BASEMAP_KEY, b); } }), label);
  fs.append(
    h("div", { class: "basemaps" }, base("imagery", "Satellite"), base("topo", "Topo"), h("label", { class: "layer" }, h("input", { type: "checkbox", checked: m.hydroOn, onchange: (e: Event) => m.setHydro((e.target as HTMLInputElement).checked) }), "Streams & lakes")),
  );
  for (const l of map.layerInfo()) {
    const input = h("input", { type: "checkbox", checked: l.on, onchange: (e: Event) => map!.toggle(l.id as LayerId, (e.target as HTMLInputElement).checked) });
    fs.append(h("label", { class: "layer" }, input, h("i", { class: "dot", style: `background:${l.color}` }), l.label, h("span", { class: "muted" }, ` ${l.count}`)));
  }
}

// ---------- people ----------
function renderPeople() {
  const me = session?.user.email?.toLowerCase();
  $("people").replaceChildren(
    ...journal.members.map((m) =>
      h(
        "li",
        {},
        h("b", {}, m.display_name || m.email.split("@")[0]),
        h("span", { class: "muted" }, ` ${m.email}`),
        m.email !== me ? h("button", { type: "button", class: "linkish", onclick: async () => { if (confirm(`Remove ${m.email} from the journal? Their past entries stay.`)) { await removeMember(m.email); await reload(); } } }, "Remove") : h("span", { class: "muted" }, " (you)"),
      ),
    ),
  );
}

$("invite").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = ($("inviteEmail") as HTMLInputElement).value;
  try {
    await inviteMember(email, ($("inviteName") as HTMLInputElement).value);
    ($("invite") as HTMLFormElement).reset();
    $("inviteMsg").textContent = `Added. ${email} can now sign in here.`;
    await reload();
  } catch (err) {
    $("inviteMsg").textContent = `Couldn't add them: ${(err as Error).message}`;
  }
});

// ---------- dialogs ----------
function openDlg(id: string) {
  const d = $(id) as HTMLDialogElement;
  if (!d.open) d.showModal();
}
function closeDlg(id: string) {
  const d = $(id) as HTMLDialogElement;
  if (d.open) d.close();
}
for (const d of document.querySelectorAll<HTMLDialogElement>("dialog")) {
  d.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t === d || t.closest("[data-close]")) d.close();
  });
}

onColorSchemeChange(() => {
  map?.setTheme(isDark());
  refresh();
});

main().catch((err) => {
  $("boot").textContent = `The journal didn't load: ${(err as Error).message}`;
});
