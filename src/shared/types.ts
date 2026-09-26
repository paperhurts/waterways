// Shapes of the files in public/data/ and config/. The Python pipeline writes
// these; tests/data.test.ts checks the checked-in files against them.

export interface Provenance {
  generator: string;
  generatedAt: string;
  sources?: string[];
}

// ---------- streams.json (rain map) ----------

/** Where a creek's water ends up, as an index into RainBase.meta.fates. */
export const Fate = { Gulf: 0, Atlantic: 1, Sink: 2, Inland: 3, OffMap: 4 } as const;
export type Fate = (typeof Fate)[keyof typeof Fate];

export type NamedPoint = [lon: number, lat: number, name: string];
/**
 * magnitude: Meinzer class, 1 = over 100 cfs, 2 = 10–100, 3 = 1–10; 0 = unknown.
 * id: key into springs.json (the journal's list), or "" for NHD-only springs.
 */
export type SpringSite = [lon: number, lat: number, name: string, magnitude: number, id: string];

// ---------- springs.json (the journal's statewide list) ----------

/** park: the state park it's in (a ParksFile park's name), or "". */
export type StatewideSpring = [id: string, name: string, county: string, lon: number, lat: number, magnitude: number, onRainMap: 0 | 1, park: string];

export interface SpringsFile {
  meta: Provenance & { fields: string[] };
  springs: StatewideSpring[];
}

// ---------- rain/base.json and rain/<level>/<col>-<row>.json (the statewide rain map) ----------

/** Bits in a RainSeg's flags. */
export const SegFlag = {
  /** An NHD underground conduit, through the aquifer. */
  Underground: 1,
  /** An NHD artificial path across a lake: the lake fill already shows that water. */
  Lake: 2,
  /** Its water enters the sea at its downstream end. */
  Mouth: 4,
  /** Its water passes through Lake Okeechobee. */
  LakeO: 8,
} as const;

/**
 * One NHD flowline:
 * - coords: delta-packed ints [x0, y0, dx1, dy1, ...]; lon = x / coordScale + coordOrigin[0]
 * - next: id of the downstream segment, in the base or any tile, or -1 where the
 *   network ends or leaves Florida
 * - acc: NHD's arbolate sum, the km of creek upstream including this one
 * - name / sink: index into the same file's `names`, or -1
 */
export type RainSeg = [coords: number[], fate: Fate, next: number, acc: number, name: number, sink: number, flags: number];

/** Rings are delta-packed like RainSeg coords; holes are extra rings (draw with evenodd). */
export interface RainWater {
  name: string | null;
  kind: "sea" | "lake" | "swamp";
  km2: number;
  rings: number[][];
}

/** Level 0 is the base. Each later level holds smaller creeks, cut into tiles of tileDeg degrees. */
export interface RainLevel {
  minAcc: number;
  tileDeg: number;
  /** first: the id of the tile's first segment; ids then run consecutively for `count`. */
  tiles: [col: number, row: number, first: number, count: number][];
}

export interface RainBase {
  meta: Provenance & {
    coordOrigin: [number, number];
    coordScale: number;
    /** Where tile (0, 0) starts: [west, south]. */
    gridOrigin: [number, number];
    bounds: [number, number, number, number];
    segFields: string[];
    fates: string[];
    /** Percent of Florida's creek length (no artificial paths) by fate. */
    shares: number[];
    /** Segment ids across the base and every tile. */
    segCount: number;
    levels: RainLevel[];
  };
  names: string[];
  /** Ids 0 to segs.length - 1. */
  segs: RainSeg[];
  /** The sea, then the biggest lakes and wetlands. */
  water: RainWater[];
  springs: SpringSite[];
  swallets: NamedPoint[];
  /** One label per named sink, where its biggest creek ends: acc is that creek's. */
  sinks: [lon: number, lat: number, name: string, acc: number][];
  /** Big rivers' names, at the middle of each main stem in Florida, longest (km in Florida) first. */
  rivers: [lon: number, lat: number, name: string, fate: Fate, km: number][];
}

export interface RainTile {
  first: number;
  names: string[];
  segs: RainSeg[];
  /** Smaller lakes and wetlands, in the first level's tiles only. */
  water: RainWater[];
}

// ---------- lakes-santa-fe.json, lakes-rainbow.json ----------

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
  /** Rings are packed like the lakes files (coordOrigin, coordScale). */
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
  /** The sea (with the estuary and lagoon) first, then lakes; the same shape as a lakes file's bodies. */
  water: LakesFile["bodies"];
  /** Water-year mean flow (cfs) out of Lake Okeechobee at S-308 and into the estuary at S-80; negative is flow back toward the lake. */
  history: { years: number[]; S308: (number | null)[]; S80: (number | null)[] };
}

// ---------- lake-o.json (Lake Okeechobee map) ----------

export interface LakeOFile {
  meta: Provenance & { coordOrigin: [number, number]; coordScale: number };
  /** Main stems by NHD name, upstream to downstream (config LAKEO_RIVERS). */
  rivers: Record<string, { p: LonLat[]; u: (0 | 1)[] }>;
  /** The sea, then lakes and marshes; the same shape as a lakes file's bodies. */
  water: LakesFile["bodies"];
  /** Water-year mean flow (cfs) out of the lake each way; negative is flow into it. South is S-351 and S-354 together. */
  history: { years: number[]; east: (number | null)[]; west: (number | null)[]; south: (number | null)[] };
}

// ---------- indian-river.json (Indian River Lagoon map) ----------

export interface IndianRiverFile {
  meta: Provenance & { coordOrigin: [number, number]; coordScale: number };
  /** The sea with the lagoon in it, then lakes; the same shape as a lakes file's bodies. */
  water: LakesFile["bodies"];
  /** The lagoon itself: the salt water behind the barrier islands, packed like the water's rings. */
  lagoon: number[][];
  /**
   * km by water from each cell of the lagoon to the nearest inlet: base64 uint8, row 0
   * south, 255 = not lagoon. Cells are res degrees from (lon0, lat0). farthest: the most km.
   */
  grid: { lon0: number; lat0: number; res: number; nx: number; ny: number; km: string; farthest: number };
  /** North to south. cut: the year the channel was dug; the others are natural. */
  inlets: { name: string; lon: number; lat: number; cut?: number }[];
  /** Each gauge's path into the lagoon, packed flat; Haulover's runs west to east. */
  streams: Record<IrlKey, number[]>;
  /** Water-year mean flow (cfs) into the lagoon from the drainage canals and from the creeks, in years every gauge of a group reports. */
  history: { years: number[]; canals: (number | null)[]; creeks: (number | null)[] };
}

// ---------- reefs.json (coral reef map) ----------

/** Rings and points are delta-packed like the rain map's (see RainSeg). */
export interface ReefsFile {
  meta: Provenance & { coordOrigin: [number, number]; coordScale: number };
  /** The sea, with every bay in it. */
  sea: number[][];
  habitat: {
    /** The reef tract: aggregate reefs and spur and groove, by station. */
    reef: Record<ReefStation, number[][]>;
    hardbottom: number[][];
    seagrass: number[][];
    /** One point per patch reef, and per artificial reef, by station: [x0, y0, dx1, dy1, ...]. */
    patches: Record<ReefStation, number[]>;
    artificial: Record<ReefStation, number[]>;
  };
  /** FWC's twelve reef regions and the station that covers each. */
  regions: { name: string; station: ReefStation; rings: number[][] }[];
  /** Each year's highest Degree Heating Weeks, since 1985. */
  heat: { years: number[] } & Record<ReefStation, (number | null)[]>;
}

// ---------- statewide.json (statewide springs map; the springs are springs.json) ----------

export interface AreaFile {
  name: string;
  km2: number;
  /** Packed like the lakes files. */
  rings: number[][];
  /** Lagoons only: a point inside the water, for the name. */
  label?: LonLat;
}

export interface StatewideFile {
  /** view: [west, south, east, north] the data covers. */
  meta: Provenance & { coordOrigin: [number, number]; coordScale: number; view: [number, number, number, number] };
  /** Florida and its neighbors, clipped to the view, less every bay, lagoon, and tidal river; the page paints the sea behind them. */
  land: number[][];
  /** FDEP springs basin management action plan areas, largest first. */
  plans: AreaFile[];
  /** FDEP Springs Priority Focus Areas. */
  focusAreas: AreaFile[];
  /** Florida's coastal lagoons (NHD), largest first, for their names and cards: their water is already out of the land. */
  lagoons: AreaFile[];
  /** Florida's lakes and big wetlands (NHD), largest first. */
  water: { name: string | null; kind: "lake" | "swamp"; km2: number; rings: number[][] }[];
  /** Springs NHD maps that FDEP doesn't list (not in springs.json). */
  extraSprings: NamedPoint[];
}

// ---------- kissimmee.json (Kissimmee River map) ----------

/** What the river is along its path, in kissimmee.json's order. */
export const KISS_CLASSES = ["canal", "river", "filled"] as const;
export type KissClass = (typeof KISS_CLASSES)[number];

export interface KissStructure {
  name: string;
  lon: number;
  lat: number;
  /** outlet: Lake Kissimmee's; pool: divides the river's pools; removed: taken out by the restoration; mouth: into Lake Okeechobee; istokpoga: Lake Istokpoga's outlet. */
  role: "outlet" | "pool" | "removed" | "mouth" | "istokpoga";
}

export interface KissimmeeFile {
  meta: Provenance & { coordOrigin: [number, number]; coordScale: number; classes: string[] };
  /** NHD's main path from S-65 to S-65E, packed like the lakes files, with each vertex's class (index into KISS_CLASSES) and the miles of each. */
  river: { p: number[]; c: number[]; miles: Record<KissClass, number> };
  /** Canal backfilled in the last phase (2021), from OpenStreetMap, packed. */
  filled: number[][];
  /** NHD's other river channels in the floodplain: the old bends, packed. */
  oldChannel: number[][];
  /** Canal C-41A from Lake Istokpoga's outlet (S-68) to the river, packed. */
  istokpoga: number[];
  /** Lakes and the wetlands off the floodplain; same shape as a lakes file's bodies. */
  water: LakesFile["bodies"];
  /** The floodplain's wetlands, packed rings, and their area. */
  floodplain: number[][];
  floodplainKm2: number;
  structures: KissStructure[];
  /** Water-year mean flow at S-65E (cfs), from USGS then the Corps. */
  history: { years: number[]; S65E: (number | null)[] };
}

// ---------- peace.json (Peace River map) ----------

export const PEACE_RIVERS = ["Peace River", "Charlie Creek", "Horse Creek", "Joshua Creek", "Payne Creek", "Saddle Creek", "Shell Creek"] as const;
export type PeaceRiver = (typeof PEACE_RIVERS)[number];

export interface PeaceFile {
  meta: Provenance & { coordOrigin: [number, number]; coordScale: number };
  /** Each river upstream to downstream, packed like the lakes files. */
  rivers: Record<PeaceRiver, number[]>;
  /** Each tributary's gauge, if it has one. */
  tributaries: Record<Exclude<PeaceRiver, "Peace River">, PeaceKey | null>;
  kissengen: LonLat;
  /** FGS's swallets along the upper river. */
  sinks: [name: string | null, lon: number, lat: number][];
  /** How far the Upper Floridan has fallen since before development (whole feet, base64 bytes, row 0 south): `now` for the latest surface, `dry` for the dry season. */
  aquifer: { lon0: number; lat0: number; res: number; nx: number; ny: number; now: string; dry: string; nowMax: number; dryMax: number; months: { now: string; dry: string } };
  /** Land mined for phosphate (FDEP's mandatory reclamation map), packed rings, and its area. */
  mines: number[][];
  minesKm2: number;
  water: LakesFile["bodies"];
  /** Water-year mean flow (cfs) of the Peace at Bartow and at Arcadia. */
  history: { years: number[]; BAR: (number | null)[]; ARC: (number | null)[] };
}

// ---------- apalachicola.json (Apalachicola River map) ----------

export const AP_RIVERS = ["Chattahoochee River", "Flint River", "Apalachicola River", "Chipola River"] as const;
export type ApRiver = (typeof AP_RIVERS)[number];

export interface ApStructure {
  name: string;
  /** The reservoir behind it. */
  lake: string;
  lon: number;
  lat: number;
  built: number;
}

export interface ApalachicolaFile {
  meta: Provenance & { coordOrigin: [number, number]; coordScale: number };
  /** Each river upstream to downstream, packed like the lakes files, with `pool` flagging each vertex that's in a reservoir. */
  rivers: Record<ApRiver, { p: number[]; pool: number[] }>;
  /** The basin's other big streams, packed. */
  context: number[][];
  /** The sea and bay first, then lakes and wetlands; same shape as a lakes file's bodies. */
  water: LakesFile["bodies"];
  /** FWC's oyster beds in and around the bay, packed rings. */
  oysters: number[][];
  /** The Florida, Georgia, and Alabama lines, packed. */
  borders: number[][];
  structures: ApStructure[];
  /** Water-year mean flow (cfs) of the Apalachicola at Chattahoochee. */
  history: { years: number[]; CHAT: (number | null)[] };
}

// ---------- ocklawaha.json (Ocklawaha River map) ----------

export interface OckStructure {
  name: string;
  lon: number;
  lat: number;
  /** dam: the Kirkpatrick (Rodman) Dam; unfinished: Eureka, never closed; lock: Buckman Lock, to the St. Johns. */
  role: "dam" | "unfinished" | "lock";
}

export interface OcklawahaFile {
  meta: Provenance & { coordOrigin: [number, number]; coordScale: number };
  /** Packed like the lakes files. The Ocklawaha's `res` flags each vertex that's in the reservoir. */
  rivers: { "Ocklawaha River": { p: number[]; res: number[] }; "Silver River": { p: number[] }; "Orange Creek": { p: number[] } };
  /** The Cross Florida Barge Canal's cut from the reservoir to the St. Johns. */
  canal: number[][];
  /** Rodman Reservoir (NHD's Lake Ocklawaha), packed rings, and its area. */
  reservoir: number[][];
  reservoirKm2: number;
  /** FDEP springs in the reservoir. */
  drowned: [id: string, name: string, lon: number, lat: number, magnitude: number][];
  water: LakesFile["bodies"];
  structures: OckStructure[];
  /** Water-year mean flow (cfs): the Silver River, and the Ocklawaha at Eureka. */
  history: { years: number[]; SILV: (number | null)[]; EUR: (number | null)[] };
}

// ---------- parks.json (state parks map) ----------

/** The water a park protects, in parks.json's order. */
export const PARK_WATER = ["springs", "rivers", "lakes", "coast", "reef", "land"] as const;
export type ParkWater = (typeof PARK_WATER)[number];

export interface StatePark {
  name: string;
  /** FDEP's county list, comma-separated. */
  county: string;
  acres: number;
  /** Its page on floridastateparks.org, if FDEP lists one. */
  url: string | null;
  /** Index into PARK_WATER. */
  water: number;
  /** Its biggest water communities on FDEP's natural community map: [plain name, acres], largest first. */
  kinds: [string, number][];
  /** FDEP springs in it (their springs.json `park`). */
  springs: number;
  /** First-magnitude springs in it, with a spring's vents counted once. */
  big: number;
  /** A point inside its biggest piece, for its marker. */
  at: LonLat;
  /** Delta-packed like the rain map's; holes are extra rings (draw with evenodd). */
  rings: number[][];
}

export interface ParksFile {
  meta: Provenance & { coordOrigin: [number, number]; coordScale: number; classes: string[] };
  /** First-magnitude springs on FDEP's list, with a spring's vents counted once. */
  firstMagnitude: number;
  /** By name. */
  parks: StatePark[];
}

// ---------- snorkel spots (config/snorkel.json) ----------

/** Where a snorkel spot is, in kind: its card's label comes from src/shared/snorkel.ts. */
export type SnorkelKind = "reef" | "offshore" | "lagoon" | "inlet" | "park" | "island" | "beach" | "cave" | "sinkhole";
/** A spot members add can also be a spring FDEP doesn't list, or anything else. Matches the spots table's check. */
export type SpotKind = SnorkelKind | "spring" | "other";

export interface SnorkelSpot {
  /** name--county, like the springs' ids, and never the same as one of them. */
  id: string;
  name: string;
  county: string;
  kind: SnorkelKind;
  lon: number;
  lat: number;
  /** The OpenStreetMap feature the location came from, e.g. "way/93618985". */
  osm: string;
  web?: string;
}

/** A spot a member added (the journal's spots table). Its id starts with "spot-". */
export interface MemberSpot {
  id: string;
  name: string;
  kind: SpotKind;
  lat: number;
  lon: number;
  notes: string | null;
  created_by: string;
  created_by_email: string;
  created_at: string;
}

export interface SnorkelFile {
  /** Ids of springs in springs.json that are good for snorkeling. */
  springs: string[];
  /** Snorkel spots that aren't springs. */
  spots: SnorkelSpot[];
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

/** The Lake Okeechobee map's gauges: its outlets west (S-77, S-79 below it), south (S-351 into two canals, S-354), and Fisheating Creek coming in. S-308 is the St. Lucie map's. */
export const LAKEO_KEYS = ["S77", "S79", "S351H", "S351N", "S354", "FEC"] as const;
export type LakeOKey = (typeof LAKEO_KEYS)[number];
export type LakeOFlows = Record<LakeOKey | "S308", number | null>;

/**
 * The Indian River Lagoon map's gauges: Haulover Canal between Mosquito Lagoon and the
 * Indian River (signed: positive is east, toward Mosquito Lagoon), and the creeks and
 * drainage canals that run into the lagoon.
 */
export const IRL_KEYS = ["HAUL", "EG", "CRANE", "TURKEY", "SEBN", "FELL", "SEBS", "NCAN", "MCAN", "SCAN"] as const;
export type IrlKey = (typeof IRL_KEYS)[number];
export type IrlFlows = Record<IrlKey, number | null>;

/** The Kissimmee map's structures, from the Corps' CWMS: S-65E into Lake Okeechobee, and S-68 out of Lake Istokpoga. */
export const KISS_KEYS = ["S65E", "S68"] as const;
export type KissKey = (typeof KISS_KEYS)[number];
export type KissFlows = Record<KissKey, number | null>;

/** The Ocklawaha map's gauges: Moss Bluff, the Silver River, Conner, Eureka, Orange Creek, and Rodman Dam. */
export const OCK_KEYS = ["MB", "SILV", "CON", "EUR", "ORC", "ROD"] as const;
export type OckKey = (typeof OCK_KEYS)[number];
export type OckFlows = Record<OckKey, number | null>;

/** The Apalachicola map's gauges, upstream first: the Chattahoochee below Buford Dam, at Atlanta, and at Columbus; the Flint at Bainbridge; the Apalachicola at Chattahoochee and Blountstown; the Chipola near Altha; and the Apalachicola near Sumatra. */
export const AP_KEYS = ["BUF", "ATL", "COL", "BAIN", "CHAT", "BLT", "ALT", "SUM"] as const;
export type ApKey = (typeof AP_KEYS)[number];
export type ApFlows = Record<ApKey, number | null>;

/** The Peace River map's gauges, upstream first: the Peace at Bartow, Clear Springs, Homeland, Fort Meade, Zolfo Springs, and Arcadia, and Charlie, Horse, and Joshua creeks. */
export const PEACE_KEYS = ["BAR", "CLR", "HOM", "FTM", "ZOL", "ARC", "CHR", "HRS", "JOS"] as const;
export type PeaceKey = (typeof PEACE_KEYS)[number];
export type PeaceFlows = Record<PeaceKey, number | null>;

export type GaugeKey = FlowKey | RainbowKey | StLucieKey | LakeOKey | IrlKey | KissKey | OckKey | ApKey | PeaceKey;

export interface GaugeConfig {
  id: string;
  short: string;
  /** USGS's site name, tidied, for cards; the Santa Fe map builds its own titles. */
  name?: string;
  key: GaugeKey;
  /** Which map draws it. */
  page: "santa-fe" | "rainbow" | "st-lucie" | "lake-o" | "indian-river" | "kissimmee" | "ocklawaha" | "apalachicola" | "peace";
  /** Where its readings come from: USGS (the default, `id` is the site number) or the Corps' CWMS (`ts` names the time series). */
  source?: "cwms";
  ts?: string;
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

/** NOAA Coral Reef Watch heat stress at one regional station, the latest day. */
export interface ReefHeat {
  /** YYYY-MM-DD, the latest day in NOAA's file. */
  date: string;
  /** Sea surface temperature, °C. */
  sst: number;
  /** Degree Heating Weeks, °C-weeks. */
  dhw: number;
  /** The week's highest alert level, 0 to 7: no stress, watch, warning, then Alert Levels 1 to 5. */
  level: number;
  /** The year's highest DHW so far. */
  peak: number;
}
export const REEF_STATIONS = ["keys", "southeast"] as const;
export type ReefStation = (typeof REEF_STATIONS)[number];

export interface Snapshot {
  /** ISO 8601 time of the newest reading. */
  time: string;
  /** Every gauge in config/gauges.json, all maps. */
  cfs: Flows & RainbowFlows & StLucieFlows & Record<LakeOKey | IrlKey | KissKey | OckKey | ApKey | PeaceKey, number | null>;
  /** Every station in config/salinity.json. */
  ppt: Record<SalinityKey, Salinity>;
  /** Coral Reef Watch heat stress on the reef; absent when NOAA didn't answer. */
  reef?: Record<ReefStation, ReefHeat>;
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
