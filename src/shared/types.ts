// Shapes of the files in public/data/ and config/. The Python pipeline writes
// these; tests/data.test.ts checks the checked-in files against them.

export interface Provenance {
  generator: string;
  generatedAt: string;
  sources?: string[];
}

// ---------- streams.json (rain map) ----------

/** Where a creek's water ends up, as an index into StreamsFile.meta.fates. */
export const Fate = { Gulf: 0, Atlantic: 1, Sink: 2, Inland: 3, OffMap: 4 } as const;
export type Fate = (typeof Fate)[keyof typeof Fate];

/**
 * One NHD flowline segment:
 * - coords: flat [x0, y0, x1, y1, ...] integers; lon = x / coordScale + coordOrigin[0]
 * - next: index of the downstream segment, or -1 at a terminus
 * - acc: upstream accumulation used for line width (larger = bigger stream)
 * - name / sink: index into `names`, or -1
 * - underground: NHD underground conduit; artificial: NHD artificial path through a waterbody
 */
export type SegTuple = [
  coords: number[],
  fate: Fate,
  next: number,
  acc: number,
  name: number,
  sink: number,
  underground: 0 | 1,
  artificial: 0 | 1,
];

export type SpringPoint = [lon: number, lat: number, name: string];

export interface StreamsFile {
  meta: Provenance & { coordOrigin: [number, number]; coordScale: number; segFields: string[]; fates: string[] };
  names: string[];
  segs: SegTuple[];
  springs: SpringPoint[];
  /** Named sinks where a creek drops into an underground conduit and keeps flowing. */
  swallets: SpringPoint[];
}

// ---------- lakes.json (both maps) ----------

export interface LakesFile {
  meta: Provenance & { coordOrigin: [number, number]; coordScale: number };
  /** Largest first. Rings are packed like stream coords; holes are extra rings (draw with evenodd). */
  bodies: { name: string | null; kind: "lake" | "swamp"; km2: number; rings: number[][] }[];
}

// ---------- rivers.json / contours.json (Santa Fe map) ----------

export type LonLat = [number, number];

export interface RiversFile {
  meta: Provenance;
  /** Main-stem polylines; `u[i]` is 1 where vertex i is in an underground conduit. */
  rivers: Record<string, { p: LonLat[]; u: (0 | 1)[] }>;
}

export interface ContoursFile {
  meta: Provenance & { surface: string; intervalFt: number };
  contours: { v: number; p: LonLat[] }[];
}

// ---------- gauges (config/gauges.json) and flows ----------

export const FLOW_KEYS = ["W", "O", "R", "U", "F", "I", "H", "B", "Bl", "Wx", "Fn"] as const;
export type FlowKey = (typeof FLOW_KEYS)[number];
/** Discharge in cubic feet per second, by gauge key. null = no record. */
export type Flows = Record<FlowKey, number | null>;

export interface GaugeConfig {
  id: string;
  short: string;
  key: FlowKey;
  river?: string;
  spring?: boolean;
  lon: number;
  lat: number;
}

export interface Snapshot {
  /** ISO 8601 time of the newest reading. */
  time: string;
  cfs: Flows;
}

// ---------- aquifer.json ----------

export interface GridSpec {
  lon0: number;
  lat0: number;
  res: number;
  nx: number;
  ny: number;
}

export interface AquiferStep {
  label: string;
  /** Key into AquiferFile.grids. */
  grid: string;
  /** Mean potentiometric level (ft) over the central basin, for the sparkline. */
  mean: number;
  flows: Flows;
  /** Gauges whose flows are estimated by scaling from Fort White. */
  est: FlowKey[];
  /** True when flows are a typical May rather than a specific year. */
  typical: boolean;
}

export interface AquiferFile {
  /** meanWindow: [west, south, east, north] averaged for each step's `mean`. */
  meta: Provenance & { encoding: string; meanWindow: [number, number, number, number] };
  grid: GridSpec;
  /** Base64 uint8 per cell; feet = byte / 2. Row 0 is the southern edge. */
  grids: Record<string, string>;
  steps: AquiferStep[];
  /** The latest published surface, drawn under live gauge readings. */
  now: { grid: string; mean: number };
}
