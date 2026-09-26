import "../shared/map.css";
import "../shared/nav";
import "../shared/story.css";
import "./panthers.css";
import { CreekLayer } from "../rain/creeks";
import { InfoCard } from "../shared/card";
import { escapeHtml, loadData, showLoadError } from "../shared/data";
import { nearestDistance, polyline, project, ringsPath, unpackRings, type XY } from "../shared/geo";
import { renderHistory, type Measure } from "../shared/history";
import { drawJournal, hitSighting, loadJournalOverlay, sightingCard, type JournalOverlay } from "../shared/journal-overlay";
import { decodeLakes, drawLakeLabels, drawLakes } from "../shared/lakes";
import { StreakLayer, fadeLayer } from "../shared/streaks";
import { cssVar, fontsReady, isDark, onColorSchemeChange } from "../shared/theme";
import type { LakesFile, PantherDeath, PanthersFile, PantherYear, PantherZone, Snapshot } from "../shared/types";
import { Viewport, startLoop } from "../shared/viewport";
import {
  ANCESTRY_TEXT, CAM, CAM_TEXT, ERAS, FACTS, FLM_TEXT, PLACES, POP_TEXT, RESCUE_TEXT, RIVER_TEXT, ROADS, ROAD_SHORT, ROAD_TEXT, SWAMP_TEXT, TOWNS, VIEWS, ZONE_TEXT, causeLine,
} from "./content";

/** Months of the clock per second while it plays. */
const MPS = 6;
/** A panther is drawn moving between monthly positions this many months apart or fewer; across a longer gap it isn't drawn. */
const GAP = 3;
/** It lingers this many months after its last position. */
const HOLD = 1;
/** Seconds the clock rests at the end before starting over. */
const REST_S = 4;
const LABEL_SCALE = 2500;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** Hit tests run smallest zone first: the dispersal corridor sits inside the others. */
const ZONE_TAP_ORDER: PantherZone[] = ["dispersal", "north", "primary", "secondary"];
const ZONE_ALPHA: Record<PantherZone, number> = { primary: 0.1, secondary: 0.06, dispersal: 0.14, north: 0.05 };

interface Cat {
  id: string;
  texas: boolean;
  n: number;
  m: number[];
  pts: XY[];
  /** Cursor into `m` for the clock. */
  i: number;
  /** Where it was drawn last frame, and is now (map units), or null when it isn't on the map. */
  prev: XY | null;
  at: XY | null;
}

interface Death {
  m: number;
  row: PantherDeath;
  xy: XY;
}

/** Catmull-Rom through four values, so a panther's path bends smoothly through its monthly positions. */
const cr = (a: number, b: number, c: number, d: number, u: number) => 0.5 * (2 * b + (c - a) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (3 * b - a - 3 * c + d) * u * u * u);

async function main() {
  const [data, snapshot] = await Promise.all([loadData<PanthersFile>("panthers.json"), loadData<Snapshot>("snapshot.json").catch(() => null), fontsReady()]);
  const { coordOrigin, coordScale: k } = data.meta;
  const [ox, oy] = coordOrigin;
  const monthOf = (iso: string) => (+iso.slice(0, 4) - data.start) * 12 + +iso.slice(5, 7) - 1;
  const monthName = (m: number) => `${MONTHS[((m % 12) + 12) % 12]} ${data.start + Math.floor(m / 12)}`;
  const yearOf = (m: number) => data.start + Math.floor(m / 12);

  const cats: Cat[] = data.cats.map((c) => ({
    id: c.id,
    texas: c.id.startsWith("TX"),
    n: c.n,
    m: c.m,
    pts: c.m.map((_, j) => project(c.p[2 * j] / k + ox, c.p[2 * j + 1] / k + oy)),
    i: 0,
    prev: null,
    at: null,
  }));
  const catById = new Map(cats.map((c) => [c.id, c]));
  const deaths: Death[] = data.deaths.map((row) => ({ m: monthOf(row[0]), row, xy: project(row[6], row[7]) }));
  const water = decodeLakes({ meta: data.meta, bodies: data.water } as LakesFile);
  const linesPath = (flat: number[][]) => {
    const p = new Path2D();
    for (const l of unpackRings(flat, coordOrigin, k)) l.forEach((q, i) => (i ? p.lineTo(q[0], q[1]) : p.moveTo(q[0], q[1])));
    return p;
  };
  const roadPath = linesPath(data.roads);
  const riverPath = linesPath(data.river);
  const riverLines = unpackRings(data.river, coordOrigin, k).map(polyline);
  const zones = data.zones.map((z) => ({ ...z, path: ringsPath(unpackRings(z.rings, coordOrigin, k)) }));
  const cutoffM = monthOf(data.cutoff);
  const cutoffName = monthName(cutoffM);
  const endM = data.end;

  // ---------- deaths by year ----------
  const firstYear = yearOf(deaths[0].m);
  const lastYear = yearOf(deaths[deaths.length - 1].m);
  const years = Array.from({ length: lastYear - firstYear + 1 }, (_, i) => firstYear + i);
  const count = (pred: (d: Death) => boolean) => years.map((y) => deaths.filter((d) => yearOf(d.m) === y && pred(d)).length);
  const byVehicle = count((d) => d.row[1] === "vehicle");
  const byOther = count((d) => d.row[1] !== "vehicle");
  const totalVehicle = byVehicle.reduce((a, b) => a + b, 0);
  const thisYear: PantherYear = snapshot?.panthers ?? {
    year: lastYear,
    deaths: byVehicle[years.length - 1] + byOther[years.length - 1],
    vehicle: byVehicle[years.length - 1],
    through: null,
  };

  // ---------- map ----------
  let C: Record<string, string> = {};
  let glow = true;
  const readColors = () => {
    C = Object.fromEntries(["bg", "ink", "muted", "panther", "texas", "sea", "lake", "shore", "marsh", "stream", "line"].map((n) => [n, cssVar(`--${n}`)]));
    glow = isDark();
  };
  let histMode = false;
  const card = new InfoCard();
  const view = new Viewport({
    minScale: 140,
    maxScale: 12000,
    padding: (w) => (w < 600 ? { x: 12, top: histMode ? 12 : 84, bottom: 14 } : { x: 60, top: 40, bottom: 30 }),
    drawBase,
    onTap: tap,
  });
  const { X, Y } = view;
  const creeks = new CreekLayer(() => view.redraw());
  let journal: JournalOverlay | null = null;

  function drawBase() {
    const c = view.bctx;
    const { W, H } = view;
    const { s, tx, ty } = view.cam;
    const inMap = () => c.setTransform(view.DPR * s, 0, 0, view.DPR * s, view.DPR * tx, view.DPR * ty);
    c.setTransform(view.DPR, 0, 0, view.DPR, 0, 0);
    c.fillStyle = C.bg;
    c.fillRect(0, 0, W, H);
    // The habitat zones, faint under the water.
    c.save();
    inMap();
    c.fillStyle = C.panther;
    for (const z of zones) {
      c.globalAlpha = ZONE_ALPHA[z.zone] * (glow ? 1 : 1.3);
      c.fill(z.path, "evenodd");
    }
    c.restore();
    drawLakes(c, water, X, Y, view.cam, { sea: C.sea, lake: C.lake, shore: C.shore, marsh: C.marsh, label: C.muted });
    c.save();
    inMap();
    c.strokeStyle = C.panther;
    c.globalAlpha = 0.45;
    c.lineWidth = 1 / s;
    c.setLineDash([4 / s, 3 / s]);
    for (const z of zones) c.stroke(z.path);
    c.setLineDash([]);
    creeks.update([-tx / s, -ty / s, (W - tx) / s, (H - ty) / s], s);
    c.strokeStyle = C.stream;
    c.globalAlpha = 0.6;
    creeks.draw(c, s);
    c.lineCap = "round";
    c.lineJoin = "round";
    c.strokeStyle = C.muted;
    c.globalAlpha = glow ? 0.45 : 0.55;
    c.lineWidth = 1 / s;
    c.stroke(roadPath);
    c.globalAlpha = 1;
    c.strokeStyle = C.stream;
    c.lineWidth = 2.6 / s;
    c.stroke(riverPath);
    c.restore();

    c.textAlign = "left";
    c.font = "italic 400 13px 'Spectral',serif";
    c.fillStyle = C.muted;
    for (const [n, lon, lat, from] of PLACES) {
      if (view.scale < from) continue;
      const p = project(lon, lat);
      c.fillText(n, X(p[0]), Y(p[1]));
    }
    if (view.scale >= 450) {
      c.fillStyle = C.stream;
      const cal = project(-81.66, 26.745);
      c.fillText("Caloosahatchee River", X(cal[0]), Y(cal[1]));
    }
    c.font = "500 12px 'Barlow Semi Condensed',sans-serif";
    c.fillStyle = C.muted;
    for (const [n, lon, lat, east, from] of TOWNS) {
      if (view.scale < from) continue;
      const p = project(lon, lat);
      c.textAlign = east ? "left" : "right";
      c.fillText(n, X(p[0]) + (east ? 5 : -5), Y(p[1]) + 4);
    }
    c.textAlign = "left";
    if (view.scale >= LABEL_SCALE) {
      c.font = "500 11px 'Barlow Semi Condensed',sans-serif";
      for (const [n, lon, lat] of ROADS) {
        const p = project(lon, lat);
        c.fillText(n, X(p[0]), Y(p[1]));
      }
      drawLakeLabels(c, water, X, Y, view.scale, C.muted);
    }
    if (journal) drawJournal(c, journal, X, Y, [], C.ink, glow);
  }

  // ---------- the clock ----------
  let t = 0;
  let playing = !view.reduceMotion;
  let rest = 0;
  /** How many deaths the clock has passed (they're in month order). */
  let shown = 0;
  let shownMonth = -1;
  let onMap = 0;
  const pulses: { xy: XY; age: number }[] = [];
  const slider = document.getElementById("slider") as HTMLInputElement;
  const yearEl = document.getElementById("year")!;
  const eraEl = document.getElementById("era")!;
  const bPlay = document.getElementById("bPlay")!;
  slider.max = String(endM);

  function posAt(cat: Cat, at: number): XY | null {
    const m = cat.m;
    const n = m.length;
    if (at < m[0] || at > m[n - 1] + HOLD) return null;
    let i = cat.i;
    if (i >= n || m[i] > at) i = 0;
    while (i + 1 < n && m[i + 1] <= at) i++;
    cat.i = i;
    if (i === n - 1 || m[i + 1] - m[i] > GAP) return at - m[i] <= HOLD ? cat.pts[i] : null;
    const u = (at - m[i]) / (m[i + 1] - m[i]);
    const a = cat.pts[i > 0 && m[i] - m[i - 1] <= GAP ? i - 1 : i];
    const b = cat.pts[i];
    const c = cat.pts[i + 1];
    const d = cat.pts[i + 2 < n && m[i + 2] - m[i + 1] <= GAP ? i + 2 : i + 1];
    return [cr(a[0], b[0], c[0], d[0], u), cr(a[1], b[1], c[1], d[1], u)];
  }

  function eraText(m: number): string {
    const y = yearOf(m);
    const when = `<b>${monthName(m)}</b>`;
    if (m >= cutoffM) return `${when} · Collar positions since ${cutoffName} are left off, to protect the panthers still wearing them. The deaths go on.`;
    const note = ERAS.find(([a, b]) => y >= a && y <= b)?.[2];
    return `${when} · ${onMap} collared${note ? ` · ${note}` : ""}`;
  }

  function showMonth() {
    const m = Math.floor(t);
    shownMonth = m;
    yearEl.textContent = String(yearOf(m));
    slider.value = String(m);
    eraEl.innerHTML = eraText(m);
  }

  /** Jump the clock: nothing trails in from where the panthers were. */
  function jump(to: number) {
    t = Math.max(0, Math.min(endM, to));
    rest = 0;
    for (const c of cats) {
      c.i = 0;
      c.prev = null;
    }
    shown = deaths.findIndex((d) => d.m > t);
    if (shown < 0) shown = deaths.length;
    pulses.length = 0;
    view.clearFx();
    place();
    showMonth();
  }

  const setPlaying = (p: boolean) => {
    playing = p;
    bPlay.textContent = p ? "Pause" : "Play";
    bPlay.setAttribute("aria-pressed", String(!p));
  };
  bPlay.addEventListener("click", () => {
    if (!playing && t >= endM) jump(0);
    setPlaying(!playing);
  });
  slider.addEventListener("input", () => {
    setPlaying(false);
    jump(+slider.value);
  });

  function step(dt: number) {
    for (let i = pulses.length - 1; i >= 0; i--) {
      pulses[i].age += dt;
      if (pulses[i].age > 1.4) pulses.splice(i, 1);
    }
    if (!playing) return;
    if (t >= endM) {
      rest += dt;
      if (rest > REST_S) jump(0);
      return;
    }
    t = Math.min(endM, t + MPS * dt);
    while (shown < deaths.length && deaths[shown].m <= t) {
      pulses.push({ xy: deaths[shown].xy, age: 0 });
      shown++;
    }
  }

  /** Where every panther is at the clock's time. */
  function place() {
    onMap = 0;
    for (const c of cats) {
      c.prev = c.at;
      c.at = posAt(c, t);
      if (c.at) onMap++;
      else c.prev = null;
    }
  }

  const streaks = new StreakLayer();
  function draw() {
    const c = view.fctx;
    const { W, H } = view;
    c.setTransform(view.DPR, 0, 0, view.DPR, 0, 0);
    fadeLayer(c, W, H, 0.07);
    const z = Math.min(2.2, Math.max(1, view.scale / 2500));
    streaks.style(0, C.panther, glow ? 0.75 : 0.9, 1.5 * z);
    streaks.style(1, C.texas, glow ? 0.85 : 0.95, 1.8 * z);
    streaks.begin();
    for (const cat of cats) if (cat.at && cat.prev) streaks.add(cat.texas ? 1 : 0, X(cat.prev[0]), Y(cat.prev[1]), X(cat.at[0]), Y(cat.at[1]));
    streaks.flush(c, glow);
    // Each panther's head, Texas pumas a little bigger.
    for (const cat of cats) {
      if (!cat.at) continue;
      c.fillStyle = cat.texas ? C.texas : C.panther;
      c.beginPath();
      c.arc(X(cat.at[0]), Y(cat.at[1]), (cat.texas ? 3 : 2.4) * Math.sqrt(z), 0, 7);
      c.fill();
    }
    // Every death the clock has passed, smaller zoomed out, where hundreds share a few roads.
    const r = 2.6 * Math.min(1, Math.max(0.55, view.scale / 700));
    c.strokeStyle = C.ink;
    c.globalAlpha = view.scale < 400 ? 0.6 : 0.75;
    c.lineWidth = 1.2;
    c.beginPath();
    for (let i = 0; i < shown; i++) {
      const [x, y] = [X(deaths[i].xy[0]), Y(deaths[i].xy[1])];
      if (x < -5 || y < -5 || x > W + 5 || y > H + 5) continue;
      c.moveTo(x - r, y - r);
      c.lineTo(x + r, y + r);
      c.moveTo(x + r, y - r);
      c.lineTo(x - r, y + r);
    }
    c.stroke();
    // A ring where one has just died.
    for (const p of pulses) {
      const k2 = p.age / 1.4;
      c.globalAlpha = (1 - k2) * 0.9;
      c.beginPath();
      c.arc(X(p.xy[0]), Y(p.xy[1]), 3 + k2 * 14, 0, 7);
      c.stroke();
    }
    c.globalAlpha = 1;
  }

  // ---------- cards ----------
  const probe = document.createElement("canvas").getContext("2d")!;
  const deathOf = (id: string) => deaths.find((d) => d.row[8] === id);
  function tap(x: number, y: number) {
    if (journal) {
      const seen = hitSighting(journal, X, Y, x, y);
      if (seen) return card.show(sightingCard(seen));
    }
    let best: (() => void) | null = null;
    let bd = 14 * 14;
    const test = (xy: XY, f: () => void) => {
      const d = (X(xy[0]) - x) ** 2 + (Y(xy[1]) - y) ** 2;
      if (d < bd) {
        bd = d;
        best = f;
      }
    };
    for (const c of cats) if (c.at) test(c.at, () => showCat(c));
    for (let i = 0; i < shown; i++) test(deaths[i].xy, () => showDeath(deaths[i]));
    if (best) return (best as () => void)();
    const m: XY = [(x - view.cam.tx) / view.cam.s, (y - view.cam.ty) / view.cam.s];
    if (riverLines.some((l) => nearestDistance(l, ...m) < 12 / view.cam.s)) return card.show({ title: "Caloosahatchee River", kind: "The northern edge", body: RIVER_TEXT });
    for (const zn of ZONE_TAP_ORDER) {
      const z = zones.find((q) => q.zone === zn);
      if (z && probe.isPointInPath(z.path, m[0], m[1], "evenodd")) {
        const acres = `${Math.round(z.acres / 1000).toLocaleString()},000 acres.`;
        return card.show({ title: ZONE_TEXT[zn].title, kind: "Panther habitat zone", body: `${ZONE_TEXT[zn].body} ${acres}${zn === "primary" ? ` ${SWAMP_TEXT}` : ""}` });
      }
    }
    card.hide();
  }

  const ageText = (age: number) => (age < 1 ? `${Math.max(1, Math.round(age * 12))} months old` : `${age} year${age === 1 ? "" : "s"} old`);

  function showCat(cat: Cat) {
    const last = cat.m[cat.m.length - 1];
    const died = deathOf(cat.id);
    let body = cat.texas ? `One of the eight female pumas brought from Texas in ${FACTS.released} to save the Florida panther. ` : "";
    body += `FWC tracked this panther from the air from ${monthName(cat.m[0])} to ${monthName(last)}: ${cat.n.toLocaleString()} fixes, shown here one a month.`;
    if (last >= cutoffM - 2) body += " Newer positions are left off.";
    if (died) body += ` It died in ${monthName(died.m)}: ${escapeHtml(causeLine(died.row[1], died.row[2]).toLowerCase())}${died.row[5] ? `, in ${escapeHtml(died.row[5])} County` : ""}.`;
    else if (cat.texas && yearOf(last) <= FACTS.removed) body += ` Like the other Texas pumas still alive then, it was taken out of the wild by ${FACTS.removed}.`;
    card.show({ title: cat.texas ? `${cat.id}, a Texas puma` : `Panther ${cat.id}`, kind: "Radio-collared", body, color: cat.texas ? C.texas : C.panther });
  }

  function showDeath(d: Death) {
    const [, group, fwc, sex, age, county, , , id] = d.row;
    const who = [sex === "F" ? "A female" : sex === "M" ? "A male" : "A panther", age != null ? ageText(age) : null].filter(Boolean).join(", ");
    const cat = id ? catById.get(id) : undefined;
    let body = `${who}.`;
    if (cat) body += ` FWC had tracked this panther (${escapeHtml(cat.id)}) by radio collar since ${yearOf(cat.m[0])}.`;
    if (group === "vehicle") body += ` ${ROAD_SHORT(totalVehicle, deaths.length, firstYear)}`;
    // Title and kind are set as text; only the body is HTML.
    card.show({ title: causeLine(group, fwc), kind: `${monthName(d.m)}${county ? `, ${county} County` : ""}`, body });
  }

  // ---------- numbers under the map ----------
  function renderProfile() {
    const el = document.getElementById("profile")!;
    el.replaceChildren();
    const items: [value: string, unit: string, name: string, on: () => void][] = [
      [FACTS.now.replace(" to ", "–"), "", "adults in the wild", () => card.show({ title: "Florida panthers today", kind: "2017 estimate", body: `${POP_TEXT} ${ANCESTRY_TEXT}` })],
      [String(thisYear.vehicle), "", `hit by vehicles in ${thisYear.year}`, () => card.show({ title: "Roads", kind: `${thisYear.deaths} deaths in ${thisYear.year} so far`, body: ROAD_TEXT(totalVehicle, deaths.length, firstYear) })],
      [String(FACTS.texas), "", `Texas pumas, ${FACTS.released}`, rescue],
      [FACTS.ancestry.replace(" to ", "–"), "%", "Texas ancestry today", () => card.show({ title: "Texas and Florida", kind: "Ancestry", body: ANCESTRY_TEXT })],
      [String(FACTS.flmConfirmed), "", "confirmed with leukomyelopathy", () => card.show({ title: "Feline leukomyelopathy", kind: "A disease of the spinal cord", body: FLM_TEXT })],
      ["2", "", `live at the ${CAM.zoo}`, () => card.show({ title: "Panther cam", kind: CAM.zoo, body: CAM_TEXT })],
    ];
    for (const [value, unit, name, on] of items) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "gauge";
      const v = document.createElement("div");
      v.className = "v";
      v.textContent = value;
      if (unit) {
        const u = document.createElement("small");
        u.textContent = unit;
        v.appendChild(u);
      }
      const n = document.createElement("div");
      n.className = "n";
      n.textContent = name;
      b.append(v, n);
      b.addEventListener("click", on);
      el.appendChild(b);
    }
  }

  function renderCopy() {
    const through = thisYear.through ? `, as of ${new Date(`${thisYear.through}T12:00:00`).toLocaleDateString([], { month: "long", day: "numeric" })}` : "";
    document.getElementById("lede")!.innerHTML =
      `By the early 1990s only ${FACTS.low} Florida panthers were left. Eight female pumas brought from Texas in ${FACTS.released} helped bring them back to about ${FACTS.now} adults. ` +
      `Each dot is a panther FWC tracked by radio collar. Cars kill the most: <b>${thisYear.vehicle}</b> hit so far in ${thisYear.year}${through}. ` +
      `Tap the map, or <a href="${CAM.url}" target="_blank" rel="noopener">watch two live at the ${CAM.zoo}</a>.`;
    document.getElementById("status")!.textContent =
      `Collar positions: FWC, Big Cypress National Preserve, and Everglades National Park, one a month, rounded to about 500 m, with those since ${cutoffName} left off. ` +
      "Deaths: FWC, places rounded to about 1 km. Habitat zones: USFWS, via FDEP. Roads: Census TIGER. Water: USGS NHD.";
  }

  // ---------- deaths by year ----------
  const DEATHS: Measure = { unit: "deaths", format: (v) => (v == null ? "—" : String(v)), year: "Year", what: "panther deaths a year" };
  function renderHist() {
    const totals = years.map((_, i) => byVehicle[i] + byOther[i]);
    const peak = Math.max(...totals);
    const peakYears = years.filter((_, i) => totals[i] === peak);
    document.getElementById("histRead")!.innerHTML =
      `FWC has recorded <b>${deaths.length}</b> panther deaths since ${firstYear}, <b>${totalVehicle}</b> of them on roads. ` +
      `The most in a year was ${peak}, in ${peakYears.join(" and ")}. More deaths partly mean more panthers: there are several times as many as in the early 1990s.`;
    renderHistory(document.getElementById("histChart")!, years, [
      { name: "Hit by vehicles", color: "--chart-tannin", values: byVehicle },
      { name: "Other causes", color: "--chart-spring", values: byOther },
    ], DEATHS);
  }
  const bHist = document.getElementById("bHist")!;
  bHist.addEventListener("click", () => {
    histMode = !histMode;
    bHist.setAttribute("aria-pressed", String(histMode));
    document.getElementById("hist")!.classList.toggle("on", histMode);
    document.body.classList.toggle("hist", histMode);
    card.hide();
    requestAnimationFrame(() => {
      view.resize();
      view.fit(VIEWS.all);
      if (histMode) renderHist();
    });
  });

  function rescue() {
    view.fit(VIEWS.all, true);
    jump(monthOf(`${FACTS.released - 1}-10`));
    setPlaying(true);
    card.show({ title: "The Texas rescue", kind: `${FACTS.released}–${FACTS.removed}`, body: `${RESCUE_TEXT} ${ANCESTRY_TEXT}`, color: C.texas });
  }

  // ---------- boot ----------
  document.getElementById("bAll")!.addEventListener("click", () => view.fit(VIEWS.all, true));
  document.getElementById("bCypress")!.addEventListener("click", () => {
    view.fit(VIEWS.cypress, true);
    card.show({ title: "The Big Cypress", kind: "Slow water", body: SWAMP_TEXT });
  });
  document.getElementById("bNorth")!.addEventListener("click", () => {
    view.fit(VIEWS.north, true);
    card.show({ title: "Caloosahatchee River", kind: "The northern edge", body: RIVER_TEXT });
  });
  document.getElementById("bRescue")!.addEventListener("click", rescue);

  readColors();
  renderProfile();
  renderCopy();
  view.resize();
  view.fit(VIEWS.all);
  // Without motion, rest on the last month the collars show.
  jump(view.reduceMotion ? cutoffM - 1 : 0);
  setPlaying(playing);
  startLoop((dt, now) => {
    view.tick(now);
    step(dt);
    place();
    if (Math.floor(t) !== shownMonth) showMonth();
    draw();
  });
  addEventListener("resize", () => {
    view.resize();
    view.fit(VIEWS.all);
    if (histMode) renderHist();
  });
  onColorSchemeChange(() => {
    readColors();
    view.redraw();
  });
  void creeks.load().catch((err) => console.warn("Creeks unavailable", err));
  void loadJournalOverlay().then((o) => {
    if (!o) return;
    journal = o;
    drawBase();
  });
}

main().catch(showLoadError);
