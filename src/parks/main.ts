import "../shared/map.css";
import "../shared/nav";
import "./parks.css";
import { CreekLayer } from "../rain/creeks";
import { unpackDelta } from "../rain/network";
import { InfoCard } from "../shared/card";
import { escapeHtml, loadData, showLoadError } from "../shared/data";
import { project, ringsPath, unpackRings, type Bounds, type XY } from "../shared/geo";
import { drawJournal, hitSighting, journalCardHtml, loadJournalOverlay, sightingCard, type JournalOverlay } from "../shared/journal-overlay";
import { MAG_TEXT } from "../shared/magnitude";
import { parkSlug } from "../shared/parks";
import { drawBoil } from "../shared/streaks";
import { cssVar, fontsReady, isDark, onColorSchemeChange } from "../shared/theme";
import { PARK_WATER, type ParkWater, type ParksFile, type SpringsFile, type StatePark, type StatewideFile } from "../shared/types";
import { Viewport, startLoop } from "../shared/viewport";
import { glintAlpha, placeGlints, type Glint } from "../springs/glints";
import { CITIES, MAP_LINKS, NOTES, PLAN_2024, PLAN_TEXT, VIEWS, WATER } from "./content";
import { counties, shortName } from "./names";

/** Spring dot radius by FDEP magnitude class (index); unknown and small springs share the smallest. */
const RADIUS = [1.5, 3.6, 2.6, 2, 1.5, 1.5, 1.5, 1.5, 1.5];
/** Parks glint this many times as densely as the springs map's wetlands: they're the point here. */
const GLINT_DENSITY = 3;
/** A park smaller than this on screen (px) gets a marker, so it can be seen and tapped. */
const MARKER_PX = 7;
const ACRES_PER_KM2 = 247.105;

interface Park extends StatePark {
  cls: ParkWater;
  slug: string;
  path: Path2D;
  box: Bounds;
  xy: XY;
}

interface Spring {
  id: string;
  name: string;
  county: string;
  mag: number;
  park: string;
  lon: number;
  lat: number;
  xy: XY;
  phase: number;
}

async function main() {
  const [file, state, list] = await Promise.all([loadData<ParksFile>("parks.json"), loadData<StatewideFile>("statewide.json"), loadData<SpringsFile>("springs.json"), fontsReady()]);
  const unpack = (rings: number[][]) => unpackRings(rings, state.meta.coordOrigin, state.meta.coordScale);
  const land = ringsPath(unpack(state.land));
  const lakePath = new Path2D();
  const swampPath = new Path2D();
  for (const w of state.water) (w.kind === "lake" ? lakePath : swampPath).addPath(ringsPath(unpack(w.rings)));

  const parks: Park[] = file.parks.map((p) => {
    const rings = p.rings.map((r) => unpackDelta(r, file.meta));
    const pts = rings.flat();
    const xs = pts.map((q) => q[0]);
    const ys = pts.map((q) => q[1]);
    return { ...p, cls: PARK_WATER[p.water], slug: parkSlug(p.name), path: ringsPath(rings), box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], xy: project(...p.at) };
  });
  const bySlug = new Map(parks.map((p) => [p.slug, p]));
  // One path per class, built once in map units: the base layer redraws on every pan and zoom frame.
  const classPath = Object.fromEntries(PARK_WATER.map((c) => [c, new Path2D()])) as Record<ParkWater, Path2D>;
  for (const p of parks) classPath[p.cls].addPath(p.path);
  // Glints over every park with water, in its water's color.
  const glintsBy = new Map<ParkWater, Glint[]>();
  for (const c of PARK_WATER) {
    if (c === "land") continue;
    const inClass = file.parks.filter((p) => PARK_WATER[p.water] === c);
    glintsBy.set(c, placeGlints(inClass.map((p) => ({ km2: (p.acres / ACRES_PER_KM2) * GLINT_DENSITY, rings: p.rings.map((r) => unpackDelta(r, file.meta)) }))));
  }

  const springs: Spring[] = list.springs.map(([id, name, county, lon, lat, mag, , park], i) => ({ id, name, county, mag, park, lon, lat, xy: project(lon, lat), phase: (i * 0.618) % 1 }));
  // Springs in parks draw last, over their neighbors outside; big ones over small.
  springs.sort((a, b) => Number(!!a.park) - Number(!!b.park) || (b.mag || 9) - (a.mag || 9));
  const inParks = springs.filter((s) => s.park);
  const boiling = inParks.filter((s) => s.mag === 1);
  const springsOf = (p: Park) => inParks.filter((s) => s.park === p.name).sort((a, b) => (a.mag || 9) - (b.mag || 9) || a.name.localeCompare(b.name));

  let only: ParkWater | null = null;
  let C: Record<string, string> = {};
  let glow = true;
  const readColors = () => {
    C = Object.fromEntries(["bg", "ink", "muted", "spring", "sea", "shore", "marsh", "stream", "line"].map((n) => [n, cssVar(`--${n}`)]));
    for (const c of PARK_WATER) C[c] = cssVar(WATER[c].token);
    glow = isDark();
  };

  let journal: JournalOverlay | null = null;
  const card = new InfoCard();
  const view = new Viewport({
    minScale: 60,
    maxScale: 60000,
    padding: (w) => (w < 600 ? { x: 10, top: 10, bottom: 10 } : { x: 40, top: 40, bottom: 30 }),
    drawBase,
    onTap: tap,
  });
  const { X, Y } = view;
  const creeks = new CreekLayer(() => view.redraw());
  const inMap = (c: CanvasRenderingContext2D, draw: (s: number) => void) => {
    const { s, tx, ty } = view.cam;
    c.save();
    c.setTransform(view.DPR * s, 0, 0, view.DPR * s, view.DPR * tx, view.DPR * ty);
    draw(s);
    c.restore();
  };
  const zoom = () => Math.min(2.2, Math.max(1, Math.sqrt(view.scale / 700)));
  const radius = (s: Spring) => RADIUS[s.mag] * zoom();
  const small = (p: Park) => (p.box[2] - p.box[0]) * view.scale < MARKER_PX && (p.box[3] - p.box[1]) * view.scale < MARKER_PX;
  const dim = (c: ParkWater) => only !== null && c !== only;

  function drawBase() {
    const c = view.bctx;
    const { W, H } = view;
    c.setTransform(view.DPR, 0, 0, view.DPR, 0, 0);
    c.fillStyle = C.sea;
    c.fillRect(0, 0, W, H);
    inMap(c, (s) => {
      c.fillStyle = C.bg;
      c.fill(land, "evenodd");
      c.strokeStyle = C.shore;
      c.lineWidth = 0.8 / s;
      c.stroke(land);
      c.fillStyle = C.marsh;
      c.globalAlpha = 0.35;
      c.fill(swampPath, "evenodd");
      c.globalAlpha = 1;
      c.fillStyle = C.sea;
      c.fill(lakePath, "evenodd");
      c.stroke(lakePath);
      creeks.update([-view.cam.tx / s, -view.cam.ty / s, (W - view.cam.tx) / s, (H - view.cam.ty) / s], s);
      c.strokeStyle = C.stream;
      creeks.draw(c, s);
      // The parks: a wash of their water's color, and a firmer edge.
      c.lineWidth = 1.1 / s;
      for (const cls of PARK_WATER) {
        const faint = dim(cls);
        c.fillStyle = C[cls];
        c.globalAlpha = faint ? 0.06 : cls === "land" ? 0.16 : glow ? 0.26 : 0.3;
        c.fill(classPath[cls], "evenodd");
        c.strokeStyle = C[cls];
        c.globalAlpha = faint ? 0.15 : cls === "land" ? 0.55 : 0.9;
        c.stroke(classPath[cls]);
      }
      c.globalAlpha = 1;
    });
    // Parks too small to see at this zoom get a marker.
    c.lineWidth = 1.2;
    c.strokeStyle = C.bg;
    for (const p of parks) {
      if (!small(p)) continue;
      c.globalAlpha = dim(p.cls) ? 0.2 : 1;
      c.fillStyle = C[p.cls];
      c.beginPath();
      c.arc(X(p.xy[0]), Y(p.xy[1]), 3.2, 0, 7);
      c.fill();
      c.stroke();
    }
    c.globalAlpha = 1;
    c.font = "500 12px 'Barlow Semi Condensed',sans-serif";
    c.fillStyle = C.muted;
    for (const [n, lon, lat] of CITIES) {
      const p = project(lon, lat);
      c.fillText(n, X(p[0]) + 5, Y(p[1]) + 4);
    }
    if (view.scale > 2200) drawParkNames(c);
    // Springs: bright in a park, faint outside one. The parks' first-magnitude springs boil on the animated layer.
    for (const s of springs) {
      if (s.park && s.mag === 1) continue;
      c.fillStyle = s.park ? C.spring : C.muted;
      c.globalAlpha = s.park ? 0.9 : 0.45;
      c.beginPath();
      c.arc(X(s.xy[0]), Y(s.xy[1]), s.park ? radius(s) : radius(s) * 0.8, 0, 7);
      c.fill();
    }
    c.globalAlpha = 1;
    if (journal) drawJournal(c, journal, X, Y, springs, C.ink, glow);
  }

  /** Park names at their markers, biggest first, skipping any that would overlap one already placed. */
  function drawParkNames(c: CanvasRenderingContext2D) {
    const { W, H } = view;
    c.font = "italic 400 12.5px 'Spectral',serif";
    c.textAlign = "center";
    const placed: [number, number, number, number][] = [];
    for (const p of [...parks].sort((a, b) => b.acres - a.acres)) {
      if (dim(p.cls)) continue;
      const x = X(p.xy[0]);
      const y = Y(p.xy[1]) + (small(p) ? 15 : 4);
      if (x < -50 || x > W + 50 || y < 0 || y > H) continue;
      const label = shortName(p.name);
      const w = c.measureText(label).width;
      const r: [number, number, number, number] = [x - w / 2 - 3, y - 11, x + w / 2 + 3, y + 4];
      if (placed.some((q) => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1])) continue;
      placed.push(r);
      c.fillStyle = C.bg;
      c.globalAlpha = 0.65;
      c.fillRect(r[0], r[1], r[2] - r[0], r[3] - r[1]);
      c.globalAlpha = 1;
      c.fillStyle = C.ink;
      c.fillText(label, x, y);
    }
    c.textAlign = "left";
  }

  function draw() {
    const c = view.fctx;
    const { W, H } = view;
    c.setTransform(view.DPR, 0, 0, view.DPR, 0, 0);
    c.clearRect(0, 0, W, H);
    const now = performance.now() / 1000;
    // Glints, batched by class and brightness: most are dark at any moment.
    const size = Math.min(2.4, Math.max(1.1, Math.sqrt(view.scale / 700)));
    for (const [cls, glints] of glintsBy) {
      if (dim(cls)) continue;
      const lit = [new Path2D(), new Path2D(), new Path2D()];
      for (const g of glints) {
        const a = glintAlpha(g, now);
        if (a < 0.04) continue;
        const x = X(g.xy[0]);
        const y = Y(g.xy[1]);
        if (x < -4 || y < -4 || x > W + 4 || y > H + 4) continue;
        const b = a > 0.6 ? 2 : a > 0.25 ? 1 : 0;
        lit[b].rect(x - size / 2, y - size / 2, size, size);
        if (b === 2) {
          lit[0].rect(x - size * 1.8, y - 0.35, size * 3.6, 0.7);
          lit[0].rect(x - 0.35, y - size * 1.8, 0.7, size * 3.6);
        }
      }
      c.fillStyle = C[cls];
      [0.35, 0.65, 0.95].forEach((alpha, b) => {
        c.globalAlpha = alpha;
        c.fill(lit[b]);
      });
    }
    c.globalAlpha = 1;
    for (const s of boiling) {
      const x = X(s.xy[0]);
      const y = Y(s.xy[1]);
      if (x < -10 || y < -10 || x > W + 10 || y > H + 10) continue;
      drawBoil(c, x, y, radius(s), s.phase, now, C.spring);
    }
  }

  // ---------- cards ----------
  function showPark(p: Park) {
    const acres = `<b>${p.acres.toLocaleString()}</b> acres.`;
    const kinds = p.kinds.length
      ? ` Its water on FDEP's map of the park's natural communities: ${p.kinds.map(([k, a], i) => `${a.toLocaleString()} ${i ? "" : "acres "}of ${escapeHtml(k)}`).join(", ")}.`
      : "";
    const own = springsOf(p);
    let springText = "";
    if (own.length) {
      const named = own.slice(0, 5).map((s) => `${escapeHtml(s.name)}${s.mag === 1 ? " (first magnitude)" : ""}`);
      const more = own.length - named.length;
      springText = ` It holds ${own.length === 1 ? "one of FDEP's springs" : `${own.length} of FDEP's springs`}: ${named.join(", ")}${more ? `, and ${more} more` : ""}.`;
    }
    const note = NOTES[p.name] ? ` ${NOTES[p.name]}` : "";
    const plan = PLAN_2024.has(p.name) ? ` ${PLAN_TEXT}` : "";
    const [lon, lat] = p.at;
    const links = [
      p.url ? `<a href="${escapeHtml(p.url)}" rel="noopener">Its page at Florida State Parks</a>` : "",
      ...(MAP_LINKS[p.name] ?? []).map(([href, label]) => `<a href="${href}">${label}</a>`),
      `<a href="rain.html#${lon},${lat}">Where its rain goes</a>`,
    ].filter(Boolean);
    card.show({
      title: p.name,
      kind: `${WATER[p.cls].name} · ${counties(p.county)}`,
      color: C[p.cls],
      body: `${acres}${kinds}${springText}${note}${plan}<span class="links">${links.join(" · ")}</span>`,
    });
  }

  function showSpring(s: Spring) {
    const home = s.park ? `In <a href="#${parkSlug(s.park)}">${escapeHtml(s.park)}</a>. ` : "Not in a state park. ";
    const log = journal ? ` ${journalCardHtml(journal, s.id)}` : "";
    card.show({
      title: s.name,
      kind: `Spring · ${s.county} County`,
      body: `${home}${MAG_TEXT[s.mag] ?? ""}${s.mag ? "" : "FDEP hasn't rated its flow. "}<span class="links"><a href="rain.html#${s.lon},${s.lat}">Where its creek's rain goes</a></span>${log}`,
    });
  }

  const probe = document.createElement("canvas").getContext("2d")!;
  function tap(x: number, y: number) {
    const seen = journal ? hitSighting(journal, X, Y, x, y) : null;
    if (seen) return card.show(sightingCard(seen));
    let best: (() => void) | null = null;
    let bd = 14 * 14;
    const test = (xy: XY, f: () => void) => {
      const d = (X(xy[0]) - x) ** 2 + (Y(xy[1]) - y) ** 2;
      if (d < bd) {
        bd = d;
        best = f;
      }
    };
    for (const s of springs) test(s.xy, () => showSpring(s));
    for (const p of parks) if (small(p) && !dim(p.cls)) test(p.xy, () => showPark(p));
    if (best) return (best as () => void)();
    const m: XY = [(x - view.cam.tx) / view.cam.s, (y - view.cam.ty) / view.cam.s];
    // The smallest park under the tap: some sit inside bigger ones.
    const hit = parks
      .filter((p) => !dim(p.cls) && m[0] >= p.box[0] && m[0] <= p.box[2] && m[1] >= p.box[1] && m[1] <= p.box[3] && probe.isPointInPath(p.path, m[0], m[1], "evenodd"))
      .sort((a, b) => a.acres - b.acres)[0];
    if (hit) return showPark(hit);
    card.hide();
  }

  /** Fly to a park, fitting it into the space above its card. */
  function goTo(p: Park) {
    const w = Math.max(p.box[2] - p.box[0], 0.02);
    const h = Math.max(p.box[3] - p.box[1], 0.02);
    const s = Math.min(view.W * 0.8 / w, view.H * 0.38 / h, 40000);
    view.flyTo([(p.box[0] + p.box[2]) / 2, (p.box[1] + p.box[3]) / 2], s);
    showPark(p);
  }

  // ---------- lede ----------
  const count = (c: ParkWater) => parks.filter((p) => p.cls === c).length;
  const bigIn = parks.reduce((n, p) => n + p.big, 0);
  const totalAcres = parks.reduce((n, p) => n + p.acres, 0);
  document.getElementById("lede")!.innerHTML =
    `Florida's <b>${parks.length}</b> state parks, trails, and historic sites, about ${Math.round(totalAcres / 1000).toLocaleString()},000 acres, shaded by the water each one protects. ` +
    `They hold <b>${inParks.length}</b> of the ${springs.length} springs FDEP lists, and <b>${bigIn}</b> of its ${file.firstMagnitude} first-magnitude springs (a spring's vents counted once). ` +
    `Only ${count("reef")} hold living reef. Tap a park or a spring.`;

  // ---------- controls ----------
  document.getElementById("bAll")!.addEventListener("click", () => view.fit(VIEWS.all, true));
  const pick = document.getElementById("view") as HTMLSelectElement;
  pick.addEventListener("change", () => {
    const b = VIEWS[pick.value as keyof typeof VIEWS];
    if (b) view.fit(b, true);
    pick.value = "";
  });
  const water = document.getElementById("water") as HTMLSelectElement;
  for (const c of PARK_WATER) {
    const o = document.createElement("option");
    o.value = c;
    o.textContent = `${WATER[c].name} (${count(c)})`;
    water.appendChild(o);
  }
  water.addEventListener("change", () => {
    only = (water.value || null) as ParkWater | null;
    card.hide();
    view.redraw();
  });
  const names = document.getElementById("parkList")!;
  for (const p of parks) {
    const o = document.createElement("option");
    o.value = p.name;
    names.appendChild(o);
  }
  const find = document.getElementById("find") as HTMLInputElement;
  find.addEventListener("change", () => {
    const p = parks.find((q) => q.name === find.value);
    if (!p) return;
    history.replaceState(null, "", `#${p.slug}`);
    goTo(p);
    find.blur();
  });
  // A park named in the URL (from a spring's card on another map): go there.
  const fromHash = () => {
    const p = bySlug.get(decodeURIComponent(location.hash.slice(1)));
    if (p) goTo(p);
  };
  addEventListener("hashchange", fromHash);

  // ---------- boot ----------
  readColors();
  view.resize();
  view.fit(VIEWS.all);
  if (bySlug.has(decodeURIComponent(location.hash.slice(1)))) fromHash();
  if (view.reduceMotion) draw();
  else
    startLoop((_dt, t) => {
      view.tick(t);
      draw();
    });
  addEventListener("resize", () => {
    view.resize();
    view.fit(VIEWS.all);
  });
  onColorSchemeChange(() => {
    readColors();
    view.redraw();
  });
  void creeks.load().catch((err) => console.warn("Creeks unavailable", err));
  void loadJournalOverlay().then((o) => {
    if (!o) return;
    journal = o;
    view.redraw();
  });
}

main().catch(showLoadError);
