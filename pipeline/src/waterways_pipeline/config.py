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

# ---- lakes-<map>.json ----
# The Santa Fe and Rainbow maps each draw their lakes and sea from a file of their own,
# covering what the map shows at its whole-map view on a very wide screen (about 2.5 times
# as wide as tall), with room to pan: Gainesville to the Suwannee, and the Rainbow's
# springshed from the Gulf to Lake George and the Harris Chain.
SANTA_FE_LAKES: Bbox = (-83.45, 29.35, -81.85, 30.25)
RAINBOW_LAKES: Bbox = (-83.60, 28.60, -81.25, 29.95)
LAKE_MAPS: dict[str, Bbox] = {"santa-fe": SANTA_FE_LAKES, "rainbow": RAINBOW_LAKES}
#: NHD for these boxes comes from USGS's bulk NHDPlus HR files, one per 4-digit HUC (the
#: files each box needs are listed), instead of the map server, which times out on big
#: queries. Both serve the same release.
BULK_AREAS: dict[Bbox, list[str]] = {
    SANTA_FE_LAKES: ["0311", "0308"],
    RAINBOW_LAKES: ["0310", "0311", "0308"],
}
#: The sea in those files is everything in this box that isn't land. It reaches past both
#: maps' widest views, so its edge only shows zoomed far out.
LAKES_SEA_CLIP: Bbox = (-84.4, 28.1, -80.8, 30.8)
# ---- Indian River Lagoon map ----
#: What the map shows: the lagoon from Ponce de Leon Inlet to Jupiter Inlet, with the
#: creeks and canals that feed it.
IRL_VIEW: Bbox = (-81.05, 26.9, -80.0, 29.1)
#: Water is clipped much wider, so the sea runs off even a wide screen's edges around this tall map.
IRL_WATER: Bbox = (-82.3, 25.9, -77.6, 30.2)
#: The lagoon's flushing grid: 0.004° cells (about 400 m) over the view.
IRL_GRID = {"lon0": -81.05, "lat0": 26.9, "res": 0.004, "nx": 263, "ny": 550}
#: Its five inlets to the Atlantic, north to south. `cut`: the year a channel was dug
#: through the barrier island to make it; the other two are natural.
IRL_INLETS: list[dict] = [
    {"name": "Ponce de Leon Inlet", "lon": -80.9148, "lat": 29.0636},
    {"name": "Sebastian Inlet", "lon": -80.4459, "lat": 27.8606, "cut": 1948},
    {"name": "Fort Pierce Inlet", "lon": -80.2962, "lat": 27.4706, "cut": 1921},
    {"name": "St. Lucie Inlet", "lon": -80.154, "lat": 27.1665, "cut": 1892},
    {"name": "Jupiter Inlet", "lon": -80.0725, "lat": 26.9447},
]
#: Groups of gauges for the lagoon's freshwater history: canals dug to drain groves and
#: farms, and the creeks and rivers.
IRL_CANALS = ["FELL", "NCAN", "MCAN", "SCAN"]
IRL_CREEKS = ["EG", "CRANE", "TURKEY", "SEBN", "SEBS"]

# ---- coral reef map ----
#: Florida's Coral Reef, Martin County to the Dry Tortugas.
REEF_VIEW: Bbox = (-83.1, 24.35, -79.9, 27.3)
#: Water is clipped much wider, so the sea runs off the screen's edges.
REEF_WATER: Bbox = (-84.6, 23.5, -78.3, 28.3)
#: FWC FWRI's Unified Florida Reef Map (habitat) and its regions.
URM = "https://gis.myfwc.com/hosting/rest/services/Projects_FWC/UnifiedReefMapProject_v2_2/MapServer"
#: Which Coral Reef Watch station covers each Unified Reef Map region.
REEF_STATIONS = {
    "keys": ["Upper Keys", "Middle Keys", "Lower Keys", "Marquesas", "Dry Tortugas", "Florida Bay"],
    "southeast": ["Martin", "North Palm Beach", "South Palm Beach", "Deerfield", "Broward-Miami", "Biscayne"],
}

# ---- statewide rain map ----
#: The 4-digit HUCs that drain Florida: the St. Marys, St. Johns, south Florida, Peace-Tampa
#: Bay, Suwannee, Ochlockonee, Apalachicola, and Choctawhatchee-Escambia.
FLORIDA_HU4S = ["0307", "0308", "0309", "0310", "0311", "0312", "0313", "0314"]
#: Florida, from Perdido Key to Key West and the St. Marys. Tiles are counted from its corner.
FLORIDA_BBOX: Bbox = (-87.70, 24.30, -79.80, 31.05)
#: The sea under the statewide map, from Texas to North Carolina: far enough out that its
#: edge stays off even a wide screen showing the whole state. The Census outlines are the
#: US's alone, so it stops north of Cuba and the Yucatan, which would read as sea.
RAIN_SEA_CLIP: Bbox = (-96.5, 22.0, -72.0, 36.5)

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

# ---- St. Lucie map ----
#: Everything the St. Lucie map draws: Lake Okeechobee's east shore at Port Mayaca, the
#: St. Lucie Canal, both forks, the estuary, and the St. Lucie Inlet.
STLUCIE_VIEW: Bbox = (-80.75, 26.92, -80.08, 27.42)
#: Its water reaches past the view, so panning doesn't find the sea's edge: all of Lake
#: Okeechobee, the lagoon up past Fort Pierce, and the coast down to Jupiter.
STLUCIE_WATER: Bbox = (-81.15, 26.8, -79.9, 27.6)
#: The open sea (Census land subtracted from this box) reaches farther still, past the
#: widest view.
STLUCIE_SEA: Bbox = (-81.3, 26.3, -79.0, 28.1)
#: The main stems it draws, by NHD name. County Line Canal is C-23.
STLUCIE_RIVERS = ["Saint Lucie Canal", "South Fork Saint Lucie River", "North Fork Saint Lucie River", "Saint Lucie River", "County Line Canal", "Indian River"]

# ---- Lake Okeechobee map ----
#: Everything it draws: the lake with the Kissimmee's mouth and Fisheating Creek, the
#: Caloosahatchee west to its estuary at Fort Myers, the St. Lucie Canal east to Stuart,
#: and the farm canals south toward the Everglades.
#: The Kissimmee River map: Lake Kissimmee down the river to Lake Okeechobee.
KISS_VIEW: Bbox = (-81.42, 27.12, -80.78, 27.98)
#: Lakes and wetlands reach past the view so panning doesn't find their edge.
KISS_WATER: Bbox = (-81.75, 26.85, -80.45, 28.25)
#: The river's structures, from the Corps' CWMS locations. S-65B and S-65C were removed
#: by the restoration (S-65C in 2021); S-65B's site isn't in CWMS, so it isn't drawn.
KISS_STRUCTURES = [
    {"name": "S-65", "lon": -81.1983, "lat": 27.8036, "role": "outlet"},
    {"name": "S-65A", "lon": -81.1344, "lat": 27.6597, "role": "pool"},
    {"name": "S-65C", "lon": -81.1150, "lat": 27.4008, "role": "removed"},
    {"name": "S-65D", "lon": -81.0228, "lat": 27.3144, "role": "pool"},
    {"name": "S-65E", "lon": -80.9628, "lat": 27.2250, "role": "mouth"},
    {"name": "S-68", "lon": -81.2544, "lat": 27.3297, "role": "istokpoga"},
]
#: The Ocklawaha River map: Moss Bluff and Silver Springs down to the St. Johns.
OCK_VIEW: Bbox = (-82.12, 29.02, -81.58, 29.62)
OCK_WATER: Bbox = (-82.4, 28.85, -81.35, 29.8)
#: Where the Ocklawaha meets the St. Johns, and the head of the Silver River.
OCK_MOUTH = (-81.665, 29.465)
SILVER_HEAD = (-82.0525, 29.2155)
#: The barge canal's structures on the river (from OpenStreetMap).
OCK_STRUCTURES = [
    {"name": "Kirkpatrick Dam", "lon": -81.8052, "lat": 29.5082, "role": "dam"},
    {"name": "Eureka Dam", "lon": -81.8943, "lat": 29.3774, "role": "unfinished"},
    {"name": "Buckman Lock", "lon": -81.7286, "lat": 29.5457, "role": "lock"},
]
#: The Apalachicola River map: the whole basin, from Lake Lanier to Apalachicola Bay.
AP_VIEW: Bbox = (-85.45, 29.55, -83.75, 34.3)
AP_WATER: Bbox = (-86.2, 29.2, -83.2, 34.6)
#: The sea reaches much wider: the whole basin on a phone-shaped screen shows several degrees either side.
AP_SEA: Bbox = (-89.0, 27.0, -80.5, 31.5)
#: The Apalachicola's mouth, the Flint's head, and where the Chipola joins the Apalachicola.
AP_MOUTH = (-84.98, 29.725)
FLINT_HEAD = (-84.44, 33.62)
CHIPOLA_MOUTH = (-85.05, 29.9)
#: The Corps' dams on the rivers (from OpenStreetMap), upstream first.
AP_STRUCTURES = [
    {"name": "Buford Dam", "lake": "Lake Lanier", "lon": -84.0746, "lat": 34.1605, "built": 1956},
    {"name": "West Point Dam", "lake": "West Point Lake", "lon": -85.1901, "lat": 32.9209, "built": 1975},
    {"name": "Walter F. George Dam", "lake": "Lake Eufaula", "lon": -85.0628, "lat": 31.6219, "built": 1963},
    {"name": "Jim Woodruff Dam", "lake": "Lake Seminole", "lon": -84.8613, "lat": 30.7093, "built": 1957},
]
#: FWC's statewide oyster beds.
FWC_OYSTERS = "https://gis.myfwc.com/hosting/rest/services/Open_Data/Oyster_Beds_Statewide/MapServer/17"
#: OpenStreetMap's Overpass API, for which stretches of C-38 were backfilled.
OVERPASS = "https://overpass-api.de/api/interpreter"
#: The Corps of Engineers' public CWMS Data API (water levels and flows at SFWMD structures).
CWMS = "https://cwms-data.usace.army.mil/cwms-data"

LAKEO_VIEW: Bbox = (-81.95, 26.3, -80.15, 27.45)
#: Lakes, marshes, and estuaries reach past the view so panning doesn't find their edge.
LAKEO_WATER: Bbox = (-82.2, 26.0, -79.95, 27.7)
LAKEO_SEA: Bbox = (-83.0, 25.4, -79.0, 28.2)
#: The main stems it draws, by NHD name: the lake's two big inflows, the Caloosahatchee
#: (a canal above LaBelle, a river below), the St. Lucie Canal, and the four canals south.
LAKEO_RIVERS = [
    "Kissimmee River", "Fisheating Creek", "Caloosahatchee Canal", "Caloosahatchee River", "Saint Lucie Canal",
    "Miami Canal", "North New River Canal", "Hillsboro Canal", "West Palm Beach Canal",
]

#: Aquifer grid: 0.01° cells. Keep in sync with the frontend's expectations in src/shared/types.ts.
AQUIFER_GRID = {"lon0": -83.15, "lat0": 29.35, "res": 0.01, "nx": 121, "ny": 81}
#: Averaged for each surface's "central area" level on the sparkline.
AQUIFER_MEAN_WINDOW: Bbox = (-82.8, 29.63, -82.3, 29.98)

# ---- sources ----
NHDPLUS_HR = "https://hydro.nationalmap.gov/arcgis/rest/services/NHDPlus_HR/MapServer"
NHD_POINTS = f"{NHDPLUS_HR}/2"
NHD_FLOWLINES = f"{NHDPLUS_HR}/3"
#: Polygons for wide rivers and canals (FType 460, 336), sea, and other areas.
NHD_AREAS = f"{NHDPLUS_HR}/8"
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
#: FDEP's state park boundaries (layer 0) and its map of the parks' natural communities (layer 5).
FDEP_PARKS = "https://ca.dep.state.fl.us/arcgis/rest/services/OpenData/PARKS_BOUNDARIES/MapServer"
USGS_API = "https://api.waterdata.usgs.gov/ogcapi/v1/collections"
#: USGS's bulk NHDPlus HR release, one zipped file geodatabase per 4-digit HUC.
NHD_BULK = "https://prd-tnm.s3.amazonaws.com/StagedProducts/Hydrography/NHDPlusHR/Beta/GDB/NHDPLUS_H_{hu4}_HU4_GDB.zip"

# NHD feature types.
FTYPE_UNDERGROUND = 420
FTYPE_COASTLINE = 566
FTYPE_ARTIFICIAL = 558
FTYPE_SINK_RISE = 450
FTYPE_SPRING = 458
FTYPE_BAY_INLET = 312
FTYPE_STREAM_AREA = 460


def gauges(page: str | None = None) -> list[dict]:
    """config/gauges.json, optionally just one map's ("santa-fe", "rainbow", or "st-lucie")."""
    rows = json.loads((CONFIG / "gauges.json").read_text(encoding="utf-8"))
    return [g for g in rows if page is None or g["page"] == page]


def salinity_stations() -> list[dict]:
    """config/salinity.json: the St. Lucie estuary's salinity stations."""
    return json.loads((CONFIG / "salinity.json").read_text(encoding="utf-8"))


def named_sinks() -> list[dict]:
    return json.loads((CONFIG / "sinks.json").read_text(encoding="utf-8"))["sinks"]
