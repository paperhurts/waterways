// Seas, lakes, and wetlands under the streams: seas and lakes as still water,
// swamps as the cartographer's marsh stipple.

import { project, type Rect, type XY } from "./geo";
import type { LakesFile } from "./types";

export interface Lake {
  name: string | null;
  kind: "sea" | "lake" | "swamp";
  km2: number;
  rings: XY[][];
  /** Where to put the name: the middle of the outer ring's bounding box. */
  label: XY;
  /** Outer ring bounds in map units: [x0, y0, x1, y1]. */
  box: [number, number, number, number];
}

let probe: CanvasRenderingContext2D | null = null;

/** True when a map point lies inside an open-water lake (not a wetland). */
export function inLake(lakes: Lake[], xy: XY): boolean {
  probe ??= document.createElement("canvas").getContext("2d")!;
  for (const l of lakes) {
    const [x0, y0, x1, y1] = l.box;
    if (l.kind !== "lake" || xy[0] < x0 || xy[0] > x1 || xy[1] < y0 || xy[1] > y1) continue;
    const p = new Path2D();
    for (const r of l.rings) r.forEach((q, i) => (i ? p.lineTo(q[0], q[1]) : p.moveTo(q[0], q[1])));
    if (probe.isPointInPath(p, xy[0], xy[1], "evenodd")) return true;
  }
  return false;
}

export function decodeLakes(file: LakesFile): Lake[] {
  const [ox, oy] = file.meta.coordOrigin;
  const k = file.meta.coordScale;
  return file.bodies.map((b) => {
    const rings = b.rings.map((flat) => {
      const pts: XY[] = [];
      for (let i = 0; i < flat.length; i += 2) pts.push(project(flat[i] / k + ox, flat[i + 1] / k + oy));
      return pts;
    });
    const xs = rings[0].map((p) => p[0]);
    const ys = rings[0].map((p) => p[1]);
    const box: Lake["box"] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    return { ...b, rings, box, label: [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2] };
  });
}

export interface LakeColors {
  sea: string;
  lake: string;
  shore: string;
  marsh: string;
  label: string;
}

const STIPPLE = 7;
/** Room (px) a lake's name keeps around it from boxes it avoids. */
const PAD = 4;
let pattern: { color: string; p: CanvasPattern } | null = null;

/** The swamp stipple, as a repeating pattern (cached per color). */
export function marshPattern(c: CanvasRenderingContext2D, color: string): CanvasPattern {
  if (pattern?.color === color) return pattern.p;
  const tile = document.createElement("canvas");
  tile.width = tile.height = STIPPLE * 2;
  const t = tile.getContext("2d")!;
  t.fillStyle = color;
  // Offset rows, like the tufts on a USGS topo swamp symbol.
  t.fillRect(1, 2, 3, 1);
  t.fillRect(STIPPLE + 1, STIPPLE + 2, 3, 1);
  pattern = { color, p: c.createPattern(tile, "repeat")! };
  return pattern.p;
}

export function drawLakes(
  c: CanvasRenderingContext2D,
  lakes: Lake[],
  X: (x: number) => number,
  Y: (y: number) => number,
  cam: { s: number; tx: number; ty: number },
  colors: LakeColors,
): void {
  const path = (rings: XY[][]) => {
    const p = new Path2D();
    for (const r of rings) r.forEach((q, i) => (i ? p.lineTo(X(q[0]), Y(q[1])) : p.moveTo(X(q[0]), Y(q[1]))));
    p.closePath();
    return p;
  };
  const marsh = marshPattern(c, colors.marsh);
  // Pin the stipple to the map so it pans with the land instead of sliding over it.
  marsh.setTransform(new DOMMatrix().translateSelf(cam.tx % (STIPPLE * 2), cam.ty % (STIPPLE * 2)));
  c.save();
  // The sea sits under everything, filled as one shape with no outline: NHD tiles it
  // into polygons with straight seams offshore, and stroking those would draw fake coasts.
  const sea = new Path2D();
  for (const l of lakes) if (l.kind === "sea") sea.addPath(path(l.rings));
  c.fillStyle = colors.sea;
  c.fill(sea, "evenodd");
  for (const l of lakes) {
    if (l.kind !== "swamp") continue;
    c.fillStyle = marsh;
    c.fill(path(l.rings), "evenodd");
  }
  c.lineWidth = 0.8;
  for (const l of lakes) {
    if (l.kind !== "lake") continue;
    const p = path(l.rings);
    c.fillStyle = colors.lake;
    c.fill(p, "evenodd");
    c.strokeStyle = colors.shore;
    c.stroke(p);
  }
  c.restore();
}

/** Names for the bigger lakes, and smaller ones once zoomed in. */
export function drawLakeLabels(
  c: CanvasRenderingContext2D,
  lakes: Lake[],
  X: (x: number) => number,
  Y: (y: number) => number,
  scale: number,
  color: string,
  /** Boxes to keep clear of, like the map's key (CSS px). */
  avoid: Rect[] = [],
): void {
  c.save();
  c.font = "italic 12px 'Spectral',serif";
  c.fillStyle = color;
  c.textAlign = "center";
  c.globalAlpha = 0.85;
  for (const l of lakes) {
    if (l.kind !== "lake" || !l.name) continue;
    if (l.km2 < 8 && scale < 2400) continue;
    if (l.km2 < 2 && scale < 6000) continue;
    const [x, y] = [X(l.label[0]), Y(l.label[1]) + 4];
    const half = c.measureText(l.name).width / 2 + PAD;
    if (avoid.some((b) => x + half > b.x && x - half < b.x + b.w && y + PAD > b.y && y - 12 - PAD < b.y + b.h)) continue;
    c.fillText(l.name, x, y);
  }
  c.restore();
}
