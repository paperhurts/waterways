"""NOAA Coral Reef Watch heat stress on Florida's reef, from its daily 5 km regional
virtual stations (the Florida Keys and Southeast Florida).

Each station's file runs from 1985 to yesterday: the reef's sea surface temperature,
the Coral Bleaching HotSpot (how far it sits above the warmest month's normal, °C) and
the Degree Heating Weeks (DHW: HotSpots of 1 °C or more summed over 12 weeks, °C-weeks).
The file's own alert column stops at the old top level, 2. NOAA added Alert Levels 3 to
5 in December 2023, so the level here is worked out from HotSpot and DHW on the current
scale:

  0 no stress (HotSpot <= 0), 1 watch (0 < HotSpot < 1), 2 warning (HotSpot >= 1, DHW < 4),
  then Alert Level 1 to 5 at DHW 4, 8, 12, 16, and 20 (stored as 3 to 7).

The browser can't read these files (no CORS), so the pipeline fetches them: yearly peaks
into reefs.json, and the latest week into snapshot.json at every deploy.
"""

from __future__ import annotations

from collections import defaultdict

import requests

from .fetch import log

STATIONS = {
    "keys": "https://coralreefwatch.noaa.gov/product/vs/data/florida_keys.txt",
    "southeast": "https://coralreefwatch.noaa.gov/product/vs/data/southeast_florida.txt",
}
#: DHW where each Alert Level starts.
ALERT_DHW = [4, 8, 12, 16, 20]
#: Levels, 0 to 7, by name.
LEVELS = ["No stress", "Watch", "Warning", "Alert Level 1", "Alert Level 2", "Alert Level 3", "Alert Level 4", "Alert Level 5"]


def level(hotspot: float, dhw: float) -> int:
    """The day's bleaching alert level on NOAA's current scale (see the module note)."""
    if hotspot <= 0:
        return 0
    if hotspot < 1:
        return 1
    return 2 + sum(dhw >= t for t in ALERT_DHW)


def parse(text: str) -> list[dict]:
    """Daily rows: {date, sst, hotspot, dhw, level}. SST is the pixel mean's 90th-percentile
    HotSpot pixel's, as NOAA plots it."""
    rows = []
    for line in text.splitlines():
        parts = line.split()
        if len(parts) < 10 or not parts[0].isdigit() or len(parts[0]) != 4:
            continue
        y, m, d = parts[0], parts[1], parts[2]
        sst, hotspot, dhw = float(parts[5]), float(parts[7]), float(parts[8])
        rows.append({"date": f"{y}-{m}-{d}", "sst": sst, "hotspot": hotspot, "dhw": dhw, "level": level(hotspot, dhw)})
    if not rows:
        raise RuntimeError("no daily rows in the Coral Reef Watch file")
    return rows


def fetch(station: str) -> list[dict]:
    url = STATIONS[station]
    log(f"GET {url}")
    r = requests.get(url, timeout=60)
    r.raise_for_status()
    return parse(r.text)


def yearly_peaks(rows: list[dict]) -> dict[int, float]:
    """Each year's highest DHW."""
    out: dict[int, float] = defaultdict(float)
    for r in rows:
        y = int(r["date"][:4])
        out[y] = max(out[y], r["dhw"])
    return {y: round(v, 1) for y, v in sorted(out.items())}


def now(rows: list[dict]) -> dict:
    """The latest day, with the week's highest level (NOAA shows the 7-day max)."""
    last = rows[-1]
    return {
        "date": last["date"],
        "sst": round(last["sst"], 2),
        "dhw": round(last["dhw"], 1),
        "level": max(r["level"] for r in rows[-7:]),
        "peak": round(max(r["dhw"] for r in rows if r["date"][:4] == last["date"][:4]), 1),
    }


def latest() -> dict:
    """snapshot.json's reef block: each station's latest week."""
    return {k: now(fetch(k)) for k in STATIONS}
