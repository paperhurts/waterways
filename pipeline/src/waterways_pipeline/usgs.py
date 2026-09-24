"""River discharge from the USGS Water Data API: latest readings and monthly means."""

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

Month = tuple[int, int]


def latest(refresh: bool = True) -> dict:
    """snapshot.json: the newest discharge reading at every gauge."""
    gauges = C.gauges()
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
        try:
            v = float(p["value"])
        except (TypeError, ValueError):
            continue
        if v < 0:
            continue
        site = p["monitoring_location_id"].removeprefix("USGS-")
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
    }


def daily(site: str, refresh: bool = False) -> dict[str, float]:
    """Every daily mean discharge on record, by ISO date."""
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
            if p["value"] is not None and float(p["value"]) >= 0:
                out[p["time"][:10]] = float(p["value"])
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
    out = {}
    for g in C.gauges():
        out[g["key"]] = monthly_means(daily(g["id"], refresh))
        span = f"{min(out[g['key']])}–{max(out[g['key']])}" if out[g["key"]] else "no daily record"
        log(f"flows: {g['short']}: {len(out[g['key']])} months ({span})")
    return out
