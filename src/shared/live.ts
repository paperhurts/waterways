// Latest discharge and salinity readings from the USGS Water Data API, fetched
// in the browser. (The legacy waterservices.usgs.gov NWIS service is being
// retired in early 2027.) If this fails, the page keeps the build-time snapshot.

import type { Salinity } from "./types";

export interface Reading {
  cfs: number;
  time: Date;
}

/** Discharge for labels: whole numbers from 100 up, one decimal under 10, "—" if unknown. Reverse flow keeps its minus sign. */
export const fmtCfs = (n: number | null | undefined): string =>
  n == null ? "—" : Math.abs(n) >= 100 ? Math.round(n).toLocaleString() : n.toFixed(Math.abs(n) < 10 ? 1 : 0);

/** A reading older than this is flagged on the map as possibly out of date. */
export const STALE_MS = 36 * 3600e3;

const API = "https://api.waterdata.usgs.gov/ogcapi/v1/collections";
/** USGS marks missing values with sentinels like -999999; real reverse flows are never this big. */
const SENTINEL = -99999;

export function latestUrl(siteIds: string[], parameter = "00060"): string {
  const q = new URLSearchParams({
    f: "json",
    monitoring_location_id: siteIds.map((id) => `USGS-${id}`).join(","),
    parameter_code: parameter,
    // The API's default page size is 10, fewer than our gauges.
    limit: "100",
    skipGeometry: "true",
    properties: "time_series_id,monitoring_location_id,time,value",
  });
  return `${API}/latest-continuous/items?${q}`;
}

/**
 * Newest reading per site id from a latest-continuous response. Missing or
 * equipment-affected values come back null or as sentinels. A negative flow is
 * kept only at `signed` sites, where the water can run backward.
 */
export function parseLatest(body: LatestResponse, signed: ReadonlySet<string> = new Set()): Map<string, Reading> {
  const out = new Map<string, Reading>();
  for (const { properties: p } of body.features) {
    const cfs = parseFloat(p.value ?? "");
    const id = p.monitoring_location_id.replace(/^USGS-/, "");
    if (!(cfs > SENTINEL) || (cfs < 0 && !signed.has(id))) continue;
    const time = new Date(p.time);
    const prev = out.get(id);
    if (!prev || time > prev.time) out.set(id, { cfs, time });
  }
  return out;
}

async function getJson<T>(url: string, timeoutMs: number): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`USGS returned HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** Rejects on timeout or HTTP error. */
export async function fetchLatest(siteIds: string[], signed: ReadonlySet<string> = new Set(), timeoutMs = 6000): Promise<Map<string, Reading>> {
  return parseLatest(await getJson<LatestResponse>(latestUrl(siteIds), timeoutMs), signed);
}

export interface LatestResponse {
  features: { properties: { time_series_id?: string; monitoring_location_id: string; time: string; value: string | null } }[];
}

// ---------- salinity ----------

export interface SalinityReading extends Salinity {
  /** The newer of the two sensors' times. */
  time: Date;
}

export interface SeriesMetaResponse {
  features: { properties: { id: string; sublocation_identifier?: string | null } }[];
}

/** "top" or "bottom" from a series' sublocation, e.g. "BOTTOM (from SP cond)". */
export function depthOf(sublocation: string | null | undefined): keyof Salinity | null {
  const s = (sublocation ?? "").toUpperCase();
  return s.startsWith("TOP") ? "top" : s.startsWith("BOTTOM") ? "bottom" : null;
}

/** Newest surface and bottom salinity per site, given which depth each series id measures. */
export function parseSalinity(body: LatestResponse, meta: SeriesMetaResponse): Map<string, SalinityReading> {
  const depth = new Map(meta.features.map((f) => [f.properties.id, depthOf(f.properties.sublocation_identifier)]));
  const newest = new Map<string, Partial<Record<keyof Salinity, { ppt: number; time: Date }>>>();
  for (const { properties: p } of body.features) {
    const d = depth.get(p.time_series_id ?? "");
    const ppt = parseFloat(p.value ?? "");
    if (!d || !(ppt >= 0)) continue;
    const id = p.monitoring_location_id.replace(/^USGS-/, "");
    const time = new Date(p.time);
    const at = newest.get(id) ?? {};
    if (!at[d] || time > at[d].time) at[d] = { ppt, time };
    newest.set(id, at);
  }
  const out = new Map<string, SalinityReading>();
  for (const [id, { top, bottom }] of newest) {
    const time = [top?.time, bottom?.time].filter((t): t is Date => !!t).reduce((a, b) => (b > a ? b : a));
    out.set(id, { top: top?.ppt ?? null, bottom: bottom?.ppt ?? null, time });
  }
  return out;
}

/**
 * Each station has a sensor near the surface and one near the bottom. The latest
 * values don't say which is which, so this also asks for the series metadata.
 */
export async function fetchSalinity(siteIds: string[], timeoutMs = 6000): Promise<Map<string, SalinityReading>> {
  const q = new URLSearchParams({
    f: "json",
    monitoring_location_id: siteIds.map((id) => `USGS-${id}`).join(","),
    parameter_code: "00480",
    limit: "200",
    skipGeometry: "true",
    properties: "id,sublocation_identifier",
  });
  const [latest, meta] = await Promise.all([
    getJson<LatestResponse>(latestUrl(siteIds, "00480"), timeoutMs),
    getJson<SeriesMetaResponse>(`${API}/time-series-metadata/items?${q}`, timeoutMs),
  ]);
  return parseSalinity(latest, meta);
}
