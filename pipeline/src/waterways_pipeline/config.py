"""Paths, study areas, and source endpoints."""

from __future__ import annotations

import json
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
OUT = REPO / "public" / "data"
CONFIG = REPO / "config"
CACHE = REPO / "pipeline" / "cache"

# (west, south, east, north) in WGS84 degrees.
Bbox = tuple[float, float, float, float]

#: Every mapped creek between the Suwannee and Gainesville (rain map).
STREAMS_BBOX: Bbox = (-82.99, 29.56, -82.01, 30.09)
#: Main stems drawn on the Santa Fe map; wider so the Suwannee fits.
RIVERS_BBOX: Bbox = (-83.08, 29.54, -82.14, 30.09)
RIVERS = ["Santa Fe River", "Ichetucknee River", "Suwannee River", "New River", "Olustee Creek"]

#: Aquifer grid: 0.01° cells. Keep in sync with the frontend's expectations in src/shared/types.ts.
AQUIFER_GRID = {"lon0": -83.15, "lat0": 29.35, "res": 0.01, "nx": 121, "ny": 81}
#: Averaged for each surface's "central area" level on the sparkline.
AQUIFER_MEAN_WINDOW: Bbox = (-82.8, 29.63, -82.3, 29.98)

# ---- sources ----
NHDPLUS_HR = "https://hydro.nationalmap.gov/arcgis/rest/services/NHDPlus_HR/MapServer"
NHD_POINTS = f"{NHDPLUS_HR}/2"
NHD_FLOWLINES = f"{NHDPLUS_HR}/3"
NHD_WATERBODIES = f"{NHDPLUS_HR}/9"
FDEP_SPRINGS = "https://ca.dep.state.fl.us/arcgis/rest/services/OpenData/SPRINGS/MapServer/1"
FGS_SWALLETS = "https://ca.dep.state.fl.us/arcgis/rest/services/OpenData/FGS_PUBLIC/MapServer/2"
FGS_POTENTIOMETRIC = "https://ca.dep.state.fl.us/arcgis/rest/services/OpenData/FGS_PUBLIC/MapServer/8"
USGS_API = "https://api.waterdata.usgs.gov/ogcapi/v1/collections"

# NHDPlus HR terminal paths (terminalpa) for the two ocean outlets.
TERMINAL_GULF = 15000900002435  # Suwannee River → Gulf of Mexico
TERMINAL_ATLANTIC = 15000300000195  # St. Johns River → Atlantic

# NHD feature types.
FTYPE_UNDERGROUND = 420
FTYPE_ARTIFICIAL = 558
FTYPE_SINK_RISE = 450
FTYPE_SPRING = 458


def gauges() -> list[dict]:
    return json.loads((CONFIG / "gauges.json").read_text(encoding="utf-8"))


def named_sinks() -> list[dict]:
    return json.loads((CONFIG / "sinks.json").read_text(encoding="utf-8"))["sinks"]
