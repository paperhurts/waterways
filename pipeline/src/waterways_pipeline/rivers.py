"""Main-stem rivers for the Santa Fe map, and lakes/wetlands/seas for both maps."""

from __future__ import annotations

from collections import defaultdict
from datetime import date

from shapely.geometry import MultiPolygon, Polygon, shape

from . import coast
from . import config as C
from .fetch import arcgis_query, log
from .geo import ORIGIN, SCALE, LonLat, in_bbox, line_coords, pack, simplify

RIVER_SIMPLIFY_DEG = 0.00004
LAKE_SIMPLIFY_DEG = 0.0003
LAKE_MIN_KM2 = 0.2
#: Wetlands are numerous and ragged; keep the big ones, drawn coarser.
SWAMP_MIN_KM2 = 1.5
SWAMP_SIMPLIFY_DEG = 0.001
#: Big swamps are riddled with upland islands (one has 1,500 rings); under the stipple,
#: islands and scraps this small don't show.
SWAMP_SPECK_KM2 = 0.5
#: Covers both maps: the Santa Fe map's box and all of the rain map's.
WATER_AREAS: list[C.Bbox] = [(-83.08, 29.54, -82.01, 30.09), *C.STREAMS_AREAS]
LAKE_FTYPES = {390: "lake", 436: "lake", 466: "swamp"}
SEA_SIMPLIFY_DEG = 0.0003
#: Sea pieces and islands smaller than this vanish at map scale.
SEA_SPECK_KM2 = 0.5
#: km² per square degree near the map's middle latitude (29.8°).
KM2_PER_DEG2 = 111.32 * 110.57 * 0.868


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


def main_stems(names: list[str], bbox: C.Bbox, refresh: bool = False) -> dict[str, dict]:
    """Each named river's main stem, upstream to downstream and trimmed to the box, as
    {"p": [[lon, lat], ...], "u": [0|1 underground per vertex]}."""
    quoted = ",".join(f"'{n}'" for n in names)
    named = arcgis_query(C.NHD_FLOWLINES, bbox, where=f"gnis_name IN ({quoted})", fields="gnis_name,levelpathi,lengthkm", refresh=refresh)
    paths = main_levelpaths(named)
    ids = ",".join(str(v) for v in paths.values())
    segs = arcgis_query(C.NHD_FLOWLINES, bbox, where=f"levelpathi IN ({ids})", fields="nhdplusid,levelpathi,hydroseq,ftype", refresh=refresh)
    by_path: dict[int, dict[int, tuple[int, list[LonLat], bool]]] = defaultdict(dict)
    for f in segs:
        p = f["properties"]
        by_path[int(p["levelpathi"])][int(p["nhdplusid"])] = (int(p["hydroseq"]), line_coords(f["geometry"]), int(p["ftype"]) == C.FTYPE_UNDERGROUND)
    rivers = {}
    for name in names:
        if name not in paths:
            raise RuntimeError(f"no NHDPlus flowlines named {name!r} in {bbox}")
        pts, u = trim(*join_path(list(by_path[paths[name]].values())), bbox)
        rivers[name] = {"p": [[round(x, 5), round(y, 5)] for x, y in pts], "u": u}
        log(f"rivers: {name}: {len(pts)} vertices, {sum(u)} underground")
    return rivers


def build_rivers(refresh: bool = False) -> dict:
    return {
        "meta": {"generator": "waterways-pipeline rivers", "generatedAt": date.today().isoformat(), "sources": [C.NHD_FLOWLINES]},
        "rivers": main_stems(C.RIVERS, C.RIVERS_BBOX, refresh),
    }


def polygon_rings(g) -> list[list[int]]:
    """Packed outer and hole rings of a (Multi)Polygon; anything else has none. A ring
    that packing's ~11 m grid collapses below a triangle (4 points, closed) is dropped."""
    polys = g.geoms if isinstance(g, MultiPolygon) else [g] if isinstance(g, Polygon) else []
    rings = (pack(list(r.coords)) for poly in polys for r in [poly.exterior, *poly.interiors])
    return [r for r in rings if len(r) >= 8]


def drop_specks(g, min_km2: float):
    """The polygon parts, and the holes in them, that are at least `min_km2`."""

    def big(ring) -> bool:
        return Polygon(ring).area * KM2_PER_DEG2 >= min_km2

    polys = g.geoms if isinstance(g, MultiPolygon) else [g] if isinstance(g, Polygon) else []
    kept = [Polygon(p.exterior, [h for h in p.interiors if big(h)]) for p in polys if big(p.exterior)]
    return MultiPolygon(kept) if kept else Polygon()


def seas(refresh: bool = False) -> list[dict]:
    """The Gulf and the Atlantic around the map, as one simplified shape."""
    sea = drop_specks(coast.sea(refresh), SEA_SPECK_KM2).simplify(SEA_SIMPLIFY_DEG, preserve_topology=True)
    rings = polygon_rings(sea)
    return [{"name": None, "kind": "sea", "km2": round(sea.area * KM2_PER_DEG2), "rings": rings}] if rings else []


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
        g = shape(f["geometry"])
        if kind == "swamp":
            g = drop_specks(g, SWAMP_SPECK_KM2)
        g = g.simplify(SWAMP_SIMPLIFY_DEG if kind == "swamp" else LAKE_SIMPLIFY_DEG, preserve_topology=True)
        if rings := polygon_rings(g):
            bodies.append({"name": p.get("gnis_name") or None, "kind": kind, "km2": round(float(p["areasqkm"]), 2), "rings": rings})
    log(f"lakes: {len(bodies)} waterbodies ≥ {LAKE_MIN_KM2} km²")
    sea = seas(refresh)
    log(f"lakes: sea in {sum(len(s['rings']) for s in sea)} rings")
    return {
        "meta": {
            "generator": "waterways-pipeline lakes",
            "generatedAt": date.today().isoformat(),
            "sources": [C.NHD_WATERBODIES, C.CENSUS_STATES],
            "coordOrigin": list(ORIGIN),
            "coordScale": SCALE,
        },
        "bodies": sea + bodies,
    }
