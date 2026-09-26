"""Data for the St. Johns River map (stjohns.json).

- River: NHDPlus HR's main path of the St. Johns from its headwater marshes to the
  Atlantic at Mayport, snapped to the packing grid, with each vertex's miles from the sea.
- Profile: the river's fall, from NHDPlus's smoothed flowline elevations (MinElevSmo,
  cm) along the path, sampled every PROFILE_STEP_MI miles from the sea, in feet.
- Springs: FDEP's first- and second-magnitude springs within SPRING_DEG of the river,
  which feed it (Blue Spring, Silver Glen, Alexander).
- Water: the sea (the rain map's salt water), the river where NHD maps it wide, lakes,
  and wetlands.
"""

from __future__ import annotations

import json
from datetime import date

import shapely
from shapely.geometry import box, shape
from shapely.ops import unary_union
from shapely.validation import make_valid

from . import config as C
from . import nhd, rain
from .fetch import arcgis_query, log
from .geo import ORIGIN, SCALE, meters, pack
from .rivers import KM2_PER_DEG2, drop_specks, polygon_rings

HU4 = "0308"
NAME = "Saint Johns River"
SIMPLIFY_DEG = 0.0002
PROFILE_STEP_MI = 5
SPRING_DEG = 0.15
LAKE_KM2, SWAMP_KM2 = 2.0, 10.0
LAKE_TOL, SWAMP_TOL, SEA_TOL, FAR_SEA_TOL = 0.001, 0.005, 0.0025, 0.025
MILE_M = 1609.34
FTYPE_STREAM_AREA = 460
#: River areas this close to the path (degrees, ~1 km) are the river.
RIVER_NEAR_DEG = 0.01


def simplified(path: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """Simplified, then snapped to the packing grid with repeats dropped."""
    out: list[tuple[float, float]] = []
    for x, y in shapely.LineString(path).simplify(SIMPLIFY_DEG).coords:
        q = (ORIGIN[0] + round((x - ORIGIN[0]) * SCALE) / SCALE, ORIGIN[1] + round((y - ORIGIN[1]) * SCALE) / SCALE)
        if not out or q != out[-1]:
            out.append(q)
    return out


def miles_to_sea(path: list[tuple[float, float]]) -> list[float]:
    """Each vertex's distance down the path to its end, in miles."""
    out = [0.0]
    for k in range(len(path) - 1, 0, -1):
        out.append(out[-1] + meters(path[k - 1], path[k]) / MILE_M)
    return out[::-1]


def profile(path: list[tuple[float, float]]) -> list[list[float]]:
    """[miles from the sea, feet above it] every PROFILE_STEP_MI miles, from NHD's smoothed
    elevations of the flowlines the path runs along."""
    cols, geoms = nhd.table(HU4, "NHDFlowline", ["NHDPlusID", "GNIS_Name"], bbox=C.SJ_VIEW, geometry=True)
    vaa, _ = nhd.table(HU4, "NHDPlusFlowlineVAA", ["NHDPlusID", "MinElevSmo", "MaxElevSmo"])
    elev = {int(i): (float(lo), float(hi)) for i, lo, hi in zip(vaa["nhdplusid"], vaa["minelevsmo"], vaa["maxelevsmo"]) if lo == lo and hi == hi}
    named = [(int(i), g) for i, n, g in zip(cols["nhdplusid"], cols["gnis_name"], geoms) if n == NAME and int(i) in elev]
    tree = shapely.STRtree([g for _, g in named])
    miles = miles_to_sea(path)
    samples: dict[int, list[float]] = {}
    for p, mi in zip(path, miles):
        i = tree.nearest(shapely.Point(p))
        lo, hi = elev[named[i][0]]
        step = int(round(mi / PROFILE_STEP_MI)) * PROFILE_STEP_MI
        samples.setdefault(step, []).append((lo + hi) / 2 / 30.48)
    out = [[m, round(sum(v) / len(v), 1)] for m, v in sorted(samples.items(), reverse=True)]
    # Smoothed elevations are monotone down a path, but averaging can wobble: keep it falling.
    for k in range(1, len(out)):
        out[k][1] = min(out[k][1], out[k - 1][1])
    return out


def springs_near(path: list[tuple[float, float]]) -> list[list]:
    near = shapely.LineString(path).buffer(SPRING_DEG)
    shapely.prepare(near)
    rows = json.loads((C.OUT / "springs.json").read_text(encoding="utf-8"))["springs"]
    return [[s[0], s[1], s[3], s[4], s[5]] for s in rows if s[5] in (1, 2) and near.contains(shapely.Point(s[3], s[4]))]


def water(path: list[tuple[float, float]], refresh: bool = False) -> list[dict]:
    """The sea with the river where NHD maps it wide, then lakes and wetlands, largest first."""
    clip = box(*C.SJ_WATER)
    states = arcgis_query(C.CENSUS_STATES, C.SJ_SEA, fields="STUSAB", refresh=refresh)
    land = unary_union([make_valid(shape(f["geometry"])) for f in states if f.get("geometry")])
    salt = rain.salt_water(land, refresh).intersection(box(*C.SJ_SEA))
    # The river where NHD maps it wide (StreamRiver areas along its path), miles wide below
    # Palatka, where only the pieces by the sea count as salt water. It joins the sea's
    # shape: the page fills every sea piece together even-odd, so overlaps would cancel.
    along = shapely.LineString(path).buffer(RIVER_NEAR_DEG)
    shapely.prepare(along)
    ac, ag = nhd.table(HU4, "NHDArea", ["FType"], bbox=C.SJ_WATER, geometry=True)
    wide = unary_union([g for ft, g in zip(ac["ftype"], ag) if int(ft) == FTYPE_STREAM_AREA and along.intersects(g)])
    # The river's estuary and the coast beside it in detail; the rest only fills the screen's edges.
    near = drop_specks(unary_union([salt.intersection(clip), wide]), 0.3).simplify(SEA_TOL, preserve_topology=True)
    far = drop_specks(salt.difference(clip), 20.0).simplify(FAR_SEA_TOL, preserve_topology=True)
    bodies = [{"name": None, "kind": "sea", "km2": round(g.area * KM2_PER_DEG2), "rings": polygon_rings(g)} for g in (near, far)]
    cols, geoms = nhd.table(HU4, "NHDWaterbody", ["GNIS_Name", "FType", "AreaSqKm"], bbox=C.SJ_WATER, geometry=True)
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


def build(refresh: bool = False) -> dict:
    path = simplified(nhd.level_path(HU4, C.SJ_VIEW, NAME, C.SJ_HEAD, C.SJ_MOUTH))
    miles = miles_to_sea(path)
    prof = profile(path)
    sp = springs_near(path)
    log(f"stjohns: river {len(path)} vertices, {miles[0]:.0f} miles, falling {prof[0][1]} ft; {len(sp)} big springs near it")
    return {
        "meta": {
            "generator": "waterways-pipeline stjohns",
            "generatedAt": date.today().isoformat(),
            "sources": [C.NHD_BULK, C.FDEP_SPRINGS, C.CENSUS_STATES],
            "coordOrigin": list(ORIGIN),
            "coordScale": SCALE,
        },
        "river": {"p": pack(path), "miles": round(miles[0], 1)},
        "profile": prof,
        "springs": sp,
        "water": water(path, refresh),
    }
