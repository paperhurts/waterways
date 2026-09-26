"""Data for the Ocklawaha River map (ocklawaha.json).

- Rivers: NHDPlus HR main paths of the Ocklawaha from Moss Bluff (Lake Griffin's outlet)
  to the St. Johns, the Silver River from Silver Springs to it, and Orange Creek from its
  gauge into Rodman Reservoir. The Ocklawaha's vertices are flagged where they're in the
  reservoir: NHD runs the river across it on an artificial path.
- Reservoir: Rodman Reservoir, which NHD names Lake Ocklawaha, behind the Kirkpatrick
  (Rodman) Dam, built in 1968 for the Cross Florida Barge Canal.
- Canal: NHD's Cross Florida Barge Canal, the cut from the reservoir to the St. Johns
  at Buckman Lock.
- Drowned springs: FDEP springs in the reservoir (within DROWNED_DEG of it).
- Water: lakes, the St. Johns (NHD's wide-river areas), and wetlands.
- History: water-year mean flow of the Silver River (Silver Springs' run) and of the
  Ocklawaha at Eureka, above the reservoir, from USGS daily records.
"""

from __future__ import annotations

import json
from datetime import date

import shapely
from shapely.geometry import Point, box
from shapely.ops import unary_union

from . import config as C
from . import nhd, usgs
from .fetch import log
from .geo import ORIGIN, SCALE, pack
from .rainbow import water_years
from .rivers import KM2_PER_DEG2, drop_specks, polygon_rings

HU4 = "0308"
RESERVOIR = "Lake Ocklawaha"
#: The river counts as in the reservoir this close to it (degrees, ~100 m).
IN_RESERVOIR_DEG = 0.001
#: A spring this close to the reservoir (degrees, ~500 m) is under it or on its drowned shore.
DROWNED_DEG = 0.005
SIMPLIFY_DEG = 0.00004
LAKE_KM2, SWAMP_KM2, RIVER_KM2 = 0.3, 2.0, 0.3
LAKE_TOL, SWAMP_TOL = 0.0003, 0.002
FTYPE_STREAM_AREA = 460


def simplified(path: list[tuple[float, float]]) -> list[tuple[float, float]]:
    return list(shapely.LineString(path).simplify(SIMPLIFY_DEG).coords)


def reservoir(refresh: bool = False):
    cols, geoms = nhd.table(HU4, "NHDWaterbody", ["GNIS_Name"], bbox=C.OCK_VIEW, geometry=True)
    parts = [g for n, g in zip(cols["gnis_name"], geoms) if n == RESERVOIR]
    if not parts:
        raise RuntimeError(f"no NHD waterbody named {RESERVOIR!r}")
    return unary_union(parts)


def flag_reservoir(path: list[tuple[float, float]], res) -> list[int]:
    """1 where a vertex is in the reservoir, else 0."""
    wet = res.buffer(IN_RESERVOIR_DEG)
    shapely.prepare(wet)
    return [int(wet.contains(Point(p))) for p in path]


def drowned_springs(res, springs_file) -> list[list]:
    """[id, name, lon, lat, magnitude] for the FDEP springs in the reservoir."""
    near = res.buffer(DROWNED_DEG)
    shapely.prepare(near)
    rows = json.loads(springs_file.read_text(encoding="utf-8"))["springs"]
    return [[s[0], s[1], s[3], s[4], s[5]] for s in rows if near.contains(Point(s[3], s[4]))]


def canal() -> list[list[tuple[float, float]]]:
    cols, geoms = nhd.table(HU4, "NHDFlowline", ["GNIS_Name"], bbox=C.OCK_VIEW, geometry=True)
    lines = [list(p.coords) for n, g in zip(cols["gnis_name"], geoms) if n == "Cross Florida Barge Canal" for p in shapely.get_parts(g)]
    if not lines:
        raise RuntimeError("no NHD flowlines named 'Cross Florida Barge Canal'")
    return lines


def water() -> list[dict]:
    """Lakes (the reservoir among them, by name), the St. Johns, and wetlands, largest first,
    packed like the lakes files."""
    clip = box(*C.OCK_WATER)
    cols, geoms = nhd.table(HU4, "NHDWaterbody", ["GNIS_Name", "FType", "AreaSqKm"], bbox=C.OCK_WATER, geometry=True)
    bodies = []
    swamps = []
    for name, ft, a, g in zip(cols["gnis_name"], cols["ftype"], cols["areasqkm"], geoms):
        ft = int(ft)
        if ft in (390, 436) and a >= LAKE_KM2:
            g = g.intersection(clip).simplify(LAKE_TOL, preserve_topology=True)
            if rings := polygon_rings(g):
                bodies.append({"name": name or None, "kind": "lake", "km2": round(g.area * KM2_PER_DEG2, 2), "rings": rings})
        elif ft == 466:
            swamps.append(g)
    ac, ag = nhd.table(HU4, "NHDArea", ["FType", "AreaSqKm"], bbox=C.OCK_WATER, geometry=True)
    river = unary_union([g for ft, g in zip(ac["ftype"], ag) if int(ft) == FTYPE_STREAM_AREA]).intersection(clip)
    river = drop_specks(river, RIVER_KM2).simplify(LAKE_TOL, preserve_topology=True)
    bodies.append({"name": None, "kind": "lake", "km2": round(river.area * KM2_PER_DEG2, 1), "rings": polygon_rings(river)})
    marsh = drop_specks(unary_union(swamps).intersection(clip), SWAMP_KM2).simplify(SWAMP_TOL, preserve_topology=True)
    bodies.append({"name": None, "kind": "swamp", "km2": round(marsh.area * KM2_PER_DEG2, 1), "rings": polygon_rings(marsh)})
    return sorted(bodies, key=lambda b: -b["km2"])


def history(refresh: bool = False) -> dict:
    site = {g["key"]: g["id"] for g in C.gauges("ocklawaha")}
    silver = water_years(usgs.daily(site["SILV"], refresh))
    eureka = water_years(usgs.daily(site["EUR"], refresh))
    known = silver | eureka
    years = list(range(min(known), max(known) + 1))
    return {"years": years, "SILV": [silver.get(y) for y in years], "EUR": [eureka.get(y) for y in years]}


def build(refresh: bool = False) -> dict:
    g = {x["key"]: (x["lon"], x["lat"]) for x in C.gauges("ocklawaha")}
    s = {x["name"]: (x["lon"], x["lat"]) for x in C.OCK_STRUCTURES}
    res = reservoir(refresh)
    ock = nhd.level_path(HU4, C.OCK_VIEW, "Ocklawaha River", g["MB"], C.OCK_MOUTH)
    silver = nhd.level_path(HU4, C.OCK_VIEW, "Silver River", C.SILVER_HEAD, g["CON"])
    orange = nhd.level_path(HU4, C.OCK_VIEW, "Orange Creek", g["ORC"], s["Kirkpatrick Dam"])
    ock = simplified(ock)
    flags = flag_reservoir(ock, res)
    drowned = drowned_springs(res, C.OUT / "springs.json")
    hist = history(refresh)
    log(f"ocklawaha: river {len(ock)} vertices, {sum(flags)} in the reservoir; {len(drowned)} springs in it; flow for water years {hist['years'][0]}-{hist['years'][-1]}")
    return {
        "meta": {
            "generator": "waterways-pipeline ocklawaha",
            "generatedAt": date.today().isoformat(),
            "sources": [C.NHD_BULK, C.FDEP_SPRINGS, f"{C.USGS_API}/daily"],
            "coordOrigin": list(ORIGIN),
            "coordScale": SCALE,
        },
        "rivers": {
            "Ocklawaha River": {"p": pack(ock), "res": flags},
            "Silver River": {"p": pack(simplified(silver))},
            "Orange Creek": {"p": pack(simplified(orange))},
        },
        "canal": [pack(simplified(line)) for line in canal()],
        "reservoir": polygon_rings(res.simplify(LAKE_TOL, preserve_topology=True)),
        "reservoirKm2": round(res.area * KM2_PER_DEG2, 1),
        "drowned": drowned,
        "water": water(),
        "structures": C.OCK_STRUCTURES,
        "history": hist,
    }
