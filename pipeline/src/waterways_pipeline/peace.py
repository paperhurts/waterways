"""Data for the Peace River map (peace.json).

- Rivers: NHDPlus HR main paths of the Peace River from its head below Lake Hancock to
  Charlotte Harbor, and its gauged tributaries (TRIBUTARIES), snapped to the packing grid.
- Kissengen Spring, which fed the river until it went dry in 1950, and the sinks along
  the upper river that FGS's swallet survey mapped (names and places only).
- Aquifer: how far the Upper Floridan's potentiometric surface has fallen since before
  development, gridded from FGS contours the way the Santa Fe map's are
  (aquifer.interpolate): the pre-development surface less September 2022's (the latest)
  and May 2022's (the dry season), whole feet, clipped at 0.
- Mines: land mined for phosphate under FDEP's mandatory reclamation program (every
  mined unit on its 2021 map), geometry only.
- Water: Charlotte Harbor and the sea (the rain map's salt water), lakes, and wetlands.
- History: water-year mean flow of the Peace at Bartow and at Arcadia, from USGS.
"""

from __future__ import annotations

import base64
from datetime import date

import numpy as np
import shapely
from shapely.geometry import box, shape
from shapely.ops import unary_union
from shapely.validation import make_valid

from . import aquifer, nhd, rain, usgs
from . import config as C
from .fetch import arcgis_query, log
from .geo import ORIGIN, SCALE, pack
from .rainbow import water_years
from .rivers import KM2_PER_DEG2, drop_specks, polygon_rings

HU4 = "0310"
SIMPLIFY_DEG = 0.0002
#: The tributaries drawn, each whole within the view, and the gauge whose water it brings.
TRIBUTARIES = {"Charlie Creek": "CHR", "Horse Creek": "HRS", "Joshua Creek": "JOS", "Payne Creek": None, "Saddle Creek": None, "Shell Creek": None}
LAKE_KM2, SWAMP_KM2 = 1.0, 3.0
LAKE_TOL, SWAMP_TOL, SEA_TOL = 0.0008, 0.003, 0.0015
MINE_TOL = 0.0012
#: Contours are fetched this far past the grid, so its edges are shaped by lines outside it.
FETCH_PAD_DEG = 0.35
#: Swallets this close to the river's path (degrees, ~1.5 km) are the upper Peace's sinks.
SINK_DEG = 0.015
NOW, DRY = "September 2022", "May 2022"


def simplified(path: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """Simplified, then snapped to the packing grid with repeats dropped."""
    out: list[tuple[float, float]] = []
    for x, y in shapely.LineString(path).simplify(SIMPLIFY_DEG).coords:
        q = (ORIGIN[0] + round((x - ORIGIN[0]) * SCALE) / SCALE, ORIGIN[1] + round((y - ORIGIN[1]) * SCALE) / SCALE)
        if not out or q != out[-1]:
            out.append(q)
    return out


def rivers() -> dict[str, list[tuple[float, float]]]:
    g = {x["key"]: (x["lon"], x["lat"]) for x in C.gauges("peace")}
    out = {"Peace River": nhd.level_path(HU4, C.PEACE_VIEW, "Peace River", g["BAR"], C.PEACE_MOUTH)}
    for name in TRIBUTARIES:
        out[name] = nhd.level_path(HU4, C.PEACE_VIEW, name)
    return out


def grid_bbox(spec: dict, pad: float) -> C.Bbox:
    return (spec["lon0"] - pad, spec["lat0"] - pad, spec["lon0"] + (spec["nx"] - 1) * spec["res"] + pad, spec["lat0"] + (spec["ny"] - 1) * spec["res"] + pad)


def drawdown(refresh: bool = False) -> dict:
    """How far each surface is below the pre-development one, whole feet, base64 bytes, row 0 south."""
    spec = C.PEACE_GRID
    bb = grid_bbox(spec, FETCH_PAD_DEG)
    pre = aquifer.interpolate(aquifer.fetch_contours("Pre-development", refresh, bb), spec)
    out = dict(spec)
    for key, month in (("now", NOW), ("dry", DRY)):
        z = pre - aquifer.interpolate(aquifer.fetch_contours(month, refresh, bb), spec)
        out[key] = base64.b64encode(np.clip(np.round(z), 0, 255).astype(np.uint8).tobytes()).decode()
        out[f"{key}Max"] = int(round(float(z.max())))
    out["months"] = {"now": NOW, "dry": DRY}
    return out


def sinks(path: list[tuple[float, float]], refresh: bool = False) -> list[list]:
    """[name, lon, lat] for FGS's swallets along the river."""
    near = shapely.LineString(path).buffer(SINK_DEG)
    shapely.prepare(near)
    feats = arcgis_query(C.FGS_SWALLETS, C.PEACE_VIEW, fields="NAME,LATITUDE,LONGITUDE", refresh=refresh)
    out = []
    for f in feats:
        p = f["properties"]
        lon, lat = float(p["LONGITUDE"]), float(p["LATITUDE"])
        if near.contains(shapely.Point(lon, lat)):
            out.append([(p.get("NAME") or "").strip() or None, round(lon, 5), round(lat, 5)])
    return out


def mines(refresh: bool = False) -> tuple[list[list[int]], int]:
    feats = arcgis_query(C.FDEP_MINED_UNITS, C.PEACE_WATER, fields="OBJECTID", refresh=refresh)
    g = unary_union([make_valid(shape(f["geometry"])) for f in feats if f.get("geometry")])
    log(f"peace: {len(feats)} mined units, {g.area * KM2_PER_DEG2:.0f} km²")
    return polygon_rings(g.simplify(MINE_TOL, preserve_topology=True)), round(g.area * KM2_PER_DEG2)


def water(refresh: bool = False) -> list[dict]:
    clip = box(*C.PEACE_WATER)
    states = arcgis_query(C.CENSUS_STATES, C.PEACE_WATER, fields="STUSAB", refresh=refresh)
    land = unary_union([make_valid(shape(f["geometry"])) for f in states if f.get("geometry")])
    sea = drop_specks(rain.salt_water(land, refresh).intersection(clip), 0.3).simplify(SEA_TOL, preserve_topology=True)
    bodies = [{"name": None, "kind": "sea", "km2": round(sea.area * KM2_PER_DEG2), "rings": polygon_rings(sea)}]
    cols, geoms = nhd.table(HU4, "NHDWaterbody", ["GNIS_Name", "FType", "AreaSqKm"], bbox=C.PEACE_WATER, geometry=True)
    swamps = []
    for name, ft, a, g in zip(cols["gnis_name"], cols["ftype"], cols["areasqkm"], geoms):
        ft = int(ft)
        if ft in (390, 436) and a >= LAKE_KM2:
            g = g.intersection(clip).simplify(LAKE_TOL, preserve_topology=True)
            if rings := polygon_rings(g):
                bodies.append({"name": name or None, "kind": "lake", "km2": round(g.area * KM2_PER_DEG2, 1), "rings": rings})
        elif ft == 466:
            swamps.append(g)
    marsh = drop_specks(unary_union(swamps).intersection(clip), SWAMP_KM2).simplify(SWAMP_TOL, preserve_topology=True)
    bodies.append({"name": None, "kind": "swamp", "km2": round(marsh.area * KM2_PER_DEG2), "rings": polygon_rings(marsh)})
    return sorted(bodies, key=lambda b: (b["kind"] != "sea", -b["km2"]))


def history(refresh: bool = False) -> dict:
    site = {g["key"]: g["id"] for g in C.gauges("peace")}
    bartow = water_years(usgs.daily(site["BAR"], refresh))
    arcadia = water_years(usgs.daily(site["ARC"], refresh))
    known = bartow | arcadia
    years = list(range(min(known), max(known) + 1))
    return {"years": years, "BAR": [bartow.get(y) for y in years], "ARC": [arcadia.get(y) for y in years]}


def build(refresh: bool = False) -> dict:
    paths = {name: simplified(p) for name, p in rivers().items()}
    peace = paths["Peace River"]
    mined, mined_km2 = mines(refresh)
    hist = history(refresh)
    dd = drawdown(refresh)
    sink_list = sinks(peace, refresh)
    log(f"peace: {sum(len(p) for p in paths.values())} river vertices, {len(sink_list)} sinks, drawdown up to {dd['nowMax']} ft ({dd['dryMax']} in the dry season), flow for water years {hist['years'][0]}-{hist['years'][-1]}")
    return {
        "meta": {
            "generator": "waterways-pipeline peace",
            "generatedAt": date.today().isoformat(),
            "sources": [C.NHD_BULK, C.FGS_POTENTIOMETRIC, C.FGS_SWALLETS, C.FDEP_MINED_UNITS, C.FDEP_SPRINGS, C.CENSUS_STATES, f"{C.USGS_API}/daily"],
            "coordOrigin": list(ORIGIN),
            "coordScale": SCALE,
        },
        "rivers": {name: pack(p) for name, p in paths.items()},
        "tributaries": {name: key for name, key in TRIBUTARIES.items()},
        "kissengen": list(C.KISSENGEN),
        "sinks": sink_list,
        "aquifer": dd,
        "mines": mined,
        "minesKm2": mined_km2,
        "water": water(refresh),
        "history": hist,
    }
