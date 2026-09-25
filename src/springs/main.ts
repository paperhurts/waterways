import "../shared/map.css";
import "../shared/nav";
import "./springs.css";
import { InfoCard } from "../shared/card";
import { escapeHtml, loadData, showLoadError } from "../shared/data";
import { bounds, project, ringsPath, unpackRings, type XY } from "../shared/geo";
import { drawJournal, hitSighting, journalCardHtml, loadJournalOverlay, sightingCard, type JournalOverlay } from "../shared/journal-overlay";
import { MAG_TEXT } from "../shared/magnitude";
import { KIND_LABEL, osmUrl, snorkelSprings, snorkelSpots } from "../shared/snorkel";
import { drawBoil } from "../shared/streaks";
import { cssVar, fontsReady, isDark, onColorSchemeChange } from "../shared/theme";
import type { SnorkelSpot, SpringsFile, StatewideFile } from "../shared/types";
import { Viewport, startLoop } from "../shared/viewport";

const VIEWS = {
  all: bounds(-87.6, 24.5, -79.9, 31.1),
  pan: bounds(-85.9, 29.9, -83.6, 31.0),
  suw: bounds(-83.5, 29.4, -82.3, 30.6),
  coast: bounds(-82.85, 28.3, -82.2, 29.25),
  ocala: bounds(-82.35, 28.8, -81.45, 29.5),
  stj: bounds(-81.75, 28.6, -81.1, 29.35),
  east: bounds(-80.55, 26.1, -79.95, 27.65),
  keys: bounds(-82.95, 24.4, -80.1, 25.6),
};

const CITIES: [string, number, number][] = [
  ["Pensacola", -87.217, 30.421], ["Panama City", -85.66, 30.159], ["Tallahassee", -84.28, 30.438], ["Jacksonville", -81.656, 30.332],
  ["Gainesville", -82.325, 29.652], ["Ocala", -82.14, 29.187], ["Orlando", -81.379, 28.538], ["Tampa", -82.458, 27.948], ["Miami", -80.19, 25.77],
];

/** Dot radius by FDEP magnitude class (index); unknown and small springs share the smallest. */
const RADIUS = [1.7, 4.2, 3, 2.2, 1.7, 1.7, 1.7, 1.7, 1.7];

interface Spring {
  id: string;
  name: string;
  county: string;
  lon: number;
  lat: number;
  mag: number;
  onRainMap: boolean;
  snorkel: boolean;
  xy: XY;
  phase: number;
}

interface Spot extends SnorkelSpot {
  xy: XY;
}

async function main() {
  const [file, state] = await Promise.all([loadData<SpringsFile>("springs.json"), loadData<StatewideFile>("statewide.json"), fontsReady()]);
  const unpack = (rings: number[][]) => unpackRings(rings, state.meta.coordOrigin, state.meta.coordScale);
  const land = ringsPath(unpack(state.land));
  const plans = state.plans.map((p) => ({ ...p, path: ringsPath(unpack(p.rings)), box: boxOf(unpack(p.rings)) }));
  const focus = state.focusAreas.map((p) => ({ ...p, path: ringsPath(unpack(p.rings)) }));
  const lagoons = state.lagoons.map((p) => ({ ...p, path: ringsPath(unpack(p.rings)) }));
  const springs: Spring[] = file.springs.map(([id, name, county, lon, lat, mag, onRainMap], i) => ({
    id, name, county, lon, lat, mag, onRainMap: !!onRainMap, snorkel: snorkelSprings.has(id), xy: project(lon, lat), phase: (i * 0.618) % 1,
  }));
  const spots: Spot[] = snorkelSpots.map((s) => ({ ...s, xy: project(s.lon, s.lat) }));
  // Big springs last, so they draw on top of their smaller neighbors.
  springs.sort((a, b) => (b.mag || 9) - (a.mag || 9));
  const big = (s: Spring) => s.mag === 1 || s.mag === 2;
  let bigOnly = false;
  let snorkelOnly = false;
  const shown = () => springs.filter((s) => (!bigOnly || big(s)) && (!snorkelOnly || s.snorkel));

  let C: Record<string, string> = {};
  let glow = true;
  const readColors = () => {
    C = Object.fromEntries(["bg", "ink", "muted", "spring", "under", "sea", "shore", "coral"].map((n) => [n, cssVar(`--${n}`)]));
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
  const inMap = (c: CanvasRenderingContext2D, draw: (s: number) => void) => {
    const { s, tx, ty } = view.cam;
    c.save();
    c.setTransform(view.DPR * s, 0, 0, view.DPR * s, view.DPR * tx, view.DPR * ty);
    draw(s);
    c.restore();
  };
  const radius = (s: Spring) => RADIUS[s.mag] * Math.min(2.2, Math.max(1, Math.sqrt(view.scale / 700)));

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
      // The Census outlines count some lagoons as land; NHD's shapes put the water back.
      c.fillStyle = C.sea;
      for (const l of lagoons) {
        c.fill(l.path, "evenodd");
        c.stroke(l.path);
      }
      c.fillStyle = C.under;
      for (const p of plans) {
        c.globalAlpha = glow ? 0.08 : 0.1;
        c.fill(p.path, "evenodd");
      }
      for (const p of focus) {
        c.globalAlpha = glow ? 0.12 : 0.14;
        c.fill(p.path, "evenodd");
      }
      c.globalAlpha = 0.6;
      c.strokeStyle = C.under;
      c.lineWidth = 1 / s;
      c.setLineDash([4 / s, 3 / s]);
      for (const p of plans) c.stroke(p.path);
    });
    c.font = "500 12px 'Barlow Semi Condensed',sans-serif";
    c.fillStyle = C.muted;
    for (const [n, lon, lat] of CITIES) {
      const p = project(lon, lat);
      c.fillText(n, X(p[0]) + 5, Y(p[1]) + 4);
    }
    // Plan names once zoomed in enough to read them against their areas.
    if (view.scale > 1500) {
      c.font = "italic 400 13px 'Spectral',serif";
      c.fillStyle = C.under;
      for (const p of plans) {
        const x = X((p.box[0] + p.box[2]) / 2);
        const y = Y(p.box[1]) + 16;
        if (x > 0 && x < W && y > 0 && y < H) c.fillText(p.name, x - c.measureText(p.name).width / 2, y);
      }
    }
    // Lagoon names, once zoomed in to where they read as water.
    if (view.scale > 700) {
      c.font = "italic 400 12px 'Spectral',serif";
      c.fillStyle = C.muted;
      for (const l of lagoons) {
        if (!l.label || (l.km2 < 40 && view.scale < 2500)) continue;
        const [lx, ly] = project(...l.label);
        const x = X(lx);
        const y = Y(ly);
        if (x > 0 && x < W && y > 0 && y < H) c.fillText(l.name, x + 6, y);
      }
    }
    // Small springs are static; the big ones boil on the animated layer.
    c.fillStyle = C.spring;
    for (const s of shown()) {
      if (big(s)) continue;
      c.globalAlpha = s.mag ? 0.85 : 0.55;
      c.beginPath();
      c.arc(X(s.xy[0]), Y(s.xy[1]), radius(s), 0, 7);
      c.fill();
    }
    c.globalAlpha = 1;
    // Snorkel springs wear a coral ring; the spots that aren't springs are coral diamonds.
    const z = Math.min(1.6, Math.max(1, Math.sqrt(view.scale / 900)));
    c.strokeStyle = C.coral;
    c.lineWidth = 1.5;
    for (const s of shown()) {
      if (!s.snorkel) continue;
      c.beginPath();
      c.arc(X(s.xy[0]), Y(s.xy[1]), radius(s) + 2.5 * z, 0, 7);
      c.stroke();
    }
    c.fillStyle = C.coral;
    c.strokeStyle = C.bg;
    c.lineWidth = 1;
    for (const s of spots) {
      const x = X(s.xy[0]);
      const y = Y(s.xy[1]);
      const r = 4 * z;
      c.beginPath();
      c.moveTo(x, y - r);
      c.lineTo(x + r, y);
      c.lineTo(x, y + r);
      c.lineTo(x - r, y);
      c.closePath();
      c.fill();
      c.stroke();
    }
    if (journal) drawJournal(c, journal, X, Y, [...springs, ...spots], C.ink, glow);
  }

  function draw() {
    const c = view.fctx;
    const { W, H } = view;
    c.setTransform(view.DPR, 0, 0, view.DPR, 0, 0);
    c.clearRect(0, 0, W, H);
    const now = performance.now() / 1000;
    for (const s of springs) {
      if (!big(s)) continue;
      const x = X(s.xy[0]);
      const y = Y(s.xy[1]);
      if (x < -10 || y < -10 || x > W + 10 || y > H + 10) continue;
      drawBoil(c, x, y, radius(s), s.phase, now, C.spring);
    }
  }

  // ---------- cards ----------
  function showSpring(s: Spring) {
    const links: string[] = [];
    if (s.onRainMap) links.push('<a href="rain.html">Where its creek\'s rain goes</a>');
    if (s.county === "Marion" && /^Rainbow/.test(s.name)) links.push('<a href="rainbow.html">The Rainbow River map</a>');
    const log = journal ? ` ${journalCardHtml(journal, s.id)}` : "";
    card.show({
      title: s.name,
      kind: `${s.snorkel ? "Spring · snorkel spot" : "Spring"} · ${s.county} County`,
      body: `${MAG_TEXT[s.mag] ?? ""}${s.mag ? "" : "FDEP hasn't rated its flow. "}${links.length ? `<span class="links">${links.join(" · ")}</span>` : ""}${log}`,
    });
  }

  function showSpot(s: Spot) {
    const links = [s.web ? `<a href="${escapeHtml(s.web)}" rel="noopener">Website</a>` : "", `<a href="${escapeHtml(osmUrl(s))}" rel="noopener">On OpenStreetMap</a>`].filter(Boolean);
    const log = journal ? ` ${journalCardHtml(journal, s.id)}` : "";
    card.show({ title: s.name, kind: `Snorkel spot · ${s.county} County`, body: `${KIND_LABEL[s.kind]}.<span class="links">${links.join(" · ")}</span>${log}` });
  }

  function showLagoon(l: (typeof lagoons)[number]) {
    const extra = l.name === "Indian River Lagoon" ? ' <span class="links"><a href="st-lucie.html">Where the St. Lucie meets it</a> · <a href="rain.html">Where its creeks come from</a></span>' : "";
    card.show({ title: l.name, kind: "Coastal lagoon", body: `About ${Math.round(l.km2 / 2.59).toLocaleString()} square miles of shallow, brackish water behind barrier islands, open to the sea through inlets.${extra}` });
  }

  const probe = document.createElement("canvas").getContext("2d")!;
  function tap(x: number, y: number) {
    const seen = journal ? hitSighting(journal, X, Y, x, y) : null;
    if (seen) return card.show(sightingCard(seen));
    let best: (() => void) | null = null;
    let bd = 16 * 16;
    const test = (xy: XY, f: () => void) => {
      const d = (X(xy[0]) - x) ** 2 + (Y(xy[1]) - y) ** 2;
      if (d < bd) {
        bd = d;
        best = f;
      }
    };
    for (const s of shown()) test(s.xy, () => showSpring(s));
    for (const s of spots) test(s.xy, () => showSpot(s));
    if (best) return (best as () => void)();
    const m: XY = [(x - view.cam.tx) / view.cam.s, (y - view.cam.ty) / view.cam.s];
    const l = lagoons.find((p) => probe.isPointInPath(p.path, m[0], m[1], "evenodd"));
    if (l) return showLagoon(l);
    const f = focus.find((p) => probe.isPointInPath(p.path, m[0], m[1], "evenodd"));
    if (f) {
      card.show({ title: f.name, kind: "Priority focus area", body: `About ${Math.round(f.km2 / 2.59).toLocaleString()} square miles where the aquifer is most vulnerable and what soaks in reaches the springs fastest. Florida's springs law focuses its protections here.` });
      return;
    }
    const p = plans.find((q) => probe.isPointInPath(q.path, m[0], m[1], "evenodd"));
    if (p) {
      card.show({ title: p.name, kind: "Springs cleanup plan area", body: `About ${Math.round(p.km2 / 2.59).toLocaleString()} square miles that FDEP's basin management action plan covers, drawn around the springshed. Rain that soaks in here can reach these springs, so the plan works to cut the nitrogen that gets into the groundwater.` });
      return;
    }
    card.hide();
  }

  // ---------- controls ----------
  document.getElementById("lede")!.innerHTML =
    `FDEP maps <b>${springs.length}</b> springs. Most sit in a band from the Panhandle through the Big Bend to Orlando, where the Floridan aquifer lies close to the surface. ` +
    `The shaded areas are covered by the state's <b>${plans.length}</b> springs cleanup plans, drawn around the springsheds of its Outstanding Florida Springs. ` +
    `Coral marks <b>${snorkelSprings.size + spots.length}</b> places to snorkel, springs and not, from the Panhandle to the Keys. Tap anything.`;

  const bSnorkel = document.getElementById("bSnorkel")!;
  bSnorkel.addEventListener("click", () => {
    snorkelOnly = !snorkelOnly;
    bSnorkel.setAttribute("aria-pressed", String(snorkelOnly));
    view.redraw();
  });
  const bBig = document.getElementById("bBig")!;
  bBig.addEventListener("click", () => {
    bigOnly = !bigOnly;
    bBig.setAttribute("aria-pressed", String(bigOnly));
    view.redraw();
  });
  document.getElementById("bAll")!.addEventListener("click", () => view.fit(VIEWS.all, true));
  const pick = document.getElementById("view") as HTMLSelectElement;
  pick.addEventListener("change", () => {
    const b = VIEWS[pick.value as keyof typeof VIEWS];
    if (b) view.fit(b, true);
    pick.value = "";
  });

  // Search: one option per spring and snorkel spot, with its county, since names repeat ("Blue Spring").
  const places = [
    ...springs.map((s) => ({ label: `${s.name} (${s.county})`, xy: s.xy, show: () => showSpring(s) })),
    ...spots.map((s) => ({ label: `${s.name} (${s.county})`, xy: s.xy, show: () => showSpot(s) })),
  ];
  const list = document.getElementById("springList")!;
  for (const p of [...places].sort((a, b) => a.label.localeCompare(b.label))) {
    const o = document.createElement("option");
    o.value = p.label;
    list.appendChild(o);
  }
  const find = document.getElementById("find") as HTMLInputElement;
  find.addEventListener("change", () => {
    const p = places.find((x) => x.label === find.value);
    if (!p) return;
    view.flyTo(p.xy, 9000);
    p.show();
    find.blur();
  });

  // ---------- boot ----------
  readColors();
  view.resize();
  view.fit(VIEWS.all);
  if (view.reduceMotion) draw();
  else startLoop((_dt, t) => {
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
  void loadJournalOverlay().then((o) => {
    if (!o) return;
    journal = o;
    view.redraw();
  });
}

function boxOf(rings: XY[][]): [number, number, number, number] {
  const pts = rings.flat();
  return [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
}

main().catch(showLoadError);
