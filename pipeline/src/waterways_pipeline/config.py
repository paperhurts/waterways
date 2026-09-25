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
#: The Atlantic route out of it: Orange Lake, Silver Springs, the Ocklawaha,
#: and the St. Johns through Lake George to Welaka.
ATLANTIC_CORRIDOR: Bbox = (-82.30, 29.12, -81.50, 29.60)
#: The rain map's study area is the union of these boxes (an L shape).
STREAMS_AREAS: list[Bbox] = [STREAMS_BBOX, ATLANTIC_CORRIDOR]
#: The sea under the rain map, where the Suwannee and St. Johns reach the coast, is
#: everything in this box that isn't land. It reaches past the whole-map view on even a
#: very wide screen, so the sea's edge only shows when zoomed far out.
SEA_CLIP: Bbox = (-85.2, 27.9, -79.6, 31.6)
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
#: Census cartographic (1:500,000) state outlines, which are clipped to the shoreline.
CENSUS_STATES = "https://tigerweb.geo.census.gov/arcgis/rest/services/Generalized_ACS2024/State_County/MapServer/7"
FDEP_SPRINGS = "https://ca.dep.state.fl.us/arcgis/rest/services/OpenData/SPRINGS/MapServer/1"
FGS_SWALLETS = "https://ca.dep.state.fl.us/arcgis/rest/services/OpenData/FGS_PUBLIC/MapServer/2"
FGS_POTENTIOMETRIC = "https://ca.dep.state.fl.us/arcgis/rest/services/OpenData/FGS_PUBLIC/MapServer/8"
USGS_API = "https://api.waterdata.usgs.gov/ogcapi/v1/collections"

# NHDPlus HR terminal paths (terminalpa) for the two ocean outlets. Each is also the
# level path (levelpathi) of that river's main stem, from its headwaters to its mouth.
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
