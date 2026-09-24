"""Main-stem rivers for the Santa Fe map, and lakes/wetlands for both maps."""

from __future__ import annotations

from collections import defaultdict
from datetime import date

from shapely.geometry import MultiPolygon, Polygon, shape

from . import config as C
from .fetch import arcgis_query, log
from .geo import ORIGIN, SCALE, LonLat, in_bbox, line_coords, pack, simplify

RIVER_SIMPLIFY_DEG = 0.00004
LAKE_SIMPLIFY_DEG = 0.0003
LAKE_MIN_KM2 = 0.2
#: Wetlands are numerous and ragged; keep the big ones, drawn coarser.
SWAMP_MIN_KM2 = 1.5
SWAMP_SIMPLIFY_DEG = 0.0006
#: Covers both maps, including the rain map's Atlantic corridor.
WATER_AREAS: list[C.Bbox] = [(-83.08, 29.54, -82.01, 30.09), C.ATLANTIC_CORRIDOR]
LAKE_FTYPES = {390: "lake", 436: "lake", 466: "swamp"}


def main_levelpaths(named: list[dict]) -> dict[str, int]:
    """For each river name, the NHDPlus level path carrying most of its named length."""
    length: dict[str, dict[int, float]] = defaultdict(lambda: defaultdict(float))
    for f in named:
        p = f["properties"]
        length[p["gnis_name"]][int(p["levelpathi"])] += float(p["lengthkm"] or 0)
    return {name: max(paths, key=paths.get) for name, paths in length.items()}


def join_path(segments: list[tuple[int, list[LonLat], bool]]) -> tuple[list[LonLat], list[int]]:
    """Chain (hydroseq, coords, underground) segments upstream to downstream.

    Hydroseq decreases downstream. A vertex is flagged underground when it
    belongs to an underground segment, including both of that segment's ends,
    so an edge is underground exactly when both its vertices are flagged.
    """
    pts: list[LonLat] = []
    u: list[int] = []
    for _, coords, under in sorted(segments, key=lambda s: -s[0]):
        coords = simplify(coords, RIVER_SIMPLIFY_DEG)
        for k, p in enumerate(coords):
            if k == 0 and pts and pts[-1] == p:
                u[-1] = u[-1] or int(under)
                continue
            pts.append(p)
            u.append(int(under))
    return pts, u


def trim(pts: list[LonLat], u: list[int], bbox: C.Bbox) -> tuple[list[LonLat], list[int]]:
    """Drop the runs of vertices before the path enters the box and after it leaves."""
    inside = [i for i, p in enumerate(pts) if in_bbox(p, bbox)]
    if not inside:
        return [], []
    a, b = inside[0], inside[-1] + 1
    return pts[a:b], u[a:b]


def build_rivers(refresh: bool = False) -> dict:
    names = ",".join(f"'{n}'" for n in C.RIVERS)
    named = arcgis_query(C.NHD_FLOWLINES, C.RIVERS_BBOX, where=f"gnis_name IN ({names})", fields="gnis_name,levelpathi,lengthkm", refresh=refresh)
    paths = main_levelpaths(named)
    ids = ",".join(str(v) for v in paths.values())
    segs = arcgis_query(C.NHD_FLOWLINES, C.RIVERS_BBOX, where=f"levelpathi IN ({ids})", fields="nhdplusid,levelpathi,hydroseq,ftype", refresh=refresh)
    by_path: dict[int, dict[int, tuple[int, list[LonLat], bool]]] = defaultdict(dict)
    for f in segs:
        p = f["properties"]
        by_path[int(p["levelpathi"])][int(p["nhdplusid"])] = (int(p["hydroseq"]), line_coords(f["geometry"]), int(p["ftype"]) == C.FTYPE_UNDERGROUND)
    rivers = {}
    for name in C.RIVERS:
        if name not in paths:
            raise RuntimeError(f"no NHDPlus flowlines named {name!r} in the rivers bbox")
        pts, u = trim(*join_path(list(by_path[paths[name]].values())), C.RIVERS_BBOX)
        rivers[name] = {"p": [[round(x, 5), round(y, 5)] for x, y in pts], "u": u}
        log(f"rivers: {name}: {len(pts)} vertices, {sum(u)} underground")
    return {
        "meta": {"generator": "waterways-pipeline rivers", "generatedAt": date.today().isoformat(), "sources": [C.NHD_FLOWLINES]},
        "rivers": rivers,
    }


def build_lakes(refresh: bool = False) -> dict:
    ftypes = ",".join(map(str, LAKE_FTYPES))
    feats = [
        f
        for area in WATER_AREAS
        for f in arcgis_query(
            C.NHD_WATERBODIES, area, where=f"areasqkm >= {LAKE_MIN_KM2} AND ftype IN ({ftypes})", fields="nhdplusid,gnis_name,ftype,areasqkm", refresh=refresh
        )
    ]
    bodies, seen = [], set()
    for f in sorted(feats, key=lambda f: -float(f["properties"]["areasqkm"])):
        p = f["properties"]
        kind = LAKE_FTYPES[int(p["ftype"])]
        if p["nhdplusid"] in seen or not f.get("geometry") or (kind == "swamp" and float(p["areasqkm"]) < SWAMP_MIN_KM2):
            continue
        seen.add(p["nhdplusid"])
        g = shape(f["geometry"]).simplify(SWAMP_SIMPLIFY_DEG if kind == "swamp" else LAKE_SIMPLIFY_DEG, preserve_topology=True)
        polys = g.geoms if isinstance(g, MultiPolygon) else [g] if isinstance(g, Polygon) else []
        rings = [pack(list(r.coords)) for poly in polys for r in [poly.exterior, *poly.interiors] if len(r.coords) >= 4]
        if rings:
            bodies.append({"name": p.get("gnis_name") or None, "kind": kind, "km2": round(float(p["areasqkm"]), 2), "rings": rings})
    log(f"lakes: {len(bodies)} waterbodies ≥ {LAKE_MIN_KM2} km²")
    return {
        "meta": {
            "generator": "waterways-pipeline lakes",
            "generatedAt": date.today().isoformat(),
            "sources": [C.NHD_WATERBODIES],
            "coordOrigin": list(ORIGIN),
            "coordScale": SCALE,
        },
        "bodies": bodies,
    }
