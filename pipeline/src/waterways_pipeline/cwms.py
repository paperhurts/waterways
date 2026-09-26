"""Flow at water control structures from the Corps of Engineers' CWMS Data API.

USGS stopped gauging the Kissimmee's main stem (S-65E in 2004), but SFWMD's readings at
its structures reach the Corps' public API: hourly at S-65E since 2014, and daily at
Lake Istokpoga's outlet, S-68. Gauges with `"source": "cwms"` in config/gauges.json name
their time series (`ts`); the browser reads the same API for live values, and
snapshot.json carries the newest reading as a fallback.
"""

from __future__ import annotations

import statistics
from collections import defaultdict
from datetime import UTC, date, datetime, timedelta

from . import config as C
from .fetch import get_json, log

OFFICE = "SAJ"
HEADERS = {"Accept": "application/json;version=2"}


def values(ts: str, begin: datetime, end: datetime, refresh: bool = False, cache: bool = True) -> list[tuple[datetime, float]]:
    """(time, value) for every reading in [begin, end), missing ones dropped."""
    body = get_json(
        f"{C.CWMS}/timeseries",
        {"name": ts, "office": OFFICE, "begin": begin.strftime("%Y-%m-%dT%H:%M:%SZ"), "end": end.strftime("%Y-%m-%dT%H:%M:%SZ"), "page-size": 20000},
        refresh=refresh,
        cache=cache,
        headers=HEADERS,
    )
    return parse(body)


def parse(body: dict) -> list[tuple[datetime, float]]:
    """A CWMS timeseries response's readings: [epoch ms, value, quality] rows, nulls dropped."""
    out = []
    for t, v, *_ in body.get("values") or []:
        if v is None or v != v:
            continue
        out.append((datetime.fromtimestamp(t / 1000, UTC), float(v)))
    return out


def daily_means(readings: list[tuple[datetime, float]], min_readings: int = 12) -> dict[str, float]:
    """Mean value per UTC day, for days with at least `min_readings` readings."""
    days: dict[str, list[float]] = defaultdict(list)
    for t, v in readings:
        days[t.date().isoformat()].append(v)
    return {d: statistics.fmean(vs) for d, vs in days.items() if len(vs) >= min_readings}


def daily(ts: str, first_year: int, refresh: bool = False, per_day: int = 12) -> dict[str, float]:
    """A series' daily means, fetched a year at a time (finished years are cached). An
    hourly series needs `per_day` readings for a day to count; pass 1 for a daily one."""
    out: dict[str, float] = {}
    this_year = date.today().year
    for y in range(first_year, this_year + 1):
        begin, end = datetime(y, 1, 1, tzinfo=UTC), datetime(y + 1, 1, 1, tzinfo=UTC)
        out |= daily_means(values(ts, begin, end, refresh, cache=y < this_year), per_day)
    return out


def latest(refresh: bool = True) -> dict[str, float | None]:
    """snapshot.json's cfs for the CWMS gauges: each series' newest reading in the last
    three days, by gauge key."""
    now = datetime.now(UTC)
    out: dict[str, float | None] = {}
    for g in C.gauges():
        if g.get("source") != "cwms":
            continue
        rows = values(g["ts"], now - timedelta(days=3), now + timedelta(hours=1), refresh, cache=False)
        out[g["key"]] = round(rows[-1][1], 1) if rows else None
        if not rows:
            log(f"snapshot: no CWMS reading for {g['short']}")
    return out
