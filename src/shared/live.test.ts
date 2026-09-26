import { describe, expect, it } from "vitest";
import gauges from "../../config/gauges.json";
import { cwmsUrl, depthOf, fmtCfs, latestUrl, parseCwms, parseLatest, parseSalinity } from "./live";

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

  it("keeps reverse flow only where water can run backward", () => {
    const body = { features: [f("02276877", "2026-09-25T14:00:00Z", "-648"), f("3", "2026-09-25T14:00:00Z", "-5")] };
    expect(parseLatest(body).size).toBe(0);
    const m = parseLatest(body, new Set(["02276877"]));
    expect(m.get("02276877")!.cfs).toBe(-648);
    expect(m.has("3")).toBe(false);
    expect(parseLatest({ features: [f("02276877", "2026-09-25T14:00:00Z", "-999999")] }, new Set(["02276877"])).size).toBe(0);
  });
});

describe("parseSalinity", () => {
  const f = (series: string, id: string, time: string, value: string | null) => ({ properties: { time_series_id: series, monitoring_location_id: `USGS-${id}`, time, value } });
  const meta = { features: [{ properties: { id: "a", sublocation_identifier: "TOP (from SP cond)" } }, { properties: { id: "b", sublocation_identifier: "BOTTOM" } }, { properties: { id: "c", sublocation_identifier: "TOP" } }] };

  it("sorts each station's two sensors by depth", () => {
    const m = parseSalinity(
      { features: [f("a", "02277100", "2026-09-25T14:45:00Z", "13"), f("b", "02277100", "2026-09-25T14:45:00Z", "21"), f("c", "02277110", "2026-09-25T14:45:00Z", "23"), f("x", "02277110", "2026-09-25T14:45:00Z", "99")] },
      meta,
    );
    expect(m.get("02277100")).toMatchObject({ top: 13, bottom: 21 });
    expect(m.get("02277110")).toMatchObject({ top: 23, bottom: null });
  });

  it("skips sensors that aren't reporting", () => {
    const m = parseSalinity({ features: [f("b", "02277100", "2026-09-25T10:00:00Z", null)] }, meta);
    expect(m.size).toBe(0);
    expect(depthOf("BOTTOM (from SP cond)")).toBe("bottom");
    expect(depthOf(null)).toBeNull();
  });
});

describe("fmtCfs", () => {
  it("rounds by magnitude", () => {
    expect(fmtCfs(null)).toBe("—");
    expect(fmtCfs(0.94)).toBe("0.9");
    expect(fmtCfs(40.9)).toBe("41");
    expect(fmtCfs(1140)).toBe((1140).toLocaleString());
    expect(fmtCfs(-648)).toBe("-648");
    expect(fmtCfs(-1310)).toBe((-1310).toLocaleString());
  });
});

describe("parseCwms", () => {
  it("takes the newest reading that isn't missing", () => {
    const r = parseCwms({ values: [[1790398800000, 1130.6, 0], [1790406000000, 1132.5, 0], [1790409600000, null, 0]] });
    expect(r).toEqual({ cfs: 1132.5, time: new Date(1790406000000) });
  });

  it("returns null when there's nothing", () => {
    expect(parseCwms({ values: [[1790409600000, null, 0]] })).toBeNull();
    expect(parseCwms({})).toBeNull();
  });

  it("asks for the series by name, from the Jacksonville District", () => {
    const u = new URL(cwmsUrl("S65E.Flow.Inst.1Hour.0.SFWMD-WM", new Date("2026-09-23T07:00:00.123Z")));
    expect(u.searchParams.get("name")).toBe("S65E.Flow.Inst.1Hour.0.SFWMD-WM");
    expect(u.searchParams.get("office")).toBe("SAJ");
    expect(u.searchParams.get("begin")).toBe("2026-09-23T07:00:00Z");
  });
});
