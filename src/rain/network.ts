// The creek network: NHD segments from the base file and its tiles, linked
// downstream by id across all of them. No DOM here, so tests can use it.

import { KM_PER_UNIT, polyline, project, type Polyline, type XY } from "../shared/geo";
import { SegFlag, type Fate, type RainSeg } from "../shared/types";

export interface Segment extends Polyline {
  id: number;
  fate: Fate;
  /** Downstream segment's id, or -1 where the network ends or leaves Florida. */
  next: number;
  /** Km of creek upstream, including this one. */
  acc: number;
  name: string | null;
  sink: string | null;
  underground: boolean;
  /** An artificial path across a lake: drawn faint, since the lake fill shows that water. */
  lake: boolean;
  /** Its water enters the sea at its downstream end. */
  mouth: boolean;
  /** Its water passes through Lake Okeechobee. */
  lakeo: boolean;
}

export interface Packing {
  coordOrigin: [number, number];
  coordScale: number;
}

/** Delta-packed ints ([x0, y0, dx1, dy1, ...]) to map units. */
export function unpackDelta(flat: number[], { coordOrigin: [ox, oy], coordScale: k }: Packing): XY[] {
  const pts: XY[] = [];
  let x = 0;
  let y = 0;
  for (let i = 0; i < flat.length; i += 2) {
    x += flat[i];
    y += flat[i + 1];
    pts.push(project(x / k + ox, y / k + oy));
  }
  return pts;
}

/** A file's segments, whose ids start at `first`. */
export function decodeSegments(segs: RainSeg[], names: string[], first: number, packing: Packing): Segment[] {
  return segs.map(([coords, fate, next, acc, name, sink, flags], i) => ({
    ...polyline(unpackDelta(coords, packing)),
    id: first + i,
    fate,
    next,
    acc,
    name: name >= 0 ? names[name] : null,
    sink: sink >= 0 ? names[sink] : null,
    underground: !!(flags & SegFlag.Underground),
    lake: !!(flags & SegFlag.Lake),
    mouth: !!(flags & SegFlag.Mouth),
    lakeo: !!(flags & SegFlag.LakeO),
  }));
}

export interface Trace {
  path: Segment[];
  km: number;
  /** First named stream the water joins below the starting segment. */
  joins: string | null;
  end: XY;
  /** The path ends where the water enters the sea, not at a sink or the state line. */
  toSea: boolean;
}

/** Follow a segment's water downstream through whatever is loaded. */
export function traceDownstream(get: (id: number) => Segment | undefined, start: number): Trace {
  const path: Segment[] = [];
  let km = 0;
  let joins: string | null = null;
  const seen = new Set<number>();
  for (let i = start; i >= 0 && !seen.has(i); ) {
    const s = get(i);
    if (!s) break;
    seen.add(i);
    path.push(s);
    km += s.len * KM_PER_UNIT;
    if (!joins && s.name && i !== start) joins = s.name;
    i = s.next;
  }
  const last = path[path.length - 1];
  return { path, km, joins, end: last.pts[last.pts.length - 1], toSea: last.mouth };
}

/** Like traceDownstream, loading the tiles the path runs through first. */
export async function traceLoading(get: (id: number) => Segment | undefined, load: (id: number) => Promise<boolean>, start: number): Promise<Trace> {
  const seen = new Set<number>();
  for (let i = start; i >= 0 && !seen.has(i); ) {
    seen.add(i);
    let s = get(i);
    if (!s && (await load(i))) s = get(i);
    if (!s) break;
    i = s.next;
  }
  return traceDownstream(get, start);
}
