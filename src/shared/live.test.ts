import { describe, expect, it } from "vitest";
import gauges from "../../config/gauges.json";
import { fmtCfs, latestUrl, parseLatest } from "./live";

describe("latestUrl", () => {
  it("asks for every site in one request, with room for all of them", () => {
    const u = new URL(latestUrl(["02322500", "02321500"]));
    expect(u.searchParams.get("monitoring_location_id")).toBe("USGS-02322500,USGS-02321500");
    expect(u.searchParams.get("parameter_code")).toBe("00060");
    // Both maps' gauges come back in one page.
    expect(Number(u.searchParams.get("limit"))).toBeGreaterThanOrEqual(gauges.length);
  });
});

describe("parseLatest", () => {
  const f = (id: string, time: string, value: string | null) => ({ properties: { monitoring_location_id: `USGS-${id}`, time, value } });

  it("keys readings by bare site id", () => {
    const m = parseLatest({ features: [f("02322500", "2026-09-24T02:00:00+00:00", "664")] });
    expect(m.get("02322500")).toEqual({ cfs: 664, time: new Date("2026-09-24T02:00:00Z") });
  });

  it("keeps the newest reading when a site has several series", () => {
    const m = parseLatest({ features: [f("1", "2026-09-24T02:00:00Z", "10"), f("1", "2026-09-24T03:00:00Z", "12"), f("1", "2026-09-23T03:00:00Z", "9")] });
    expect(m.get("1")!.cfs).toBe(12);
  });

  it("drops missing and negative sentinel values", () => {
    const m = parseLatest({ features: [f("1", "2026-09-24T02:00:00Z", null), f("2", "2026-09-24T02:00:00Z", "-999999")] });
    expect(m.size).toBe(0);
  });
});

describe("fmtCfs", () => {
  it("rounds by magnitude", () => {
    expect(fmtCfs(null)).toBe("—");
    expect(fmtCfs(0.94)).toBe("0.9");
    expect(fmtCfs(40.9)).toBe("41");
    expect(fmtCfs(1140)).toBe((1140).toLocaleString());
  });
});
