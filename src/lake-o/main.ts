import "../shared/map.css";
import "../shared/nav";
import "../shared/story.css";
import "./lake-o.css";
import gaugeConfig from "../../config/gauges.json";
import { InfoCard, type CardContent } from "../shared/card";
import { loadData, showLoadError } from "../shared/data";
import { nearestDistance, pointAt, polyline, project, ringsPath, type Polyline, type XY } from "../shared/geo";
import { renderHistory } from "../shared/history";
import { drawJournal, hitSighting, loadJournalOverlay, sightingCard, type JournalOverlay } from "../shared/journal-overlay";
import { decodeLakes, drawLakeLabels, drawLakes } from "../shared/lakes";
import { STALE_MS, fetchLatest, fmtCfs } from "../shared/live";
import { StreakLayer, fadeLayer } from "../shared/streaks";
import { cssVar, fontsReady, isDark, onColorSchemeChange } from "../shared/theme";
import { LAKEO_KEYS, type GaugeConfig, type LakeOFile, type LakeOFlows, type LakesFile, type Snapshot } from "../shared/types";
import { Viewport, startLoop } from "../shared/viewport";
import { BACKFLOW_TEXT, CALOOSAHATCHEE_TEXT, FISHEATING_TEXT, KISSIMMEE_TEXT, LAKE, SOUTH_TEXT, ST_LUCIE_TEXT, TOWNS, VIEWS, WPB_TEXT } from "./content";
import { MODERN, caloosahatcheeRunoff, directions, summarize, type Direction } from "./flow";

/** Drops spawned per cfs per second on the canals and creeks. */
const K = 0.03;
/** Lake-water drops started per cfs of outflow per second, drifting across the lake to the gates. */
const DRIFT_K = 0.012;
/** How fast lake water drifts (map units a second). */
const DRIFT_SPEED = 0.03;
const MAX_DROPS = 20000;
/** Drops fade over this much of a canal or the lake (map units, ~3 km) at the ends of their run. */
const FADE = 0.03;
/** Water running back into the lake comes from this far down its canal (map units, ~15 km). */
const BACK_REACH = 0.14;
/** Readings are drawn on the map only at this zoom (pixels per map unit) or closer. */
const LABEL_SCALE = 700;

type Key = keyof LakeOFlows;
type Line = Polyline & { name: string };
type Color = "l" | "b";

interface Gauge extends GaugeConfig {
  key: Key;
  cfs: number | null;
  xy: XY;
}

/** A gauged way out of the lake: its canal, drawn from the lake outward, and the gauge on it. */
interface Outlet {
  key: Key;
  line: Line;
  dir: Direction;
  /** The gauge's distance along the canal. */
  d0: number;
  acc: number;
}

interface Drop {
  line: Line;
  d: number;
  /** -1 runs back toward the lake. */
  dir: 1 | -1;
  col: Color;
  off: number;
  /** Fades out past here, going the way it runs. */
  end: number;
}

/** Lake water drifting to a gate, along a gentle curve. */
interface Drift {
  a: XY;
  c: XY;
  b: XY;
  u: number;
  du: number;
}

const LABEL_AT: Record<Key, [number, number, CanvasTextAlign]> = {
  S308: [8, 16, "left"],
  S77: [-8, -6, "right"],
  S79: [8, -6, "left"],
  S351H: [8, 4, "left"],
  S351N: [-8, 14, "right"],
  S354: [-8, -6, "right"],
  FEC: [8, -6, "left"],
};

const WAYS: Record<Direction, { out: string; in: string }> = {
  west: { out: "west down the Caloosahatchee", in: "from the Caloosahatchee" },
  east: { out: "east down the St. Lucie Canal", in: "from the St. Lucie Canal" },
  south: { out: "south into the farm canals toward the Everglades", in: "from the farm canals to the south" },
};

const timeFmt = (d: Date) => d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

async function main() {
  const [data, snapshot] = await Promise.all([loadData<LakeOFile>("lake-o.json"), loadData<Snapshot>("snapshot.json"), fontsReady()]);
  const water = decodeLakes({ meta: data.meta, bodies: data.water } as LakesFile);
  const lake = water.find((b) => b.name === LAKE.name)!;
  const lakePath = ringsPath(lake.rings);
  const probe = document.createElement("canvas").getContext("2d")!;
  const inLake = (xy: XY) => probe.isPointInPath(lakePath, xy[0], xy[1], "evenodd");

  // ---------- geometry ----------
  const keys: Key[] = ["S308", ...LAKEO_KEYS];
  const gauges: Gauge[] = (gaugeConfig as GaugeConfig[])
    .filter((g): g is GaugeConfig & { key: Key } => (keys as string[]).includes(g.key))
    .map((g) => ({ ...g, cfs: null, xy: project(g.lon, g.lat) }));
  const G = (key: Key) => gauges.find((g) => g.key === key)!;
  const line = (name: string, lead: XY[] = []): Line => ({ ...polyline([...lead, ...data.rivers[name].p.map(([x, y]) => project(x, y))]), name });
  const KISS = line("Kissimmee River");
  const FEC = line("Fisheating Creek");
  const CAL = line("Caloosahatchee River");
  const STL = line("Saint Lucie Canal");
  // NHD's Miami Canal path starts a few miles south of the lake; run it up to S-354.
  const MIAMI = line("Miami Canal", [G("S354").xy]);
  const NNR = line("North New River Canal");
  const HILLS = line("Hillsboro Canal");
  const WPB = line("West Palm Beach Canal");
  const at = (l: Line, key: Key) => nearestDistance(l, ...G(key).xy);
  const outlets: Outlet[] = [
    { key: "S308", line: STL, dir: "east", d0: at(STL, "S308"), acc: Math.random() },
    { key: "S77", line: CAL, dir: "west", d0: at(CAL, "S77"), acc: Math.random() },
    { key: "S351H", line: HILLS, dir: "south", d0: at(HILLS, "S351H"), acc: Math.random() },
    { key: "S351N", line: NNR, dir: "south", d0: at(NNR, "S351N"), acc: Math.random() },
    { key: "S354", line: MIAMI, dir: "south", d0: 0, acc: Math.random() },
  ];
  const d79 = at(CAL, "S79");
  const dPalmdale = at(FEC, "FEC");

  // ---------- flows ----------
  const current = Object.fromEntries(keys.map((k) => [k, snapshot.cfs[k as keyof Snapshot["cfs"]] ?? null])) as LakeOFlows;
  let liveTime: Date | null = null;
  const liveMeta = new Map<string, { time: Date; stale: boolean }>();
  let ways = directions(current);
  let runoff = 0;
  const acc = { cal: Math.random(), fec: Math.random(), drift: Math.random() };

  function setFlows(f: LakeOFlows) {
    for (const g of gauges) g.cfs = f[g.key];
    ways = directions(f);
    runoff = caloosahatcheeRunoff(f);
  }

  // ---------- rendering ----------
  let C: Record<string, string> = {};
  let glow = true;
  const readColors = () => {
    C = Object.fromEntries(["bg", "ink", "muted", "tannin", "lakewater", "atl", "gulf", "river", "sea", "lake", "shore", "marsh"].map((n) => [n, cssVar(`--${n}`)]));
    C.l = C.lakewater;
    C.b = C.tannin;
    glow = isDark();
  };

  let histMode = false;
  const card = new InfoCard();
  const view = new Viewport({
    minScale: 120,
    maxScale: 40000,
    padding: (w) => (w < 600 ? { x: 14, top: histMode ? 14 : 60, bottom: 16 } : { x: 60, top: 60, bottom: 50 }),
    drawBase,
    onTap: tap,
  });
  const { X, Y } = view;
  const path = (c: CanvasRenderingContext2D, p: XY[]) => {
    c.beginPath();
    p.forEach((q, i) => (i ? c.lineTo(X(q[0]), Y(q[1])) : c.moveTo(X(q[0]), Y(q[1]))));
  };

  let journal: JournalOverlay | null = null;
  let showJournal = true;

  function drawBase() {
    const c = view.bctx;
    const { W, H } = view;
    c.setTransform(view.DPR, 0, 0, view.DPR, 0, 0);
    c.fillStyle = C.bg;
    c.fillRect(0, 0, W, H);
    drawLakes(c, water, X, Y, view.cam, { sea: C.sea, lake: C.lake, shore: C.shore, marsh: C.marsh, label: C.muted });

    c.lineCap = "round";
    c.lineJoin = "round";
    c.strokeStyle = C.river;
    for (const [l, w] of [[FEC, 1.4], [KISS, 1.8], [WPB, 1.6], [MIAMI, 1.8], [NNR, 1.8], [HILLS, 1.8], [STL, 2.2], [CAL, 2.6]] as const) {
      c.lineWidth = w;
      path(c, l.pts);
      c.stroke();
    }

    c.font = "500 12px 'Barlow Semi Condensed',sans-serif";
    for (const [n, lon, lat] of TOWNS) {
      const p = project(lon, lat);
      const y = Y(p[1]);
      if (y < 60) continue;
      c.fillStyle = C.muted;
      c.globalAlpha = 0.9;
      c.fillText(n, X(p[0]) + 4, y);
      c.globalAlpha = 1;
    }
    const label = (t: string, lon: number, lat: number, col: string, font = "italic 400 12px 'Spectral',serif") => {
      const p = project(lon, lat);
      c.font = font;
      c.fillStyle = col;
      c.fillText(t, X(p[0]), Y(p[1]));
    };
    /** A label for a big body of water, at the first of its spots where it fits on screen (a shorter name on phones). */
    const regionLabel = (full: string, short: string, spots: [number, number][], col: string) => {
      c.font = "italic 400 14px 'Spectral',serif";
      const t = W < 600 ? short : full;
      const w = c.measureText(t).width;
      for (const [lon, lat] of spots) {
        const p = project(lon, lat);
        const x = X(p[0]);
        const y = Y(p[1]);
        if (x < 4 || x + w > W - 4 || y < 70 || y > H - 4) continue;
        c.fillStyle = col;
        c.fillText(t, x, y);
        return;
      }
    };
    if (journal && showJournal) drawJournal(c, journal, X, Y, [], C.ink, glow);
    drawLakeLabels(c, water.filter((l) => l.name !== LAKE.name), X, Y, view.scale, C.muted, view.keyBoxes());
    regionLabel(LAKE.name, LAKE.name, [[-80.93, 27.07], [-80.92, 27.02]], C.l);
    regionLabel("Gulf of Mexico", "Gulf", [[-82.15, 26.35], [-82.0, 26.3], [-81.95, 26.4]], C.gulf);
    regionLabel("Atlantic Ocean", "Atlantic", [[-80.02, 27.0], [-80.1, 27.3], [-80.0, 26.6]], C.atl);
    label("Everglades", -80.55, 26.33, C.muted, "italic 400 14px 'Spectral',serif");
    label("Kissimmee River", -81.02, 27.36, C.muted);
    label("Fisheating Creek", -81.47, 27.0, C.muted);
    label("Caloosahatchee River", -81.6, 26.69, C.muted);
    if (view.scale > 900) {
      label("St. Lucie Canal", -80.5, 27.035, C.muted);
      label("Everglades Agricultural Area", -80.86, 26.56, C.muted);
      label("Miami Canal", -80.84, 26.45, C.muted);
      label("North New River Canal", -80.62, 26.45, C.muted);
      label("Hillsboro Canal", -80.42, 26.47, C.muted);
      label("West Palm Beach Canal", -80.52, 26.8, C.muted);
    }

    const readable = view.scale >= LABEL_SCALE;
    for (const g of gauges) {
      const x = X(g.xy[0]);
      const y = Y(g.xy[1]);
      c.fillStyle = C.bg;
      c.strokeStyle = C.ink;
      c.lineWidth = 1.4;
      c.beginPath();
      c.rect(x - 4, y - 4, 8, 8);
      c.fill();
      c.stroke();
      if (!readable || g.cfs == null) continue;
      const [dx, dy, align] = LABEL_AT[g.key];
      c.font = "600 12px 'Barlow Semi Condensed',sans-serif";
      c.fillStyle = liveMeta.get(g.key)?.stale ? C.muted : C.ink;
      c.textAlign = align;
      c.fillText(`${fmtCfs(g.cfs)} cfs`, x + dx, y + dy);
      c.textAlign = "left";
    }
  }

  // ---------- drops ----------
  const drops: Drop[] = [];
  const drifts: Drift[] = [];
  const SPEED = CAL.len / 45;
  const lakeBox = lake.box;

  const spawn = (l: Line, d: number, dir: 1 | -1, col: Color, end: number) => {
    if (drops.length < MAX_DROPS) drops.push({ line: l, d, dir, col, off: Math.random() - 0.5, end });
  };
  function spawnDrift(to: XY) {
    for (let tries = 0; tries < 20; tries++) {
      const a: XY = [lakeBox[0] + Math.random() * (lakeBox[2] - lakeBox[0]), lakeBox[1] + Math.random() * (lakeBox[3] - lakeBox[1])];
      if (!inLake(a)) continue;
      const bend = (Math.random() - 0.5) * 0.4;
      const c: XY = [(a[0] + to[0]) / 2 - (to[1] - a[1]) * bend, (a[1] + to[1]) / 2 + (to[0] - a[0]) * bend];
      drifts.push({ a, c, b: to, u: 0, du: DRIFT_SPEED / Math.max(1e-3, Math.hypot(to[0] - a[0], to[1] - a[1])) });
      return;
    }
  }

  function step(dt: number) {
    const emit = (cfs: number, a: { acc: number }, f: () => void) => {
      a.acc += cfs * K * dt;
      while (a.acc >= 1) {
        a.acc -= 1;
        f();
      }
    };
    const open: { o: Outlet; cfs: number }[] = [];
    for (const o of outlets) {
      const cfs = current[o.key] ?? 0;
      if (cfs > 0) {
        open.push({ o, cfs });
        emit(cfs, o, () => spawn(o.line, o.d0 + Math.random() * SPEED * 0.05, 1, "l", o.line.len));
      } else if (cfs < 0) {
        // Runoff coming up the canal from downstream and into the lake.
        const reach = Math.min(o.line.len, o.d0 + BACK_REACH);
        emit(-cfs, o, () => spawn(o.line, o.d0 + Math.random() * (reach - o.d0), -1, "b", Math.max(0, o.d0 - FADE)));
      }
    }
    // The Caloosahatchee's own basin joins between Moore Haven and the Franklin Lock.
    const d77 = outlets[1].d0;
    acc.cal += runoff * K * dt;
    while (acc.cal >= 1) {
      acc.cal -= 1;
      spawn(CAL, d77 + Math.random() * (d79 - d77), 1, "b", CAL.len);
    }
    acc.fec += (current.FEC ?? 0) * K * dt;
    while (acc.fec >= 1) {
      acc.fec -= 1;
      spawn(FEC, Math.random() * dPalmdale, 1, "b", FEC.len);
    }
    // Lake water drifts toward the gates that are open, in proportion to what they pass.
    const total = open.reduce((s, x) => s + x.cfs, 0);
    acc.drift += total * DRIFT_K * dt;
    while (acc.drift >= 1 && total > 0) {
      acc.drift -= 1;
      let r = Math.random() * total;
      const pick = open.find((x) => (r -= x.cfs) <= 0) ?? open[open.length - 1];
      spawnDrift(pointAt(pick.o.line, pick.o.d0));
    }
    for (let i = drops.length - 1; i >= 0; i--) {
      const p = drops[i];
      p.d += p.dir * SPEED * dt;
      if ((p.dir > 0 && p.d > p.end) || (p.dir < 0 && p.d < p.end)) drops.splice(i, 1);
    }
    for (let i = drifts.length - 1; i >= 0; i--) if ((drifts[i].u += drifts[i].du * dt) >= 1) drifts.splice(i, 1);
  }

  /** Fading in at the start of a run, out near its end. */
  const alphaOf = (p: Drop) => Math.min(1, Math.abs(p.end - p.d) / FADE);

  const streaks = new StreakLayer();
  const GROUP = { l: 0, b: 1 } as const;
  const qb = (t: number, a: XY, c: XY, b: XY): XY => [
    (1 - t) ** 2 * a[0] + 2 * (1 - t) * t * c[0] + t * t * b[0],
    (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * c[1] + t * t * b[1],
  ];
  function draw() {
    const c = view.fctx;
    const { W, H } = view;
    const sc = view.scale;
    c.setTransform(view.DPR, 0, 0, view.DPR, 0, 0);
    fadeLayer(c, W, H, Math.min(0.55, Math.max(0.2, 0.2 * Math.sqrt(sc / 1000))));
    const z = Math.min(2.4, Math.max(1.1, sc / 1500));
    for (const [col, k] of Object.entries(GROUP) as [Color, number][]) {
      streaks.style(k, C[col], glow ? 0.3 : 0.8, z);
      streaks.style(k + 2, C[col], glow ? 0.12 : 0.35, z);
    }
    streaks.begin();
    const tailPx = Math.min(7, Math.max(1.2, SPEED * sc * 0.12));
    for (const p of drops) {
      const [hx, hy] = pointAt(p.line, p.d);
      const [tx, ty] = pointAt(p.line, p.d - (p.dir * tailPx) / sc);
      const w = (p.line === CAL && p.d > d79 ? 0.003 : 0.0008) * sc;
      const ox = p.off * w;
      const oy = p.off * w * 0.6;
      const sx = X(hx) + ox;
      const sy = Y(hy) + oy;
      if (sx < -10 || sy < -10 || sx > W + 10 || sy > H + 10) continue;
      streaks.add(GROUP[p.col] + (alphaOf(p) < 0.6 ? 2 : 0), X(tx) + ox, Y(ty) + oy, sx, sy);
    }
    streaks.flush(c, glow);
    c.fillStyle = C.l;
    for (const s of drifts) {
      const q = qb(s.u, s.a, s.c, s.b);
      c.globalAlpha = 0.7 * Math.min(1, s.u * 6, (1 - s.u) * 6);
      c.fillRect(X(q[0]) - 1, Y(q[1]) - 1, 2, 2);
    }
    c.globalAlpha = 1;
  }

  function refill(seconds: number, dt: number) {
    drops.length = 0;
    drifts.length = 0;
    for (let t = 0; t < seconds; t += dt) step(dt);
    view.clearFx();
  }

  // ---------- cards ----------
  const gaugeCard = (g: Gauge): CardContent => {
    const kind = `USGS gauge ${g.id}`;
    const title = g.name ?? g.short;
    if (g.cfs == null) return { title, kind, body: "No recent reading at this gauge." };
    const meta = liveMeta.get(g.key);
    const when = meta ? `, ${timeFmt(meta.time)}` : "";
    let body = g.cfs < 0 ? `${fmtCfs(-g.cfs)} cubic feet per second is running <b>into the lake</b>${when}.` : `${fmtCfs(g.cfs)} cubic feet per second${when}.`;
    if (g.key === "S79") body += ` This is the Caloosahatchee at the tide: the lake's release at Moore Haven plus the river's own runoff on the way.`;
    else if (g.key === "FEC") body += ` ${FISHEATING_TEXT}`;
    else if (g.key === "S308") body += ` ${ST_LUCIE_TEXT} <a href="st-lucie.html">Follow it to the St. Lucie.</a>`;
    else if (g.cfs < 0 && g.key !== "S77") body += ` ${BACKFLOW_TEXT}`;
    if (meta?.stale) body += " This gauge hasn't reported recently, so treat it as old.";
    return { title, kind, body };
  };
  const lines: [Polyline, () => CardContent][] = [
    [KISS, () => ({ title: "Kissimmee River", kind: "River · not gauged here", body: KISSIMMEE_TEXT })],
    [FEC, () => ({ title: "Fisheating Creek", kind: "Creek", body: FISHEATING_TEXT })],
    [CAL, () => ({ title: "Caloosahatchee River", kind: "River and canal (C-43)", body: CALOOSAHATCHEE_TEXT })],
    [STL, () => ({ title: "St. Lucie Canal", kind: "Canal (C-44)", body: `${ST_LUCIE_TEXT} <a href="st-lucie.html">See the St. Lucie map.</a>` })],
    [MIAMI, () => ({ title: "Miami Canal", kind: "Canal", body: SOUTH_TEXT })],
    [NNR, () => ({ title: "North New River Canal", kind: "Canal", body: SOUTH_TEXT })],
    [HILLS, () => ({ title: "Hillsboro Canal", kind: "Canal", body: SOUTH_TEXT })],
    [WPB, () => ({ title: "West Palm Beach Canal", kind: "Canal · not gauged", body: `${WPB_TEXT} ${SOUTH_TEXT}` })],
  ];
  function tap(x: number, y: number) {
    const seen = journal && showJournal ? hitSighting(journal, X, Y, x, y) : null;
    if (seen) return card.show(sightingCard(seen));
    const d2 = (xy: XY) => (X(xy[0]) - x) ** 2 + (Y(xy[1]) - y) ** 2;
    let best: (() => CardContent) | null = null;
    let bd = 22 * 22;
    for (const g of gauges) if (d2(g.xy) < bd) [bd, best] = [d2(g.xy), () => gaugeCard(g)];
    if (!best) {
      // Lines count from a little less far, so the gauges on them win ties.
      for (const [l, f] of lines) {
        const d = Math.min(...l.pts.map(d2)) * 1.5;
        if (d < bd) [bd, best] = [d, f];
      }
    }
    const m: XY = [(x - view.cam.tx) / view.cam.s, (y - view.cam.ty) / view.cam.s];
    if (!best && inLake(m)) best = () => ({ title: LAKE.name, kind: LAKE.kind, body: LAKE.text });
    if (best) card.show((best as () => CardContent)());
    else card.hide();
  }

  // ---------- gauge strip + copy ----------
  function renderProfile() {
    const el = document.getElementById("profile")!;
    el.replaceChildren();
    for (const g of gauges) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `gauge${liveMeta.get(g.key)?.stale ? " stale" : ""}`;
      const v = document.createElement("div");
      v.className = "v";
      v.textContent = fmtCfs(g.cfs);
      const n = document.createElement("div");
      n.className = "n";
      n.textContent = g.short;
      b.append(v, n);
      b.addEventListener("click", () => {
        view.flyTo(g.xy, 2500);
        card.show(gaugeCard(g));
      });
      el.appendChild(b);
    }
  }

  const snapLabel = new Date(snapshot.time).toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  function renderCopy(state: "checking" | "live" | "snapshot") {
    const list = (xs: string[]) => (xs.length < 3 ? xs.join(" and ") : `${xs.slice(0, -1).join(", ")}, and ${xs[xs.length - 1]}`);
    const dirs = (Object.keys(WAYS) as Direction[]).filter((d) => ways[d] != null && Math.abs(ways[d]!) >= 1);
    const outs = dirs.filter((d) => ways[d]! > 0).sort((a, b) => ways[b]! - ways[a]!).map((d) => `<b>${fmtCfs(ways[d])} cfs</b> ${WAYS[d].out}`);
    const ins = dirs.filter((d) => ways[d]! < 0).map((d) => `<b>${fmtCfs(-ways[d]!)} cfs</b> ${WAYS[d].in}`);
    let flow = outs.length ? `Right now the lake is sending ${list(outs)}` : "Right now none of the lake's gauged gates are letting water out";
    flow += ins.length ? `, and taking in ${list(ins)}. ` : ". ";
    const fec = current.FEC;
    document.getElementById("lede")!.innerHTML =
      flow + (fec != null ? `Fisheating Creek is bringing in <b>${fmtCfs(fec)} cfs</b>. ` : "") + "Tap anything on the map.";
    const tail = "Flow is in cubic feet per second (cfs); negative is running into the lake.";
    document.getElementById("status")!.textContent =
      state === "live" ? `Live USGS readings, updated ${timeFmt(liveTime!)}. ${tail}`
      : state === "checking" ? `USGS readings from ${snapLabel}. Checking for live readings… ${tail}`
      : `USGS readings from ${snapLabel}. Live readings didn't load, so this is a saved snapshot. ${tail}`;
  }

  // ---------- since 1932 ----------
  const hist = data.history;
  const sum = summarize(hist);
  function renderHist() {
    const m = sum.mean;
    const p = sum.pumping;
    document.getElementById("histRead")!.innerHTML =
      `Since ${MODERN}, the lake has sent an average of <b>${fmtCfs(m.west)} cfs</b> west, <b>${fmtCfs(m.east)} cfs</b> east, and <b>${fmtCfs(m.south)} cfs</b> south through the gauged canals. ` +
      (p ? `The south canals once ran the other way: in the ${p.from}s they averaged <b>${fmtCfs(-p.mean)} cfs</b> into the lake, pumped from the farms, and ran backward in <b>${sum.southBack.length}</b> years in all.` : "");
    renderHistory(document.getElementById("histChart")!, hist.years, [
      { name: "West (S-77)", color: "--chart-tannin", values: hist.west },
      { name: "East (S-308)", color: "--chart-estuary", values: hist.east },
      { name: "South (S-351, S-354)", color: "--chart-spring", values: hist.south },
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

  // ---------- live readings ----------
  async function tryLive() {
    const signed = new Set(gauges.filter((g) => g.signed).map((g) => g.id));
    const readings = await fetchLatest(gauges.map((g) => g.id), signed);
    let latest: Date | null = null;
    for (const g of gauges) {
      const r = readings.get(g.id);
      if (!r) continue;
      current[g.key] = r.cfs;
      liveMeta.set(g.key, { time: r.time, stale: Date.now() - r.time.getTime() > STALE_MS });
      if (!latest || r.time > latest) latest = r.time;
    }
    if (!latest) throw new Error("USGS returned no readings");
    liveTime = latest;
    setFlows(current);
    renderProfile();
    renderCopy("live");
    drawBase();
  }

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
  document.getElementById("bLake")!.addEventListener("click", () => view.fit(VIEWS.lake, true));
  document.getElementById("bWest")!.addEventListener("click", () => view.fit(VIEWS.west, true));

  readColors();
  setFlows(current);
  renderProfile();
  renderCopy("checking");
  view.resize();
  view.fit(VIEWS.all);
  // Warm start: long enough for Moore Haven's water to reach the Gulf.
  refill(CAL.len / SPEED + 5, 0.1);
  if (view.reduceMotion) {
    draw();
    setPaused(true);
  }
  startLoop((dt, t) => {
    view.tick(t);
    if (!paused) {
      step(dt);
      draw();
    }
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
    const chip = document.createElement("button");
    chip.type = "button";
    chip.textContent = "Journal marks";
    chip.setAttribute("aria-pressed", "true");
    chip.addEventListener("click", () => {
      showJournal = !showJournal;
      chip.setAttribute("aria-pressed", String(showJournal));
      drawBase();
    });
    bp.after(chip);
    drawBase();
  });
  tryLive().catch((err) => {
    console.warn("Live USGS readings unavailable; using snapshot.", err);
    renderCopy("snapshot");
  });
}

main().catch(showLoadError);
