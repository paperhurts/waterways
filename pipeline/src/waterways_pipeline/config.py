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
#: The springs belt around them. West of the Suwannee is karst with few surface
#: streams (Troy, Royal, Peacock, Lafayette Blue); north are Suwannee Springs and
#: White Springs; the south box runs from Manatee Springs through Rainbow River
#: and Dunnellon to Crystal River and Homosassa on the Gulf; the upper Ocklawaha
#: box has Lake Weir, the Harris Chain, and Alexander Springs.
SUWANNEE_WEST: Bbox = (-83.30, 29.56, -82.99, 30.50)
SUWANNEE_NORTH: Bbox = (-82.99, 30.09, -82.60, 30.50)
SOUTH_BELT: Bbox = (-83.20, 28.75, -82.30, 29.56)
UPPER_OCKLAWAHA: Bbox = (-82.30, 28.75, -81.50, 29.12)
#: The rain map's study area is the union of these boxes.
STREAMS_AREAS: list[Bbox] = [STREAMS_BBOX, ATLANTIC_CORRIDOR, SUWANNEE_WEST, SUWANNEE_NORTH, SOUTH_BELT, UPPER_OCKLAWAHA]
#: The sea under the rain map, where the Suwannee and St. Johns reach the coast, is
#: everything in this box that isn't land. It reaches past the whole-map view on even a
#: very wide screen, so the sea's edge only shows when zoomed far out.
SEA_CLIP: Bbox = (-85.2, 27.9, -79.6, 31.6)
#: Main stems drawn on the Santa Fe map; wider so the Suwannee fits.
RIVERS_BBOX: Bbox = (-83.08, 29.54, -82.14, 30.09)
RIVERS = ["Santa Fe River", "Ichetucknee River", "Suwannee River", "New River", "Olustee Creek"]

# ---- Rainbow River map ----
#: Its rivers: the Withlacoochee from above Holder to the Gulf, and the Rainbow from its head springs.
RAINBOW_BBOX: Bbox = (-82.80, 28.92, -82.25, 29.14)
RAINBOW_RIVERS = ["Rainbow River", "Withlacoochee River", "Cross Florida Barge Canal"]
#: FDEP spring vents along the upper Rainbow and Indian Creek.
RAINBOW_VENTS_BBOX: Bbox = (-82.46, 29.04, -82.40, 29.11)
#: Everything the Rainbow map draws: the rivers and the springshed, up past Williston.
RAINBOW_VIEW: Bbox = (-82.80, 28.92, -82.05, 29.70)

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
#: SWFWMD's springsheds, interpreted from USGS's May and September 1994 potentiometric maps.
SWFWMD_SPRINGSHEDS = "https://www25.swfwmd.state.fl.us/arcgis12/rest/services/BaseVector/MajorSpringsheds/MapServer/0"
#: FDEP's Springs Priority Focus Areas, drawn around Outstanding Florida Springs.
FDEP_PRIORITY_FOCUS = "https://ca.dep.state.fl.us/arcgis/rest/services/OpenData/STATEWIDE_BMAP/MapServer/1"
USGS_API = "https://api.waterdata.usgs.gov/ogcapi/v1/collections"

# NHDPlus HR terminal paths (terminalpa) for the two ocean outlets. Each is also the
# level path (levelpathi) of that river's main stem, from its headwaters to its mouth.
TERMINAL_GULF = 15000900002435  # Suwannee River → Gulf of Mexico
TERMINAL_ATLANTIC = 15000300000195  # St. Johns River → Atlantic

# NHD feature types.
FTYPE_UNDERGROUND = 420
FTYPE_COASTLINE = 566
FTYPE_ARTIFICIAL = 558
FTYPE_SINK_RISE = 450
FTYPE_SPRING = 458


def gauges(page: str | None = None) -> list[dict]:
    """config/gauges.json, optionally just one map's ("santa-fe" or "rainbow")."""
    rows = json.loads((CONFIG / "gauges.json").read_text(encoding="utf-8"))
    return [g for g in rows if page is None or g["page"] == page]


def named_sinks() -> list[dict]:
    return json.loads((CONFIG / "sinks.json").read_text(encoding="utf-8"))["sinks"]
