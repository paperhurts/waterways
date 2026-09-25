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
 * - route: past the study area, on the Suwannee's or St. Johns' way to the sea (no rain falls on it)
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
  route: 0 | 1,
];

export type NamedPoint = [lon: number, lat: number, name: string];
/**
 * magnitude: Meinzer class, 1 = over 100 cfs, 2 = 10–100, 3 = 1–10; 0 = unknown.
 * id: key into springs.json (the journal's list), or "" for NHD-only springs.
 */
export type SpringSite = [lon: number, lat: number, name: string, magnitude: number, id: string];

// ---------- springs.json (the journal's statewide list) ----------

export type StatewideSpring = [id: string, name: string, county: string, lon: number, lat: number, magnitude: number, onRainMap: 0 | 1];

export interface SpringsFile {
  meta: Provenance & { fields: string[] };
  springs: StatewideSpring[];
}

export interface StreamsFile {
  /** areas: the [west, south, east, north] boxes whose union is the study area. */
  meta: Provenance & { coordOrigin: [number, number]; coordScale: number; segFields: string[]; fates: string[]; areas: [number, number, number, number][] };
  names: string[];
  segs: SegTuple[];
  springs: SpringSite[];
  /** Named sinks where a creek drops into an underground conduit and keeps flowing. */
  swallets: NamedPoint[];
  /** Indices of the segments whose water enters the sea at their downstream end. */
  mouths: number[];
}

// ---------- lakes.json (both maps) ----------

export interface LakesFile {
  meta: Provenance & { coordOrigin: [number, number]; coordScale: number };
  /** Seas first, then lakes and wetlands largest first. Rings are packed like stream coords; holes are extra rings (draw with evenodd). */
  bodies: { name: string | null; kind: "sea" | "lake" | "swamp"; km2: number; rings: number[][] }[];
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

// ---------- rainbow.json (Rainbow River map) ----------

export interface RainbowFile {
  /** surface: the FGS potentiometric surface the contours come from. */
  meta: Provenance & { coordOrigin: [number, number]; coordScale: number; surface: string };
  /** Main stems, upstream to downstream: Rainbow River, Withlacoochee River, Cross Florida Barge Canal. */
  rivers: Record<string, { p: LonLat[]; u: (0 | 1)[] }>;
  /** FDEP spring vents on the upper Rainbow and Indian Creek, north to south. */
  vents: [name: string, lon: number, lat: number][];
  /** Rings are packed like lakes.json (coordOrigin, coordScale). */
  springshed: { km2: number; rings: number[][] };
  focusArea: { km2: number; rings: number[][] };
  contours: { v: number; p: LonLat[] }[];
  /** Water-year mean discharge (cfs), Rainbow at Dunnellon and Withlacoochee near Holder. */
  history: { years: number[]; Rb: (number | null)[]; WH: (number | null)[] };
}

// ---------- st-lucie.json (St. Lucie map) ----------

export interface StLucieFile {
  meta: Provenance & { coordOrigin: [number, number]; coordScale: number };
  /** Main stems, upstream to downstream, by NHD name: Saint Lucie Canal, the South and North Forks, Saint Lucie River (the estuary), County Line Canal (C-23), Indian River. */
  rivers: Record<string, { p: LonLat[]; u: (0 | 1)[] }>;
  /** The sea (with the estuary and lagoon) first, then lakes; the same shape as lakes.json's bodies. */
  water: LakesFile["bodies"];
  /** Water-year mean flow (cfs) out of Lake Okeechobee at S-308 and into the estuary at S-80; negative is flow back toward the lake. */
  history: { years: number[]; S308: (number | null)[]; S80: (number | null)[] };
}

// ---------- statewide.json (statewide springs map; the springs are springs.json) ----------

export interface AreaFile {
  name: string;
  km2: number;
  /** Packed like lakes.json. */
  rings: number[][];
}

export interface StatewideFile {
  /** view: [west, south, east, north] the data covers. */
  meta: Provenance & { coordOrigin: [number, number]; coordScale: number; view: [number, number, number, number] };
  /** Florida and its neighbors, clipped to the view; the page paints the sea behind them. */
  land: number[][];
  /** FDEP springs basin management action plan areas, largest first. */
  plans: AreaFile[];
  /** FDEP Springs Priority Focus Areas. */
  focusAreas: AreaFile[];
}

// ---------- gauges (config/gauges.json) and flows ----------

/** The Santa Fe map's gauges; the aquifer steps carry flows for these. */
export const FLOW_KEYS = ["W", "O", "R", "U", "F", "I", "H", "B", "Bl", "Wx", "Fn"] as const;
export type FlowKey = (typeof FLOW_KEYS)[number];
/** Discharge in cubic feet per second, by gauge key. null = no record. */
export type Flows = Record<FlowKey, number | null>;

/** The Rainbow River map's gauges: Holder, upper Rainbow, Rainbow mouth, US 41, Inglis bypass, Inglis Dam. */
export const RAINBOW_KEYS = ["WH", "RbN", "Rb", "WD", "WB", "WI"] as const;
export type RainbowKey = (typeof RAINBOW_KEYS)[number];
export type RainbowFlows = Record<RainbowKey, number | null>;

/** The St. Lucie map's gauges: the canal's two structures, S-308 at Lake Okeechobee and S-80 at the St. Lucie Lock. */
export const STLUCIE_KEYS = ["S308", "S80"] as const;
export type StLucieKey = (typeof STLUCIE_KEYS)[number];
export type StLucieFlows = Record<StLucieKey, number | null>;

export type GaugeKey = FlowKey | RainbowKey | StLucieKey;

export interface GaugeConfig {
  id: string;
  short: string;
  /** USGS's site name, tidied, for cards; the Santa Fe map builds its own titles. */
  name?: string;
  key: GaugeKey;
  /** Which map draws it. */
  page: "santa-fe" | "rainbow" | "st-lucie";
  /** Flow can run backward here, and USGS reports it as negative. */
  signed?: boolean;
  river?: string;
  spring?: boolean;
  lon: number;
  lat: number;
}

/** The St. Lucie estuary's salinity stations (config/salinity.json): Speedy Point and Steele Point. */
export const SALINITY_KEYS = ["SP", "SS"] as const;
export type SalinityKey = (typeof SALINITY_KEYS)[number];

export interface SalinityStation {
  id: string;
  short: string;
  name: string;
  key: SalinityKey;
  lon: number;
  lat: number;
}

/** Parts per thousand from the sensor near the surface and the one near the bottom. */
export interface Salinity {
  top: number | null;
  bottom: number | null;
}

export interface Snapshot {
  /** ISO 8601 time of the newest reading. */
  time: string;
  /** Every gauge in config/gauges.json, all maps. */
  cfs: Flows & RainbowFlows & StLucieFlows;
  /** Every station in config/salinity.json. */
  ppt: Record<SalinityKey, Salinity>;
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
