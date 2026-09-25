"""Data for the statewide springs map (statewide.json). The springs themselves are
springs.json, the journal's list.

- Land: Census cartographic (1:500,000) state outlines around Florida; the page
  paints sea and draws these on top.
- Plans: FDEP's springs basin management action plan (BMAP) areas, drawn around
  the springsheds of the Outstanding Florida Springs.
- Focus areas: FDEP's Springs Priority Focus Areas inside them.
- Lagoons: Florida's coastal lagoons, the shallow water behind its barrier islands,
  from NHD's bulk files (bays, and Lake Worth, which NHD files as a lake). The Census
  outlines count several of them, like the Indian River Lagoon, as land.

Only names and geometry are kept: FDEP's records also carry staff contact details.
"""

from __future__ import annotations

from datetime import date

from shapely.geometry import box, shape
from shapely.ops import unary_union

from . import config as C
from . import nhd
from .fetch import arcgis_query, log
from .geo import ORIGIN, SCALE
from .rivers import KM2_PER_DEG2, polygon_rings

#: Everything the page can show: Florida and a margin of the Gulf, the Atlantic, and Georgia and Alabama.
VIEW: C.Bbox = (-88.2, 24.2, -79.5, 31.6)
LAND_SIMPLIFY_DEG = 0.004
AREA_SIMPLIFY_DEG = 0.003
#: FDEP's plan names are long; the map labels them by their springs.
PLAN_NAMES = {
    "SIRA": "Silver and Rainbow Springs",
    "CHHO": "Homosassa and Chassahowitzka Springs",
    "WACI": "Wacissa Springs",
    "WAKU": "Wakulla Spring",
    "JABL": "Jackson Blue Spring",
    "KING": "Crystal River and Kings Bay",
    "WEKS": "Wekiwa and Rock Springs",
    "VOBL": "Volusia Blue Spring",
    "DELE": "DeLeon Spring",
    "GEMI": "Gemini Springs",
    "WEEK": "Weeki Wachee Spring",
    "SUWA": "Suwannee River springs",
    "SAFE": "Santa Fe River springs",
}


#: Display name → (bulk NHD layer, NHD name, 4-digit HUCs it spans). The river-mouth
#: estuaries (Tampa Bay, Charlotte Harbor, the Panhandle's big bays) aren't lagoons.
LAGOONS = {
    "Indian River Lagoon": ("NHDArea", "Indian River Lagoon", ["0308", "0309"]),
    "Mosquito Lagoon": ("NHDArea", "Mosquito Lagoon", ["0308"]),
    "Lake Worth Lagoon": ("NHDWaterbody", "Lake Worth", ["0309"]),
    "Biscayne Bay": ("NHDArea", "Biscayne Bay", ["0309"]),
    "Estero Bay": ("NHDArea", "Estero Bay", ["0309"]),
    "Pine Island Sound": ("NHDArea", "Pine Island Sound", ["0310"]),
    "Lemon Bay": ("NHDArea", "Lemon Bay", ["0310"]),
    "Sarasota Bay": ("NHDArea", "Sarasota Bay", ["0310"]),
    "Boca Ciega Bay": ("NHDArea", "Boca Ciega Bay", ["0310"]),
    "St. Joseph Bay": ("NHDArea", "Saint Joseph Bay", ["0314"]),
    "Santa Rosa Sound": ("NHDArea", "Santa Rosa Sound", ["0314"]),
    "Big Lagoon": ("NHDArea", "Big Lagoon", ["0314"]),
}
LAGOON_SIMPLIFY_DEG = 0.001


def lagoons(refresh: bool = False) -> list[dict]:
    out = []
    for name, (layer, nhd_name, hu4s) in LAGOONS.items():
        shapes = [g for hu4 in hu4s for g in nhd.named(layer, hu4, nhd_name, refresh)]
        if not shapes:
            raise RuntimeError(f"NHD has no {layer} named {nhd_name!r} in {hu4s}")
        g = unary_union(shapes)
        p = g.representative_point()
        out.append({
            "name": name,
            "km2": round(g.area * KM2_PER_DEG2),
            "rings": polygon_rings(g.simplify(LAGOON_SIMPLIFY_DEG, preserve_topology=True)),
            # A point inside the water: a long, thin lagoon's middle can be dry land.
            "label": [round(p.x, 4), round(p.y, 4)],
        })
    return sorted(out, key=lambda a: -a["km2"])


def land(refresh: bool = False) -> list[list[int]]:
    states = arcgis_query(C.CENSUS_STATES, VIEW, fields="STUSAB", refresh=refresh)
    g = unary_union([shape(f["geometry"]) for f in states if f.get("geometry")]).intersection(box(*VIEW))
    return polygon_rings(g.simplify(LAND_SIMPLIFY_DEG, preserve_topology=True))


def areas(layer: str, where: str, name_field: str, names: dict[str, str] | None, refresh: bool = False) -> list[dict]:
    """[{name, km2, rings}] for each feature, largest first; features sharing a name merge."""
    feats = arcgis_query(layer, VIEW, where=where, fields=name_field, refresh=refresh)
    by: dict[str, list] = {}
    for f in feats:
        if not f.get("geometry"):
            continue
        key = (f["properties"].get(name_field) or "").strip()
        by.setdefault(names.get(key, key) if names else key, []).append(shape(f["geometry"]))
    out = []
    for name, shapes in by.items():
        g = unary_union(shapes)
        out.append({"name": name, "km2": round(g.area * KM2_PER_DEG2), "rings": polygon_rings(g.simplify(AREA_SIMPLIFY_DEG, preserve_topology=True))})
    return sorted(out, key=lambda a: -a["km2"])


def build(refresh: bool = False) -> dict:
    bmap = C.FDEP_PRIORITY_FOCUS.rsplit("/", 1)[0] + "/0"
    plans = areas(bmap, "TYPE='Spring BMAP'", "BMAPID", PLAN_NAMES, refresh)
    missing = {p["name"] for p in plans} - set(PLAN_NAMES.values())
    if missing:
        raise RuntimeError(f"FDEP has springs plans with no display name: {sorted(missing)}")
    focus = areas(C.FDEP_PRIORITY_FOCUS, "1=1", "NAME", None, refresh)
    rings = land(refresh)
    water = lagoons(refresh)
    log(f"statewide: {len(rings)} land rings, {len(plans)} springs plans, {len(focus)} focus areas, {len(water)} lagoons")
    return {
        "meta": {
            "generator": "waterways-pipeline statewide",
            "generatedAt": date.today().isoformat(),
            "sources": [C.CENSUS_STATES, bmap, C.FDEP_PRIORITY_FOCUS, C.NHD_BULK],
            "coordOrigin": list(ORIGIN),
            "coordScale": SCALE,
            "view": list(VIEW),
        },
        "land": rings,
        "plans": plans,
        "focusAreas": focus,
        "lagoons": water,
    }
