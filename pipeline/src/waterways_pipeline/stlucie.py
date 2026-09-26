"""Data for the St. Lucie map (st-lucie.json).

- Rivers: NHDPlus HR main stems of the St. Lucie Canal (C-44), which runs from Lake
  Okeechobee at Port Mayaca to the St. Lucie Lock, the South and North Forks, the
  estuary out to the St. Lucie Inlet, C-23 (NHD's County Line Canal), and the Indian
  River Lagoon. NHD runs the South Fork and the estuary as one level path, so it's
  split where the North Fork joins.
- Water: the Atlantic, the estuary and lagoon, Lake Okeechobee, and the other lakes,
  packed like the lakes files. The Census outlines that give the sea its coast count the
  estuary and the lagoon as land, so NHD's estuary and wide-river polygons join the sea.
- History: water-year mean flow where the canal leaves the lake (S-308 at Port Mayaca)
  and where it reaches the estuary (S-80, the St. Lucie Lock). USGS reports flow back
  into the lake as negative. S-80's record is two gauges: the old one at the lock
  (1953-2003) and the new one just above it (2017 on).
"""

from __future__ import annotations

from datetime import date

from shapely.geometry import box, shape
from shapely.ops import unary_union

from . import config as C
from . import usgs
from .coast import sea as census_sea
from .fetch import arcgis_query, log
from .geo import ORIGIN, SCALE
from .rainbow import water_years
from .rivers import KM2_PER_DEG2, LAKE_MIN_KM2, LAKE_SIMPLIFY_DEG, SEA_SIMPLIFY_DEG, SEA_SPECK_KM2, drop_specks, main_stems, polygon_rings

#: S-80's earlier gauge, at the lock itself; config/gauges.json has the current one.
S80_OLD = "02277000"
#: Lakes and reservoirs from NHDWaterbody.
LAKE_FTYPES = (390, 436)


def history(refresh: bool = False) -> dict:
    site = {g["key"]: g["id"] for g in C.gauges("st-lucie")}
    s308 = water_years(usgs.daily(site["S308"], refresh, signed=True))
    s80 = water_years(usgs.daily(S80_OLD, refresh, signed=True)) | water_years(usgs.daily(site["S80"], refresh, signed=True))
    years = list(range(min(s308 | s80), max(s308 | s80) + 1))
    return {"years": years, "S308": [s308.get(y) for y in years], "S80": [s80.get(y) for y in years]}


def water(refresh: bool = False) -> list[dict]:
    """The sea (with the estuary and lagoon), then lakes largest first, like the lakes files."""
    areas = [
        f
        # Wide rivers (the estuary and the lower forks) and bays (the lagoon, its coves, and the inlet).
        for ftype in (C.FTYPE_STREAM_AREA, C.FTYPE_BAY_INLET)
        for f in arcgis_query(C.NHD_AREAS, C.STLUCIE_WATER, where=f"ftype = {ftype}", fields="nhdplusid,gnis_name,ftype", refresh=refresh)
    ]
    parts = [census_sea(refresh, C.STLUCIE_SEA, lagoons=[])] + [shape(f["geometry"]).intersection(box(*C.STLUCIE_WATER)) for f in areas if f.get("geometry")]
    sea = drop_specks(unary_union(parts), SEA_SPECK_KM2).simplify(SEA_SIMPLIFY_DEG, preserve_topology=True)
    bodies = [{"name": None, "kind": "sea", "km2": round(sea.area * KM2_PER_DEG2), "rings": polygon_rings(sea)}]
    ftypes = ",".join(map(str, LAKE_FTYPES))
    lakes = arcgis_query(C.NHD_WATERBODIES, C.STLUCIE_WATER, where=f"areasqkm >= {LAKE_MIN_KM2} AND ftype IN ({ftypes})", fields="nhdplusid,gnis_name,ftype,areasqkm", refresh=refresh)
    for f in sorted(lakes, key=lambda f: -float(f["properties"]["areasqkm"])):
        if not f.get("geometry"):
            continue
        g = shape(f["geometry"]).intersection(box(*C.STLUCIE_WATER)).simplify(LAKE_SIMPLIFY_DEG, preserve_topology=True)
        if rings := polygon_rings(g):
            p = f["properties"]
            bodies.append({"name": p.get("gnis_name") or None, "kind": "lake", "km2": round(float(p["areasqkm"]), 2), "rings": rings})
    log(f"st-lucie: sea in {len(bodies[0]['rings'])} rings, {len(bodies) - 1} lakes")
    return bodies


SOUTH_FORK = "South Fork Saint Lucie River"
NORTH_FORK = "North Fork Saint Lucie River"
ESTUARY = "Saint Lucie River"


def split_forks(rivers: dict[str, dict]) -> dict[str, dict]:
    """Cut the South Fork's level path, which runs on through the estuary to the inlet,
    at the vertex nearest the North Fork's mouth. Both halves keep that vertex."""
    path = rivers[SOUTH_FORK]
    if path["p"] != rivers[ESTUARY]["p"]:
        raise RuntimeError("NHD no longer runs the South Fork and the estuary as one level path")
    mouth = rivers[NORTH_FORK]["p"][-1]
    k = min(range(len(path["p"])), key=lambda i: (path["p"][i][0] - mouth[0]) ** 2 + (path["p"][i][1] - mouth[1]) ** 2)
    if not 0 < k < len(path["p"]) - 1:
        raise RuntimeError("the North Fork doesn't join the South Fork's path")
    return rivers | {
        SOUTH_FORK: {"p": path["p"][: k + 1], "u": path["u"][: k + 1]},
        ESTUARY: {"p": path["p"][k:], "u": path["u"][k:]},
    }


def build(refresh: bool = False) -> dict:
    rivers = split_forks(main_stems(C.STLUCIE_RIVERS, C.STLUCIE_VIEW, refresh))
    hist = history(refresh)
    known = [y for y, a, b in zip(hist["years"], hist["S308"], hist["S80"]) if a is not None or b is not None]
    log(f"st-lucie: flows for water years {known[0]}-{known[-1]}")
    return {
        "meta": {
            "generator": "waterways-pipeline st-lucie",
            "generatedAt": date.today().isoformat(),
            "sources": [C.NHD_FLOWLINES, C.NHD_AREAS, C.NHD_WATERBODIES, C.CENSUS_STATES, f"{C.USGS_API}/daily"],
            "coordOrigin": list(ORIGIN),
            "coordScale": SCALE,
        },
        "rivers": rivers,
        "water": water(refresh),
        "history": hist,
    }
