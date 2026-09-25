// Latest discharge readings from the USGS Water Data API, fetched in the
// browser. (The legacy waterservices.usgs.gov NWIS service is being retired
// in early 2027.) If this fails, the page keeps the build-time snapshot.

export interface Reading {
  cfs: number;
  time: Date;
}

/** Discharge for labels: whole numbers from 100 up, one decimal under 10, "—" if unknown. */
export const fmtCfs = (n: number | null | undefined): string =>
  n == null ? "—" : n >= 100 ? Math.round(n).toLocaleString() : n.toFixed(n < 10 ? 1 : 0);

/** A reading older than this is flagged on the map as possibly out of date. */
export const STALE_MS = 36 * 3600e3;

const API = "https://api.waterdata.usgs.gov/ogcapi/v1/collections/latest-continuous/items";

export function latestUrl(siteIds: string[]): string {
  const q = new URLSearchParams({
    f: "json",
    monitoring_location_id: siteIds.map((id) => `USGS-${id}`).join(","),
    parameter_code: "00060",
    // The API's default page size is 10, fewer than our gauges.
    limit: "100",
    skipGeometry: "true",
    properties: "monitoring_location_id,time,value",
  });
  return `${API}?${q}`;
}

/** Newest reading per site id from a latest-continuous response. */
export function parseLatest(body: LatestResponse): Map<string, Reading> {
  const out = new Map<string, Reading>();
  for (const { properties: p } of body.features) {
    const cfs = parseFloat(p.value ?? "");
    // Missing or equipment-affected values come back null or negative.
    if (!(cfs >= 0)) continue;
    const id = p.monitoring_location_id.replace(/^USGS-/, "");
    const time = new Date(p.time);
    const prev = out.get(id);
    if (!prev || time > prev.time) out.set(id, { cfs, time });
  }
  return out;
}

/** Rejects on timeout or HTTP error. */
export async function fetchLatest(siteIds: string[], timeoutMs = 6000): Promise<Map<string, Reading>> {
  const res = await fetch(latestUrl(siteIds), { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`USGS returned HTTP ${res.status}`);
  return parseLatest((await res.json()) as LatestResponse);
}

export interface LatestResponse {
  features: { properties: { monitoring_location_id: string; time: string; value: string | null } }[];
}
