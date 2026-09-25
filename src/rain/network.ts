// The creek network: decoded NHD segments linked downstream, plus the
// summaries the rain map draws from them. No DOM here, so tests can use it.

import { KM_PER_UNIT, polyline, project, type Polyline, type XY } from "../shared/geo";
import { Fate, type StreamsFile } from "../shared/types";

export interface Segment extends Polyline {
  fate: Fate;
  next: number;
  acc: number;
  name: string | null;
  sink: string | null;
  underground: boolean;
  artificial: boolean;
  /** Past the study area, carrying its water to the sea. */
  route: boolean;
  /** Its water enters the sea at its downstream end. */
  mouth: boolean;
}

export function decodeSegments(data: StreamsFile): Segment[] {
  const [ox, oy] = data.meta.coordOrigin;
  const k = data.meta.coordScale;
  const mouths = new Set(data.mouths);
  return data.segs.map(([flat, fate, next, acc, name, sink, ug, art, route], i) => {
    const pts: XY[] = [];
    for (let i = 0; i < flat.length; i += 2) pts.push(project(flat[i] / k + ox, flat[i + 1] / k + oy));
    return {
      ...polyline(pts),
      fate,
      next,
      acc,
      name: name >= 0 ? data.names[name] : null,
      sink: sink >= 0 ? data.names[sink] : null,
      underground: !!ug,
      artificial: !!art,
      route: !!route,
      mouth: mouths.has(i),
    };
  });
}

/** Percent of the study area's real creek length (no artificial paths, no route to the sea) per fate. */
export function fateShares(segs: Segment[]): number[] {
  const t = [0, 0, 0, 0, 0];
  for (const s of segs) if (!s.artificial && !s.route) t[s.fate] += s.len;
  const total = t.reduce((a, b) => a + b, 0);
  return t.map((v) => (v / total) * 100);
}

export interface Trace {
  path: Segment[];
  km: number;
  /** First named stream the water joins below the starting segment. */
  joins: string | null;
  end: XY;
  /** The path ends where the water enters the sea, not at the map's edge or a sink. */
  toSea: boolean;
}

/** Follow a segment's water downstream until it leaves the network. */
export function traceDownstream(segs: Segment[], start: number): Trace {
  const path: Segment[] = [];
  let km = 0;
  let joins: string | null = null;
  const seen = new Set<number>();
  for (let i = start; i >= 0 && !seen.has(i); i = segs[i].next) {
    seen.add(i);
    const s = segs[i];
    path.push(s);
    km += s.len * KM_PER_UNIT;
    if (!joins && s.name && i !== start) joins = s.name;
  }
  const last = path[path.length - 1];
  return { path, km, joins, end: last.pts[last.pts.length - 1], toSea: last.mouth };
}

export interface SinkLabel {
  name: string;
  xy: XY;
  /** Accumulation of the largest creek draining into it. */
  acc: number;
}

/** One label per named sink, placed where its biggest inflowing creek ends. */
export function sinkLabels(segs: Segment[]): SinkLabel[] {
  const by = new Map<string, SinkLabel>();
  for (const s of segs) {
    if (s.fate !== Fate.Sink || s.next >= 0 || !s.sink) continue;
    const end = s.pts[s.pts.length - 1];
    const o = by.get(s.sink);
    if (!o) by.set(s.sink, { name: s.sink, xy: end, acc: s.acc });
    else if (s.acc > o.acc) {
      o.xy = end;
      o.acc = s.acc;
    }
  }
  return [...by.values()];
}
