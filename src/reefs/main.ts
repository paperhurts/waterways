import "../shared/map.css";
import "../shared/nav";
import "../shared/story.css";
import "./reefs.css";
import { unpackDelta } from "../rain/network";
import { InfoCard } from "../shared/card";
import { escapeHtml, loadData, showLoadError } from "../shared/data";
import { project, ringsPath, type XY } from "../shared/geo";
import { renderHistory } from "../shared/history";
import { drawJournal, hitSighting, loadJournalOverlay, sightingCard, type JournalOverlay } from "../shared/journal-overlay";
import { KIND_LABEL, osmUrl, snorkelSpots } from "../shared/snorkel";
import { cssVar, fontsReady, isDark, onColorSchemeChange } from "../shared/theme";
import { REEF_STATIONS, type ReefHeat, type ReefStation, type ReefsFile, type Snapshot } from "../shared/types";
import { Viewport, startLoop } from "../shared/viewport";
import {
  ARTIFICIAL_TEXT, HARDBOTTOM_TEXT, LEVEL_SHORT, LEVEL_TEXT, LOSS, PATCH_TEXT, REEF_TEXT, SEAGRASS_TEXT, STATION_NAME, TOWNS, VIEWS, WORM_REEF_TEXT, tierOf,
} from "./content";

/** Snorkel spots on the reef, not in the lagoons or springs. */
const REEF_KINDS = new Set(["reef", "offshore", "park", "island", "beach", "inlet"]);
/** Glints show a region's heat: how sharp each flash is (higher is rarer), by color step. */
const SHARPNESS = [60, 26, 14, 8];
/** One glint per this many km² of reef polygon, on top of one per patch reef. */
const KM2_PER_REEF_GLINT = 0.25;

interface Glint {
  xy: XY;
  station: ReefStation;
  phase: number;
  speed: number;
}

/** A small seeded random number generator (mulberry32), so the glints sit still between visits. */
function seeded(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function main() {
  const [data, snapshot] = await Promise.all([loadData<ReefsFile>("reefs.json"), loadData<Snapshot>("snapshot.json"), fontsReady()]);
  const pack = data.meta;
  const rings = (rs: number[][]) => rs.map((r) => unpackDelta(r, pack));
  const pts = (flat: number[]) => unpackDelta(flat, pack);
  const sea = ringsPath(rings(data.sea));
  const seagrass = ringsPath(rings(data.habitat.seagrass));
  const hardbottom = ringsPath(rings(data.habitat.hardbottom));
  const reef = Object.fromEntries(REEF_STATIONS.map((k) => [k, rings(data.habitat.reef[k])])) as Record<ReefStation, XY[][]>;
  const reefPath = Object.fromEntries(REEF_STATIONS.map((k) => [k, ringsPath(reef[k])])) as Record<ReefStation, Path2D>;
  const patches = REEF_STATIONS.flatMap((k) => pts(data.habitat.patches[k]).map((xy) => ({ xy, station: k })));
  const artificial = REEF_STATIONS.flatMap((k) => pts(data.habitat.artificial[k]));
  const regions = data.regions.map((r) => ({ ...r, path: ringsPath(rings(r.rings)) }));
  // The reef runs down the east coast and out the Keys: leave out the Gulf coast's beaches.
  const spots = snorkelSpots.filter((s) => REEF_KINDS.has(s.kind) && s.lat < 27.3 && (s.lon > -80.6 || s.lat < 25.6)).map((s) => ({ ...s, xy: project(s.lon, s.lat) }));
  const heat: Partial<Record<ReefStation, ReefHeat>> = snapshot.reef ?? {};

  // Glints: every patch reef, plus points scattered over the reef tract's polygons.
  const rand = seeded(2023);
  const probe = document.createElement("canvas").getContext("2d")!;
  const glints: Glint[] = patches.map((p) => ({ xy: p.xy, station: p.station, phase: rand() * Math.PI * 2, speed: 0.5 + rand() }));
  for (const k of REEF_STATIONS) {
    for (const ring of reef[k]) {
      const xs = ring.map((q) => q[0]);
      const ys = ring.map((q) => q[1]);
      const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      // Map units are about 111 km: area in km² from the ring's box, roughly.
      const want = Math.min(40, Math.round(((x1 - x0) * (y1 - y0) * 111 * 111) / KM2_PER_REEF_GLINT));
      for (let n = 0, tries = 0; n < want && tries < want * 8; tries++) {
        const xy: XY = [x0 + rand() * (x1 - x0), y0 + rand() * (y1 - y0)];
        if (!probe.isPointInPath(reefPath[k], xy[0], xy[1], "evenodd")) continue;
        glints.push({ xy, station: k, phase: rand() * Math.PI * 2, speed: 0.5 + rand() });
        n++;
      }
    }
  }

  // ---------- colors ----------
  let C: Record<string, string> = {};
  let glow = true;
  const readColors = () => {
    C = Object.fromEntries(["bg", "ink", "muted", "sea", "shore", "coral", "atl", "chart-lake", "heat-1", "heat-2", "heat-3"].map((n) => [n, cssVar(`--${n}`)]));
    glow = isDark();
  };
  const tier = (k: ReefStation) => tierOf(heat[k]?.level ?? 0);
  const tierColor = (t: number) => [C.atl, C["heat-1"], C["heat-2"], C["heat-3"]][t];

  // ---------- map ----------
  let histMode = false;
  const card = new InfoCard();
  const view = new Viewport({
    minScale: 120,
    maxScale: 60000,
    padding: (w) => (w < 600 ? { x: 14, top: histMode ? 14 : 70, bottom: 16 } : { x: 50, top: 50, bottom: 40 }),
    drawBase,
    onTap: tap,
  });
  const { X, Y } = view;
  let journal: JournalOverlay | null = null;

  function drawBase() {
    const c = view.bctx;
    const { W, H } = view;
    const { s, tx, ty } = view.cam;
    c.setTransform(view.DPR, 0, 0, view.DPR, 0, 0);
    c.fillStyle = C.bg;
    c.fillRect(0, 0, W, H);
    c.save();
    c.setTransform(view.DPR * s, 0, 0, view.DPR * s, view.DPR * tx, view.DPR * ty);
    c.fillStyle = C.sea;
    c.fill(sea, "evenodd");
    c.globalAlpha = 0.35;
    c.fillStyle = C["chart-lake"];
    c.fill(seagrass, "evenodd");
    c.globalAlpha = 0.3;
    c.fillStyle = C.coral;
    c.fill(hardbottom, "evenodd");
    c.globalAlpha = 0.9;
    for (const k of REEF_STATIONS) c.fill(reefPath[k], "evenodd");
    c.restore();

    // Patch reefs: specks of coral at a fixed size on screen.
    const r = Math.min(2.2, Math.max(0.8, Math.sqrt(s / 1500)));
    c.fillStyle = C.coral;
    c.globalAlpha = 0.8;
    c.beginPath();
    for (const p of patches) {
      const x = X(p.xy[0]);
      const y = Y(p.xy[1]);
      if (x > -4 && y > -4 && x < W + 4 && y < H + 4) c.rect(x - r / 2, y - r / 2, r, r);
    }
    c.fill();
    c.fillStyle = C.muted;
    c.beginPath();
    for (const xy of artificial) {
      const x = X(xy[0]);
      const y = Y(xy[1]);
      if (x > -4 && y > -4 && x < W + 4 && y < H + 4) c.rect(x - 1, y - 1, 2, 2);
    }
    c.fill();
    c.globalAlpha = 1;

    c.font = "500 12px 'Barlow Semi Condensed',sans-serif";
    c.fillStyle = C.muted;
    for (const [n, lon, lat] of TOWNS) {
      const p = project(lon, lat);
      c.fillText(n, X(p[0]) + 5, Y(p[1]) + 4);
    }
    if (journal) drawJournal(c, journal, X, Y, spots, C.ink, glow);
    // Snorkel spots on the reef: coral diamonds, as on the springs map.
    const z = Math.min(1.6, Math.max(1, Math.sqrt(s / 900)));
    c.fillStyle = C.coral;
    c.strokeStyle = C.bg;
    c.lineWidth = 1;
    for (const sp of spots) {
      const x = X(sp.xy[0]);
      const y = Y(sp.xy[1]);
      const d = 4.5 * z;
      c.beginPath();
      c.moveTo(x, y - d);
      c.lineTo(x + d, y);
      c.lineTo(x, y + d);
      c.lineTo(x - d, y);
      c.closePath();
      c.fill();
      c.stroke();
    }
  }

  // ---------- glints: the reef's heat now, region by region ----------
  function draw() {
    const c = view.fctx;
    const { W, H } = view;
    c.setTransform(view.DPR, 0, 0, view.DPR, 0, 0);
    c.clearRect(0, 0, W, H);
    const t = performance.now() / 1000;
    const size = Math.min(2.6, Math.max(1.2, Math.sqrt(view.scale / 800)));
    for (const k of REEF_STATIONS) {
      const tr = tier(k);
      const sharp = SHARPNESS[tr];
      const lit = new Path2D();
      const bright = new Path2D();
      for (const g of glints) {
        if (g.station !== k) continue;
        const a = Math.max(0, Math.sin(g.speed * t + g.phase)) ** sharp;
        if (a < 0.05) continue;
        const x = X(g.xy[0]);
        const y = Y(g.xy[1]);
        if (x < -4 || y < -4 || x > W + 4 || y > H + 4) continue;
        (a > 0.5 ? bright : lit).rect(x - size / 2, y - size / 2, size, size);
      }
      c.fillStyle = tierColor(tr);
      c.globalAlpha = 0.5;
      c.fill(lit);
      c.globalAlpha = 1;
      c.fill(bright);
    }
    c.globalAlpha = 1;
  }

  // ---------- cards ----------
  const heatLine = (k: ReefStation) => {
    const h = heat[k];
    if (!h) return "NOAA's heat stress reading didn't load.";
    return `NOAA's satellites put ${STATION_NAME[k]} at <b>${h.dhw.toFixed(1)} °C-weeks</b> of heat stress on ${new Date(`${h.date}T12:00`).toLocaleDateString([], { month: "short", day: "numeric" })}: ${LEVEL_TEXT[h.level]}. The water was ${h.sst.toFixed(1)} °C (${Math.round(h.sst * 1.8 + 32)} °F).`;
  };
  function tap(x: number, y: number) {
    const seen = journal ? hitSighting(journal, X, Y, x, y) : null;
    if (seen) return card.show(sightingCard(seen));
    const near = spots.map((s) => [s, (X(s.xy[0]) - x) ** 2 + (Y(s.xy[1]) - y) ** 2] as const).sort((a, b) => a[1] - b[1])[0];
    if (near && near[1] < 16 * 16) {
      const s = near[0];
      const worm = s.id === "bathtub-reef-beach--martin";
      return card.show({
        title: s.name,
        kind: worm ? "Worm reef · snorkel spot" : `Snorkel spot · ${s.county} County`,
        body: `${worm ? WORM_REEF_TEXT : `${KIND_LABEL[s.kind]}.`} <span class="links"><a href="${escapeHtml(osmUrl(s))}" rel="noopener">On OpenStreetMap</a></span>`,
      });
    }
    const m: XY = [(x - view.cam.tx) / view.cam.s, (y - view.cam.ty) / view.cam.s];
    const region = regions.find((r) => probe.isPointInPath(r.path, m[0], m[1], "evenodd"));
    const where = region ? `${region.name}. ` : "";
    const stationHere = region?.station;
    const extra = stationHere ? ` ${heatLine(stationHere)}` : "";
    for (const k of REEF_STATIONS) {
      if (probe.isPointInPath(reefPath[k], m[0], m[1], "evenodd")) return card.show({ title: "Coral reef", kind: `Reef tract · ${where}`.replace(/\. $/, ""), body: `${REEF_TEXT} ${heatLine(k)}` });
    }
    const patch = patches.find((p) => Math.hypot(X(p.xy[0]) - x, Y(p.xy[1]) - y) < 5);
    if (patch) return card.show({ title: "Patch reef", kind: region?.name ?? "Patch reef", body: `${PATCH_TEXT} ${heatLine(patch.station)}` });
    if (probe.isPointInPath(hardbottom, m[0], m[1], "evenodd")) return card.show({ title: "Hard bottom", kind: region?.name ?? "Hard bottom", body: `${HARDBOTTOM_TEXT}${extra}` });
    if (probe.isPointInPath(seagrass, m[0], m[1], "evenodd")) return card.show({ title: "Seagrass", kind: region?.name ?? "Seagrass", body: SEAGRASS_TEXT });
    const art = artificial.find((xy) => Math.hypot(X(xy[0]) - x, Y(xy[1]) - y) < 5);
    if (art) return card.show({ title: "Artificial reef", kind: region?.name ?? "Artificial reef", body: ARTIFICIAL_TEXT });
    if (region) return card.show({ title: region.name, kind: "Reef region", body: heatLine(region.station) });
    card.hide();
  }

  // ---------- chips + copy ----------
  function renderProfile() {
    const el = document.getElementById("profile")!;
    el.replaceChildren();
    for (const k of REEF_STATIONS) {
      const h = heat[k];
      const b = document.createElement("button");
      b.type = "button";
      b.className = "gauge heat";
      b.style.setProperty("--tier", `var(--heat-${Math.max(1, tierOf(h?.level ?? 0))})`);
      const v = document.createElement("div");
      v.className = "v";
      v.textContent = h ? h.dhw.toFixed(1) : "—";
      const u = document.createElement("small");
      u.textContent = "°C-wk";
      v.appendChild(u);
      const n = document.createElement("div");
      n.className = "n";
      n.textContent = `${k === "keys" ? "Florida Keys" : "Southeast Florida"}${h ? ` · ${LEVEL_SHORT[h.level]}` : ""}`;
      b.append(v, n);
      b.addEventListener("click", () => {
        view.fit(k === "keys" ? VIEWS.keys : VIEWS.southeast, true);
        card.show({ title: k === "keys" ? "Florida Keys" : "Southeast Florida", kind: "NOAA Coral Reef Watch", body: `${heatLine(k)} Degree Heating Weeks add up how far the water has run above the warmest month's normal over the last 12 weeks. At 8, bleaching starts killing corals; at 16, more than half; at 20, more than 80%.` });
      });
      el.appendChild(b);
    }
  }

  function renderCopy() {
    const k = heat.keys;
    const se = heat.southeast;
    const now = k
      ? `Right now NOAA's satellites put the Keys at <b>${k.dhw.toFixed(1)} °C-weeks</b> of heat stress, ${LEVEL_TEXT[k.level]}${se ? `, and Southeast Florida at <b>${se.dhw.toFixed(1)}</b>` : ""}. `
      : "";
    document.getElementById("lede")!.innerHTML =
      `Florida's Coral Reef runs about ${LOSS.miles} miles from the St. Lucie Inlet to the Dry Tortugas, the only one of its kind off the continental US. ` +
      `Its builders are gone: pillar coral was declared functionally extinct here in ${LOSS.pillar}, and staghorn and elkhorn after the ${LOSS.acropora} marine heat wave, when the water passed 90 °F. ` +
      now +
      "Tap anything on the map.";
    document.getElementById("status")!.textContent =
      `Heat stress: NOAA Coral Reef Watch${k ? `, ${k.date}` : ""}, from satellites, refreshed with every deploy. Habitat: FWC FWRI's Unified Florida Reef Map. Coastline: US Census Bureau. Snorkel spots: OpenStreetMap contributors.`;
  }

  // ---------- heat since 1985 ----------
  const hist = data.heat;
  function renderHist() {
    const keys = hist.keys;
    const before = Math.max(...hist.years.map((y, i) => (y < LOSS.diseaseFound ? keys[i] ?? 0 : 0)));
    const recent = hist.years.map((y, i) => [y, keys[i]] as const).filter(([y, v]) => y >= LOSS.acropora && v != null);
    const thisYear = new Date().getFullYear();
    document.getElementById("histRead")!.innerHTML =
      `Before ${LOSS.diseaseFound}, the Keys' worst year peaked at <b>${before.toFixed(1)}</b> °C-weeks. ` +
      `Since ${LOSS.acropora}, every year has passed 8, where heat starts killing corals: ${recent.map(([y, v]) => `${v!.toFixed(1)}${y === thisYear ? " so far this year" : ` in ${y}`}`).join(", ")}. ` +
      `Disease has been killing them too: stony coral tissue loss disease, first found off Miami in ${LOSS.diseaseFound}, had reached the whole reef by ${LOSS.diseaseEverywhere}. ` +
      `NOAA's Mission: Iconic Reefs is replanting seven Keys reefs: ${LOSS.iconic.slice(0, -1).join(", ")}, and ${LOSS.iconic[LOSS.iconic.length - 1]}.`;
    renderHistory(document.getElementById("histChart")!, hist.years, [
      { name: "Florida Keys", color: "--chart-tannin", values: hist.keys },
      { name: "Southeast Florida", color: "--chart-estuary", values: hist.southeast },
    ]);
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

  // ---------- boot ----------
  let paused = false;
  const bp = document.getElementById("bPause")!;
  const setPaused = (p: boolean) => {
    paused = p;
    bp.textContent = p ? "Play" : "Pause";
    bp.setAttribute("aria-pressed", String(p));
  };
  bp.addEventListener("click", () => setPaused(!paused));
  document.getElementById("bAll")!.addEventListener("click", () => view.fit(VIEWS.all, true));
  document.getElementById("bKeys")!.addEventListener("click", () => view.fit(VIEWS.keys, true));
  document.getElementById("bSoutheast")!.addEventListener("click", () => view.fit(VIEWS.southeast, true));
  document.getElementById("bTortugas")!.addEventListener("click", () => view.fit(VIEWS.tortugas, true));

  readColors();
  renderProfile();
  renderCopy();
  view.resize();
  view.fit(VIEWS.all);
  if (view.reduceMotion) {
    draw();
    setPaused(true);
  }
  startLoop((_dt, t) => {
    view.tick(t);
    if (!paused) draw();
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
  void loadJournalOverlay().then((o) => {
    if (!o) return;
    journal = o;
    view.redraw();
  });
}

main().catch(showLoadError);
