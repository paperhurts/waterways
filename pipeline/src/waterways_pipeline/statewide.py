"""Data for the statewide springs map (statewide.json). The springs themselves are
springs.json, the journal's list.

- Land: Census cartographic (1:500,000) state outlines around Florida, less the
  salt water they count as land: every NHD bay and lagoon, and the wide tidal rivers
  that open onto them (the same sea as the rain map's). The page paints sea and draws
  the land on top.
- Plans: FDEP's springs basin management action plan (BMAP) areas, drawn around
  the springsheds of the Outstanding Florida Springs.
- Focus areas: FDEP's Springs Priority Focus Areas inside them.
- Lagoons: Florida's coastal lagoons, the shallow water behind its barrier islands,
  from NHD's bulk files (bays, and Lake Worth, which NHD files as a lake), for their
  names and cards. Their water is already cut out of the land.
- Water: Florida's lakes and big wetlands, so the state reads as the wet place it is
  between the springs. Its creeks and rivers come from the rain map's files.
- Extra springs: NHD spring points more than 150 m from any FDEP spring. They aren't
  in springs.json, so the journal can't log them.

Only names and geometry are kept: FDEP's records also carry staff contact details.
"""

from __future__ import annotations

from datetime import date

import shapely
from shapely.geometry import box, shape
from shapely.ops import unary_union
from shapely.validation import make_valid

from . import config as C
from . import nhd, rain
from .fetch import arcgis_query, log
from .geo import ORIGIN, SCALE
from .rivers import KM2_PER_DEG2, drop_specks, polygon_rings

#: Everything the page can show: Florida and a margin of the Gulf, the Atlantic, and Georgia and Alabama.
VIEW: C.Bbox = (-88.2, 24.2, -79.5, 31.6)
#: Fine enough to keep the lagoons and sounds cut out of the land open. Cutting the bays
#: out leaves thousands of marsh islands (the Ten Thousand Islands); those this small go.
LAND_SIMPLIFY_DEG, LAND_SPECK_KM2 = 0.0025, 1.0
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
LAGOON_SIMPLIFY_DEG = 0.002
#: Lakes and wetlands this big (km²) are drawn, simplified this much (degrees).
LAKE_KM2, SWAMP_KM2 = 2.0, 10.0
LAKE_SIMPLIFY_DEG, SWAMP_SIMPLIFY_DEG, SWAMP_SPECK_KM2, LAKE_SPECK_KM2 = 0.0008, 0.004, 5.0, 0.3


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
    g = unary_union([make_valid(shape(f["geometry"])) for f in states if f.get("geometry")])
    g = drop_specks(g.difference(rain.salt_water(g, refresh)).intersection(box(*VIEW)), LAND_SPECK_KM2)
    return polygon_rings(g.simplify(LAND_SIMPLIFY_DEG, preserve_topology=True))


def florida_near(refresh: bool):
    fl, _ = rain.florida(refresh)
    near = fl.buffer(rain.BORDER_DEG)
    shapely.prepare(near)
    return near


def water(near) -> list[dict]:
    """Florida's lakes and big wetlands, largest first."""
    bodies = rain.waterbodies(
        near, lake_km2=LAKE_KM2, swamp_km2=SWAMP_KM2, lake_tol=LAKE_SIMPLIFY_DEG, swamp_tol=SWAMP_SIMPLIFY_DEG, speck_km2=SWAMP_SPECK_KM2, lake_speck_km2=LAKE_SPECK_KM2, rings_of=polygon_rings
    )
    for b in bodies:
        b.pop("at")
    return bodies


def extra_springs(refresh: bool) -> list[list]:
    """[lon, lat, name] for the springs NHD maps that FDEP doesn't list."""
    return [[lon, lat, name] for lon, lat, name, _, sid in rain.springs_list(refresh) if not sid]


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
    named = lagoons(refresh)
    near = florida_near(refresh)
    bodies = water(near)
    extra = extra_springs(refresh)
    log(
        f"statewide: {len(rings)} land rings, {len(plans)} springs plans, {len(focus)} focus areas, {len(named)} lagoons, "
        f"{len(bodies)} lakes and wetlands, {len(extra)} springs FDEP doesn't list"
    )
    return {
        "meta": {
            "generator": "waterways-pipeline statewide",
            "generatedAt": date.today().isoformat(),
            "sources": [C.CENSUS_STATES, bmap, C.FDEP_PRIORITY_FOCUS, C.NHD_BULK, C.FDEP_SPRINGS],
            "coordOrigin": list(ORIGIN),
            "coordScale": SCALE,
            "view": list(VIEW),
        },
        "land": rings,
        "plans": plans,
        "focusAreas": focus,
        "lagoons": named,
        "water": bodies,
        "extraSprings": extra,
    }
