"""River discharge and estuary salinity from the USGS Water Data API: latest readings,
daily values, and monthly means."""

from __future__ import annotations

import statistics
from collections import defaultdict
from datetime import datetime

from . import config as C
from .fetch import get_json, log

#: Gauges with short records, filled in by scaling from Fort White when missing.
SCALED = ("O", "R", "U", "I", "H", "Fn")
#: A month needs this many daily values to count as a monthly mean.
MIN_DAYS = 20
#: Minimum Mays on record for a gauge's own median to count as "typical".
MIN_TYPICAL_YEARS = 30
#: USGS marks missing values with sentinels like -999999. Real reverse flows, as when the
#: St. Lucie Canal runs back into Lake Okeechobee, are never anywhere near this big.
SENTINEL = -99999

Month = tuple[int, int]


def reading(value: object, signed: bool = False) -> float | None:
    """A reported value, or None if it's missing, a sentinel, or a negative flow at a
    gauge that can't run backward. `signed` gauges report reverse flow as negative."""
    try:
        v = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    if v <= SENTINEL or (v < 0 and not signed):
        return None
    return v


def latest(refresh: bool = True) -> dict:
    """snapshot.json: the newest discharge reading at every gauge, and the newest salinity
    at each estuary station."""
    gauges = C.gauges()
    signed = {g["id"] for g in gauges if g.get("signed")}
    body = get_json(
        f"{C.USGS_API}/latest-continuous/items",
        {
            "f": "json",
            "monitoring_location_id": ",".join(f"USGS-{g['id']}" for g in gauges),
            "parameter_code": "00060",
            "limit": 100,
            "skipGeometry": "true",
            "properties": "monitoring_location_id,time,value",
        },
        refresh=refresh,
        cache=False,
    )
    newest: dict[str, tuple[datetime, float]] = {}
    for feat in body["features"]:
        p = feat["properties"]
        site = p["monitoring_location_id"].removeprefix("USGS-")
        v = reading(p["value"], site in signed)
        if v is None:
            continue
        t = datetime.fromisoformat(p["time"])
        if site not in newest or t > newest[site][0]:
            newest[site] = (t, v)
    missing = [g["short"] for g in gauges if g["id"] not in newest]
    if len(missing) == len(gauges):
        raise RuntimeError("USGS returned no readings")
    if missing:
        log(f"snapshot: no reading for {', '.join(missing)}")
    time = max(t for t, _ in newest.values())
    return {
        "time": time.astimezone().isoformat(timespec="seconds"),
        "cfs": {g["key"]: newest[g["id"]][1] if g["id"] in newest else None for g in gauges},
        "ppt": salinity(refresh),
    }


def depth(sublocation: str | None) -> str | None:
    """"top" or "bottom" from a series' sublocation, e.g. "BOTTOM (from SP cond)"."""
    s = (sublocation or "").upper()
    return "top" if s.startswith("TOP") else "bottom" if s.startswith("BOTTOM") else None


def salinity(refresh: bool = True) -> dict:
    """Newest surface and bottom salinity (ppt) at each station in config/salinity.json.

    Each station has a sensor near the surface and one near the bottom. The latest values
    don't say which is which, so the series metadata maps each series id to its depth."""
    stations = C.salinity_stations()
    common = {
        "f": "json",
        "monitoring_location_id": ",".join(f"USGS-{s['id']}" for s in stations),
        "parameter_code": "00480",
        "limit": 200,
        "skipGeometry": "true",
    }
    meta = get_json(f"{C.USGS_API}/time-series-metadata/items", common, refresh=refresh, cache=False)
    layer = {f["properties"]["id"]: depth(f["properties"].get("sublocation_identifier")) for f in meta["features"]}
    body = get_json(f"{C.USGS_API}/latest-continuous/items", common | {"properties": "time_series_id,monitoring_location_id,time,value"}, refresh=refresh, cache=False)
    return parse_salinity(body["features"], layer, stations)


def parse_salinity(features: list[dict], layer: dict[str, str | None], stations: list[dict]) -> dict:
    """{station key: {"top": ppt, "bottom": ppt}} from latest-continuous features, keeping
    the newest reading at each depth."""
    newest: dict[tuple[str, str], tuple[datetime, float]] = {}
    for feat in features:
        p = feat["properties"]
        where = layer.get(p["time_series_id"])
        v = reading(p["value"])
        if where is None or v is None:
            continue
        key = (p["monitoring_location_id"].removeprefix("USGS-"), where)
        t = datetime.fromisoformat(p["time"])
        if key not in newest or t > newest[key][0]:
            newest[key] = (t, v)
    missing = [s["short"] for s in stations if not any((s["id"], d) in newest for d in ("top", "bottom"))]
    if missing:
        log(f"snapshot: no salinity at {', '.join(missing)}")
    return {s["key"]: {d: newest[(s["id"], d)][1] if (s["id"], d) in newest else None for d in ("top", "bottom")} for s in stations}


def daily(site: str, refresh: bool = False, signed: bool = False) -> dict[str, float]:
    """Every daily mean discharge on record, by ISO date. Negative means are kept only
    for `signed` gauges, where they're flow running backward."""
    url = f"{C.USGS_API}/daily/items"
    params = {
        "f": "json",
        "monitoring_location_id": f"USGS-{site}",
        "parameter_code": "00060",
        "statistic_id": "00003",
        "limit": 50000,
        "skipGeometry": "true",
        "properties": "time,value",
    }
    out: dict[str, float] = {}
    page = get_json(url, params, refresh=refresh)
    while True:
        for feat in page["features"]:
            p = feat["properties"]
            if (v := reading(p["value"], signed)) is not None:
                out[p["time"][:10]] = v
        nxt = next((link["href"] for link in page.get("links", []) if link.get("rel") == "next"), None)
        if not nxt:
            return out
        page = get_json(nxt, refresh=refresh)


def monthly_means(days: dict[str, float]) -> dict[Month, float]:
    groups: dict[Month, list[float]] = defaultdict(list)
    for iso, v in days.items():
        groups[(int(iso[:4]), int(iso[5:7]))].append(v)
    return {m: round(statistics.fmean(vs), 1) for m, vs in groups.items() if len(vs) >= MIN_DAYS}


def ratio_to_fort_white(months: dict[str, dict[Month, float]], key: str, month: int) -> float:
    """Median of key / Fort White over the same calendar month, in years both reported."""
    fw = months["F"]
    pairs = [v / fw[m] for m, v in months[key].items() if m[1] == month and fw.get(m)]
    if not pairs:
        raise RuntimeError(f"no overlapping record between {key} and Fort White for month {month}")
    return statistics.median(pairs)


def flows_for(months: dict[str, dict[Month, float]], when: Month | str) -> tuple[dict[str, float | None], list[str]]:
    """Flows for one step: a specific month, or "typical" (median of every May)."""
    flows: dict[str, float | None] = {}
    est: list[str] = []
    month = 5 if when == "typical" else when[1]  # type: ignore[index]
    fw = typical_may(months["F"]) if when == "typical" else months["F"].get(when)  # type: ignore[arg-type]
    if fw is None:
        raise RuntimeError(f"Fort White has no record for {when}")
    for key, series in months.items():
        v = typical_may(series) if when == "typical" else series.get(when)  # type: ignore[arg-type]
        if when == "typical" and sum(1 for m in series if m[1] == 5) < MIN_TYPICAL_YEARS:
            v = None
        if v is None and key in SCALED:
            v = round(fw * ratio_to_fort_white(months, key, month), 1)
            est.append(key)
        flows[key] = v
    return flows, est


def typical_may(series: dict[Month, float]) -> float | None:
    mays = [v for m, v in series.items() if m[1] == 5]
    return round(statistics.median(mays), 1) if mays else None


def all_monthly(refresh: bool = False) -> dict[str, dict[Month, float]]:
    """Monthly means for the Santa Fe map's gauges, which the aquifer steps carry."""
    out = {}
    for g in C.gauges("santa-fe"):
        out[g["key"]] = monthly_means(daily(g["id"], refresh))
        span = f"{min(out[g['key']])}–{max(out[g['key']])}" if out[g["key"]] else "no daily record"
        log(f"flows: {g['short']}: {len(out[g['key']])} months ({span})")
    return out
