"""Data for the Lake Okeechobee map (lake-o.json).

- Rivers: NHDPlus HR main stems of the lake's big inflows (the Kissimmee, Fisheating
  Creek) and its outlets: the Caloosahatchee west, the St. Lucie Canal east, and the
  Miami, North New River, Hillsboro, and West Palm Beach canals south. NHD carries
  some of them across the lake on artificial paths (the Kissimmee runs on through it
  and out the St. Lucie Canal), so every path is cut at the shore: an inflow keeps
  what's above the lake, an outlet what's below it.
- Water: the sea (with NHD's bays), then the lake, the other lakes, and the marshes,
  packed like the lakes files. The Everglades draw as marsh.
- History: water-year mean flow out of the lake three ways, from USGS daily records.
  East: the St. Lucie Canal at Port Mayaca (S-308). West: the Caloosahatchee at Moore
  Haven (S-77), joined from the old gauge (1938-2003) and the new one (2008 on). South:
  the farm canals at S-351 (Hillsboro and North New River) and S-354 (Miami), summed in
  years all three report. USGS stopped gauging the fourth, the West Palm Beach Canal at
  S-352, in 2008, so it's left out. Flow back into the lake is negative: in the 1960s and
  70s, the south canals often pumped farm runoff into it.
"""

from __future__ import annotations

from datetime import date

from shapely.geometry import Point, box, shape
from shapely.ops import unary_union
from shapely.validation import make_valid

from . import coast
from . import config as C
from . import usgs
from .fetch import arcgis_query, log
from .geo import ORIGIN, SCALE
from .rainbow import water_years
from .rivers import KM2_PER_DEG2, SEA_SIMPLIFY_DEG, SEA_SPECK_KM2, drop_specks, main_stems, polygon_rings, waterbodies

#: S-77's earlier gauge at Moore Haven; config/gauges.json has the current one.
S77_OLD = "02292000"
SOUTH = ("S351H", "S351N", "S354")
INFLOWS = ("Kissimmee River", "Fisheating Creek")
#: A path counts as in the lake this far (degrees, ~300 m) inside its shore, so canals
#: that hug the dike aren't cut.
SHORE_DEG = 0.003
#: NHD simplifies the lake and the marshes this much (degrees, ~30 m) before sending them.
#: Its simplified rings can cross themselves, so they're repaired with make_valid.
GENERALIZE_DEG = 0.0003
#: The smallest lake and marsh (km²) worth drawing at this map's scale.
MIN_KM2 = (1.0, 5.0)


def site(key: str) -> str:
    return next(g["id"] for g in C.gauges() if g["key"] == key)


def summed(parts: list[dict[int, int]]) -> dict[int, int]:
    """Year-by-year sum, only in years every part reports."""
    years = set.intersection(*(set(p) for p in parts))
    return {y: sum(p[y] for p in parts) for y in years}


def history(refresh: bool = False) -> dict:
    wy = lambda s: water_years(usgs.daily(s, refresh, signed=True))  # noqa: E731
    east = wy(site("S308"))
    west = wy(S77_OLD) | wy(site("S77"))
    south = summed([wy(site(k)) for k in SOUTH])
    known = east | west | south
    years = list(range(min(known), max(known) + 1))
    return {"years": years, "east": [east.get(y) for y in years], "west": [west.get(y) for y in years], "south": [south.get(y) for y in years]}


def lake_outline(refresh: bool = False):
    feats = arcgis_query(C.NHD_WATERBODIES, C.LAKEO_VIEW, where="gnis_name = 'Lake Okeechobee'", fields="nhdplusid,areasqkm", refresh=refresh, generalize=GENERALIZE_DEG)
    return unary_union([make_valid(shape(f["geometry"])) for f in feats if f.get("geometry")])


def cut_at_shore(rivers: dict[str, dict], lake, inflows: tuple[str, ...] = INFLOWS) -> dict[str, dict]:
    """Each inflow up to its first vertex in the lake; each outlet from its last one."""
    inner = lake.buffer(-SHORE_DEG)
    out = {}
    for name, r in rivers.items():
        wet = [i for i, p in enumerate(r["p"]) if inner.contains(Point(p))]
        a, b = (0, wet[0] + 1) if name in inflows and wet else (wet[-1], len(r["p"])) if wet else (0, len(r["p"]))
        out[name] = {"p": r["p"][a:b], "u": r["u"][a:b]}
    return out


def water(refresh: bool = False) -> list[dict]:
    """The sea and NHD's bays, then lakes and marshes largest first, like the lakes files."""
    # NHD's bays (San Carlos Bay, the lagoons) join the sea: the Census outlines count them as land.
    bays = arcgis_query(C.NHD_AREAS, C.LAKEO_WATER, where=f"ftype = {C.FTYPE_BAY_INLET}", fields="nhdplusid", refresh=refresh, generalize=GENERALIZE_DEG)
    sea = unary_union([coast.sea(refresh, C.LAKEO_SEA), *(make_valid(shape(f["geometry"])).intersection(box(*C.LAKEO_WATER)) for f in bays if f.get("geometry"))])
    sea = drop_specks(sea, SEA_SPECK_KM2).simplify(SEA_SIMPLIFY_DEG, preserve_topology=True)
    bodies = waterbodies([C.LAKEO_WATER], refresh, clip=C.LAKEO_WATER, generalize=GENERALIZE_DEG, min_km2=MIN_KM2)
    log(f"lake-o: sea in {len(polygon_rings(sea))} rings, {len(bodies)} lakes and marshes")
    return [{"name": None, "kind": "sea", "km2": round(sea.area * KM2_PER_DEG2), "rings": polygon_rings(sea)}, *bodies]


def build(refresh: bool = False) -> dict:
    rivers = cut_at_shore(main_stems(C.LAKEO_RIVERS, C.LAKEO_VIEW, refresh), lake_outline(refresh))
    hist = history(refresh)
    log(f"lake-o: flows for water years {hist['years'][0]}-{hist['years'][-1]}")
    return {
        "meta": {
            "generator": "waterways-pipeline lake-o",
            "generatedAt": date.today().isoformat(),
            "sources": [C.NHD_FLOWLINES, C.NHD_WATERBODIES, C.NHD_AREAS, C.CENSUS_STATES, f"{C.USGS_API}/daily"],
            "coordOrigin": list(ORIGIN),
            "coordScale": SCALE,
        },
        "rivers": rivers,
        "water": water(refresh),
        "history": hist,
    }
