"""Data for the Kissimmee River map (kissimmee.json).

- River: NHDPlus HR's main path of the Kissimmee (the level path carrying most of the
  named river) from S-65 at Lake Kissimmee to S-65E at Lake Okeechobee. Each vertex is
  classed by what the river is there (RIVER_CLASSES):
    0 canal: C-38, still open, below Lake Kissimmee and above Lake Okeechobee;
    1 river: the restored, winding channel;
    2 filled: canal backfilled in the last phase (finished 2021). NHD, last edited here
      in 2016, still routes the river down it, and nothing has mapped the channel the
      river took back since, so the page draws the water spreading over the floodplain.
  OpenStreetMap's C-38 ways say which stretches were backfilled (tagged
  "derelict_canal"). Where NHD's path follows one of them, it's filled if the path runs
  straight there and river if it winds; where it follows an open one, it's canal.
- Filled: those backfilled stretches, from OpenStreetMap, for the page to draw as a ghost.
- Old channel: NHD's other river flowlines in the floodplain: bends the canal cut off,
  still lying beside it, and the old channel the last phase reconnected.
- Istokpoga: Canal C-41A from Lake Istokpoga's outlet (S-68) to the river above S-65E.
- Water: lakes and wetlands (NHD waterbodies), with the floodplain's wetlands apart, for
  glints.
- History: water-year mean flow at S-65E, from USGS (1929-2004) and the Corps' CWMS
  (2015 on, S-65E plus its new spillway, S-65EX1).
"""

from __future__ import annotations

import bisect
import math
from datetime import date

import shapely
from shapely.geometry import LineString, Point
from shapely.ops import unary_union

from . import config as C
from . import cwms, nhd, usgs
from .fetch import get_json, log
from .geo import ORIGIN, SCALE, meters, pack
from .rainbow import water_years
from .rivers import KM2_PER_DEG2, drop_specks, polygon_rings

HU4 = "0309"
#: Where the river's flowlines are read: the floodplain from Lake Kissimmee to Lake Okeechobee.
CORRIDOR: C.Bbox = (-81.35, 27.15, -80.85, 27.85)
RIVER_CLASSES = ["canal", "river", "filled"]
#: A vertex this close to one of OpenStreetMap's C-38 ways (m) is on it.
ON_CANAL_M = 150.0
#: Sinuosity (path length over straight distance) across WINDOW_M of path above which it winds.
WINDOW_M, WINDING = 1500.0, 1.15
#: The river's old channel: other StreamRiver flowlines this close to the main path (m).
FLOODPLAIN_M = 2500.0
#: Wetlands this close to the main path (degrees, ~2.5 km) are the floodplain's.
FLOODPLAIN_DEG = 0.025
SIMPLIFY_DEG = 0.00004
LAKE_KM2, SWAMP_KM2, LAKE_TOL, SWAMP_TOL = 0.2, 0.3, 0.0003, 0.0006
#: Wetlands off the floodplain are only background: bigger pieces, coarser.
OUTER_SPECK_KM2, OUTER_TOL = 2.0, 0.0015
S65E_USGS = "02273000"
FTYPE_STREAM = 460
OSM_QUERY = """[out:json][timeout:120];
way["waterway"~"canal|derelict_canal"]["ref"="C-38"](27.15,-81.3,27.85,-80.85);
out tags geom;"""


def to_m(lon: float, lat: float) -> tuple[float, float]:
    """Local meters, near enough over the map."""
    return lon * 111_320 * math.cos(math.radians(27.5)), lat * 110_540


def c38(refresh: bool = False) -> tuple[list[list[tuple[float, float]]], list[list[tuple[float, float]]]]:
    """OpenStreetMap's C-38 ways: (open canal, backfilled), each a list of lon/lat lines."""
    body = get_json(C.OVERPASS, {"data": OSM_QUERY}, refresh=refresh)
    open_, filled = [], []
    for e in body["elements"]:
        line = [(p["lon"], p["lat"]) for p in e.get("geometry", [])]
        if len(line) < 2:
            continue
        (filled if e["tags"].get("waterway") == "derelict_canal" else open_).append(line)
    if not filled or not open_:
        raise RuntimeError("OpenStreetMap has no open or backfilled C-38 ways")
    return open_, filled


def sinuosity(path: list[tuple[float, float]]) -> list[float]:
    """Path length over straight distance across WINDOW_M of path around each vertex."""
    cum = [0.0]
    for k in range(len(path) - 1):
        cum.append(cum[-1] + meters(path[k], path[k + 1]))
    out = []
    for k in range(len(path)):
        i = max(0, bisect.bisect_left(cum, cum[k] - WINDOW_M))
        j = min(len(path) - 1, bisect.bisect_right(cum, cum[k] + WINDOW_M) - 1)
        d = meters(path[i], path[j])
        out.append((cum[j] - cum[i]) / d if d > 0 else 1.0)
    return out


def classify(path: list[tuple[float, float]], open_: list, filled: list) -> list[int]:
    """Each vertex's class (RIVER_CLASSES): see the module note."""
    as_m = lambda lines: unary_union([LineString([to_m(*c) for c in ln]) for ln in lines])  # noqa: E731
    near_open, near_filled = as_m(open_).buffer(ON_CANAL_M), as_m(filled).buffer(ON_CANAL_M)
    shapely.prepare(near_open)
    shapely.prepare(near_filled)
    wind = sinuosity(path)
    out = []
    for p, s in zip(path, wind):
        q = Point(to_m(*p))
        if near_filled.contains(q):
            out.append(1 if s > WINDING else 2)
        elif near_open.contains(q):
            out.append(0)
        else:
            out.append(1)
    return out


def simplify(path: list[tuple[float, float]], classes: list[int]) -> tuple[list[tuple[float, float]], list[int]]:
    """Simplify each run of one class on its own, so the class changes stay where they are.
    A segment takes its first vertex's class, so each run reaches on to the next run's
    first vertex and leaves that vertex to the next run."""
    pts: list[tuple[float, float]] = []
    cls: list[int] = []
    i = 0
    while i < len(path):
        j = i
        while j + 1 < len(path) and classes[j + 1] == classes[i]:
            j += 1
        last = j == len(path) - 1
        run = path[i : j + 1] if last else path[i : j + 2]
        line = list(LineString(run).simplify(SIMPLIFY_DEG).coords) if len(run) > 2 else run
        for c in line if last else line[:-1]:
            pts.append(c)
            cls.append(classes[i])
        i = j + 1
    return pts, cls


def run_miles(path: list[tuple[float, float]], classes: list[int]) -> dict[str, float]:
    """Miles of the path in each class."""
    out = dict.fromkeys(RIVER_CLASSES, 0.0)
    for k in range(len(path) - 1):
        out[RIVER_CLASSES[classes[k]]] += meters(path[k], path[k + 1]) / 1609.34
    return {k: round(v, 1) for k, v in out.items()}


def old_channel(path: list[tuple[float, float]]) -> list[list[int]]:
    """NHD's other river flowlines in the floodplain, packed."""
    main = LineString([to_m(*c) for c in path])
    floodplain = main.buffer(FLOODPLAIN_M)
    on_main = main.buffer(60)
    shapely.prepare(floodplain)
    shapely.prepare(on_main)
    cols, geoms = nhd.table(HU4, "NHDFlowline", ["FType", "GNIS_Name"], bbox=CORRIDOR, geometry=True)
    out = []
    for ft, name, g in zip(cols["ftype"], cols["gnis_name"], geoms):
        if int(ft) != FTYPE_STREAM or (name and name != "Kissimmee River"):
            continue
        for part in shapely.get_parts(g):
            coords = list(part.simplify(SIMPLIFY_DEG).coords)
            mid = Point(to_m(*part.interpolate(0.5, normalized=True).coords[0]))
            if len(coords) >= 2 and floodplain.contains(mid) and not on_main.contains(mid):
                out.append(pack(coords))
    return out


def water(path: list[tuple[float, float]]) -> tuple[list[dict], list[list[int]], float]:
    """Lakes and the wetlands off the floodplain, largest first, packed like the lakes
    files; and the floodplain's wetlands on their own (the page glints them), and their km²."""
    cols, geoms = nhd.table(HU4, "NHDWaterbody", ["GNIS_Name", "FType", "AreaSqKm"], bbox=C.KISS_WATER, geometry=True)
    near = LineString(path).buffer(FLOODPLAIN_DEG)
    shapely.prepare(near)
    lakes, swamps = [], []
    for name, ft, a, g in zip(cols["gnis_name"], cols["ftype"], cols["areasqkm"], geoms):
        ft = int(ft)
        if ft in (390, 436) and a >= LAKE_KM2:
            lakes.append((name, g))
        elif ft == 466 and a >= SWAMP_KM2:
            swamps.append(g)
    bodies = []
    for name, g in lakes:
        g = g.simplify(LAKE_TOL, preserve_topology=True)
        rings = polygon_rings(g)
        if rings:
            bodies.append({"name": name or None, "kind": "lake", "km2": round(g.area * KM2_PER_DEG2, 2), "rings": rings})
    marsh = unary_union(swamps)
    floodplain = drop_specks(marsh.intersection(near), SWAMP_KM2)
    rest = drop_specks(marsh.difference(near), OUTER_SPECK_KM2)
    rest = rest.simplify(OUTER_TOL, preserve_topology=True)
    bodies.append({"name": None, "kind": "swamp", "km2": round(rest.area * KM2_PER_DEG2, 1), "rings": polygon_rings(rest)})
    bodies.sort(key=lambda b: -b["km2"])
    log(f"kissimmee: {len(lakes)} lakes, {floodplain.area * KM2_PER_DEG2:.0f} km² of floodplain wetland")
    return bodies, polygon_rings(floodplain.simplify(SWAMP_TOL, preserve_topology=True)), round(floodplain.area * KM2_PER_DEG2, 1)


def history(refresh: bool = False) -> dict:
    """Water-year mean flow at S-65E: USGS's record, then the Corps' (S-65E plus S-65EX1)."""
    old = water_years(usgs.daily(S65E_USGS, refresh))
    days = cwms.daily("S65E.Flow.Inst.1Hour.0.SFWMD-WM", 2014, refresh)
    spill = cwms.daily("S65EX1.Flow.Ave.~1Day.1Day.SFWMD-WM-Computed", 2022, refresh, per_day=1)
    new = water_years({d: v + spill.get(d, 0.0) for d, v in days.items()})
    known = old | {y: v for y, v in new.items() if y not in old}
    years = list(range(min(known), max(known) + 1))
    return {"years": years, "S65E": [known.get(y) for y in years]}


def build(refresh: bool = False) -> dict:
    s = {st["name"]: (st["lon"], st["lat"]) for st in C.KISS_STRUCTURES}
    path = nhd.level_path(HU4, CORRIDOR, "Kissimmee River", s["S-65"], s["S-65E"])
    open_, filled = c38(refresh)
    classes = classify(path, open_, filled)
    miles = run_miles(path, classes)
    pts, cls = simplify(path, classes)
    istokpoga = nhd.level_path(HU4, CORRIDOR, "Canal C-41A", s["S-68"], s["S-65E"])
    bodies, floodplain, floodplain_km2 = water(path)
    hist = history(refresh)
    log(f"kissimmee: river {len(pts)} vertices, miles {miles}; C-41A {len(istokpoga)} vertices; flow for water years {hist['years'][0]}-{hist['years'][-1]}")
    return {
        "meta": {
            "generator": "waterways-pipeline kissimmee",
            "generatedAt": date.today().isoformat(),
            "sources": [C.NHD_BULK, C.OVERPASS, f"{C.USGS_API}/daily", f"{C.CWMS}/timeseries"],
            "coordOrigin": list(ORIGIN),
            "coordScale": SCALE,
            "classes": RIVER_CLASSES,
        },
        "river": {"p": pack(pts), "c": cls, "miles": miles},
        "filled": [pack(line) for line in filled],
        "oldChannel": old_channel(path),
        "istokpoga": pack(istokpoga),
        "water": bodies,
        "floodplain": floodplain,
        "floodplainKm2": floodplain_km2,
        "structures": C.KISS_STRUCTURES,
        "history": hist,
    }

