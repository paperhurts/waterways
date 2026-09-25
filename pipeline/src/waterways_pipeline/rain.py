"""The statewide rain map: every mapped creek in Florida, from NHDPlus HR.

Method:
- Read every network flowline in the eight 4-digit HUCs that drain Florida
  (C.FLORIDA_HU4S) from USGS's bulk files, and keep the ones that touch Florida: the
  Census outline widened by BORDER_DEG, so rivers on the state line (the St. Marys, the
  Perdido, the Chattahoochee at Lake Seminole) stay whole. NHD's coastline flowlines
  are part of its network but aren't creeks; they only mark where coastal rivers
  empty into the sea.
- Water follows NHDPlus routing (hydroseq → dnhydroseq) through the whole network,
  including the parts outside Florida. Hydroseqs are unique statewide (each HUC has
  its own prefix), so the HUCs join into one network, and the few links between them
  hold. A creek's fate is where that walk ends:
  - the sea, when the last flowline drains into NHD's coastline, or, for a creek NHD
    leaves unlinked, ends within coast.COAST_DEG of the sea. coast.sea_side says which;
  - a sink, when the network ends within SINK_RADIUS_M of a mapped sink point (FGS
    swallet, NHD sink/rise, or config/sinks.json). A mapped sink beats the coast;
  - "off" when the walk leaves the loaded HUCs (into Georgia's), and "inland" otherwise.
- `acc` is NHD's arbolate sum: the length of every creek upstream, including this one
  and the stretches outside Florida. It sets line width and each creek's level of detail.
- Levels of detail: creeks with at least LEVELS[0] km upstream are the base, loaded
  with the page; smaller ones are cut into tiles by their middle vertex, loaded as the
  map zooms in. Segment ids run through the base and then every tile, so `next` can
  point into another tile.
- Where NHD routes a creek into an underground conduit (FType 420), the water keeps
  its downstream fate and the named swallet is listed in `swallets`.
- NHD draws "artificial paths" through lakes and down wide rivers alike. Only those in
  a lake (by the flowline's waterbody link) are flagged `lake`, to be drawn faint.
- `lakeo`: the water passes through Lake Okeechobee, which NHD routes out the St. Lucie
  Canal, though the lake's releases also go west and south by canal.
"""

from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass
from datetime import date

import numpy as np
import shapely
from shapely.geometry import Point, box, shape
from shapely.ops import unary_union
from shapely.prepared import prep
from shapely.validation import make_valid

from . import coast
from . import config as C
from . import nhd
from . import springs as springs_mod
from .fetch import arcgis_query, log
from .geo import ORIGIN, SCALE, LonLat, meters
from .rivers import KM2_PER_DEG2, drop_specks

GULF, ATLANTIC, SINK, INLAND, OFF = range(5)
FATES = ["gulf", "atl", "sink", "inland", "off"]
#: Flag bits on each segment.
UNDERGROUND, LAKE, MOUTH, LAKEO = 1, 2, 4, 8

#: Keep flowlines this close to Florida (degrees, about 2 km), for rivers on the state line.
BORDER_DEG = 0.02
#: Sink survey points are GPS'd at the swallet, which can sit a few hundred meters from
#: where NHD ends the creek. 600 m catches Chronicity Sink and Devil's Millhopper.
SINK_RADIUS_M = 600
SPRING_DEDUPE_M = 150
SIMPLIFY_DEG = 0.00015
#: (minimum km upstream, tile size in degrees): the base, then two levels of tiles.
LEVELS: list[tuple[float, float]] = [(8.0, 0.0), (2.0, 1.0), (0.0, 0.5)]
#: Rivers with this much upstream (km) get a name on the map, if this much of the named
#: river (km) is in Florida: a delta's side channels carry the whole river's upstream
#: length, but they're short.
LABEL_KM, LABEL_LENGTH_KM = 150, 20
#: Lakes and wetlands: the smallest kept, and the smallest that go in the base.
LAKE_MIN_KM2, SWAMP_MIN_KM2 = 0.2, 1.5
BASE_LAKE_KM2, BASE_SWAMP_KM2 = 4.0, 25.0
LAKE_SIMPLIFY_DEG, SWAMP_SIMPLIFY_DEG, SEA_SIMPLIFY_DEG = 0.0003, 0.001, 0.0005
SWAMP_SPECK_KM2, SEA_SPECK_KM2 = 0.5, 1.0
LAKE_FTYPES = {390: "lake", 436: "lake", 466: "swamp"}


@dataclass
class Line:
    nid: int
    hydroseq: int
    acc: float
    km: float
    name: str | None
    ftype: int
    wbarea: str | None
    levelpath: int
    coords: list[LonLat]


# ---------------------------------------------------------------- the network


def network() -> tuple[dict[int, int], dict[int, int], dict[int, float], set[int], dict[int, int]]:
    """Every network flowline in the HUCs: hydroseq → dnhydroseq, hydroseq → nhdplusid,
    nhdplusid → arbolate sum, the coastline's hydroseqs, and nhdplusid → levelpath."""
    dn: dict[int, int] = {}
    nid_of: dict[int, int] = {}
    acc: dict[int, float] = {}
    level: dict[int, int] = {}
    shore: set[int] = set()
    for hu4 in C.FLORIDA_HU4S:
        vaa, _ = nhd.table(hu4, "NHDPlusFlowlineVAA", ["NHDPlusID", "HydroSeq", "DnHydroSeq", "LevelPathI", "ArbolateSu"])
        ftype, _ = nhd.table(hu4, "NHDFlowline", ["NHDPlusID", "FType"])
        coastline = {int(i) for i, t in zip(ftype["nhdplusid"], ftype["ftype"]) if t == C.FTYPE_COASTLINE}
        for i, s, d, lp, a in zip(vaa["nhdplusid"], vaa["hydroseq"], vaa["dnhydroseq"], vaa["levelpathi"], vaa["arbolatesu"]):
            if s != s:
                continue
            i, s = int(i), int(s)
            if i in coastline:
                shore.add(s)
                continue
            dn[s] = nhd.whole(d) or 0
            nid_of[s] = i
            acc[i] = float(a) if a == a else 0.0
            level[i] = nhd.whole(lp) or 0
        log(f"rain: {hu4}: {len(vaa['nhdplusid'])} network flowlines")
    return dn, nid_of, acc, shore, level


def florida(refresh: bool):
    """Florida's shoreline-clipped outline, and the land of every state near it."""
    states = arcgis_query(C.CENSUS_STATES, C.RAIN_SEA_CLIP, fields="STUSAB", refresh=refresh)
    shapes = [(f["properties"]["STUSAB"], make_valid(shape(f["geometry"]))) for f in states if f.get("geometry")]
    fl = unary_union([g for s, g in shapes if s == "FL"])
    return fl, unary_union([g for _, g in shapes])


def flowlines(keep_near, acc: dict[int, float], level: dict[int, int], seq_of: dict[int, int]) -> list[Line]:
    """Florida's network flowlines, with geometry."""
    out: list[Line] = []
    for hu4 in C.FLORIDA_HU4S:
        cols, geoms = nhd.table(
            hu4, "NHDFlowline", ["NHDPlusID", "GNIS_Name", "FType", "LengthKM", "WBArea_Permanent_Identifier"], bbox=C.FLORIDA_BBOX, geometry=True
        )
        ok = np.array([g is not None for g in geoms])
        near = np.zeros(len(geoms), dtype=bool)
        near[ok] = shapely.intersects(geoms[ok], keep_near)
        for n in np.flatnonzero(near):
            nid = int(cols["nhdplusid"][n])
            if nid not in seq_of or cols["ftype"][n] == C.FTYPE_COASTLINE:
                continue
            out.append(
                Line(
                    nid=nid,
                    hydroseq=seq_of[nid],
                    acc=acc[nid],
                    km=float(cols["lengthkm"][n] or 0),
                    name=cols["gnis_name"][n] or None,
                    ftype=int(cols["ftype"][n]),
                    wbarea=cols["wbarea_permanent_identifier"][n] or None,
                    levelpath=level[nid],
                    coords=joined(geoms[n]),
                )
            )
    return out


def joined(g) -> list[LonLat]:
    """A (multi)line's coordinates, parts joined end to end."""
    parts = g.geoms if hasattr(g, "geoms") else [g]
    out: list[LonLat] = []
    for part in parts:
        for x, y in part.coords:
            if not out or (x, y) != out[-1]:
                out.append((x, y))
    return out


def ends(start: list[int], dn: dict[int, int]) -> dict[int, int]:
    """For each starting hydroseq, the last flowline its water reaches (a hydroseq)."""
    end: dict[int, int] = {}
    for s in start:
        path = []
        i = s
        while i not in end:
            if len(path) > len(dn):
                raise ValueError(f"flow network has a cycle through hydroseq {i}")
            path.append(i)
            d = dn.get(i, 0)
            if d == 0 or d not in dn:
                end[i] = i
                break
            i = d
        e = end[i]
        for p in path:
            end[p] = e
    return {s: end[s] for s in start}


# ---------------------------------------------------------------- fates


@dataclass
class SinkPoint:
    lon: float
    lat: float
    name: str | None


class Sinks:
    def __init__(self, pts: list[SinkPoint]) -> None:
        self.pts = pts
        self.tree = shapely.STRtree([Point(p.lon, p.lat) for p in pts])

    def near(self, p: LonLat) -> tuple[bool, str | None]:
        """Whether a mapped sink is within SINK_RADIUS_M, and the nearest named one's name."""
        idx = self.tree.query(Point(p), predicate="dwithin", distance=SINK_RADIUS_M / 90_000)
        hits = sorted((meters(p, (self.pts[i].lon, self.pts[i].lat)), i) for i in idx)
        hits = [(d, i) for d, i in hits if d <= SINK_RADIUS_M]
        if not hits:
            return False, None
        named = [self.pts[i].name for _, i in hits if self.pts[i].name]
        return True, named[0] if named else None


def sink_points(refresh: bool) -> Sinks:
    pts = [SinkPoint(s["lon"], s["lat"], s["name"]) for s in C.named_sinks()]
    counts = [len(pts)]
    for f in arcgis_query(C.FGS_SWALLETS, C.FLORIDA_BBOX, fields="NAME", refresh=refresh):
        if f.get("geometry"):
            lon, lat = f["geometry"]["coordinates"][:2]
            pts.append(SinkPoint(lon, lat, (f["properties"].get("NAME") or "").strip() or None))
    counts.append(len(pts) - sum(counts))
    for hu4 in C.FLORIDA_HU4S:
        cols, geoms = nhd.table(hu4, "NHDPoint", ["GNIS_Name", "FType"], where=f"FType = {C.FTYPE_SINK_RISE}", bbox=C.FLORIDA_BBOX, geometry=True)
        for name, g in zip(cols["gnis_name"], geoms):
            if g is not None:
                pts.append(SinkPoint(g.x, g.y, name or None))
    counts.append(len(pts) - sum(counts))
    log(f"rain: {len(pts)} sink points ({counts[0]} named in config, {counts[1]} FGS swallets, {counts[2]} NHD sinks)")
    return Sinks(pts)


def end_points(lines: list[Line], end_seqs: set[int], nid_of: dict[int, int]) -> dict[int, LonLat]:
    """Where each end flowline ends, reading the few outside Florida from the files."""
    have = {f.hydroseq: f.coords[-1] for f in lines if f.hydroseq in end_seqs}
    missing = {nid_of[s]: s for s in end_seqs - set(have)}
    for hu4 in C.FLORIDA_HU4S:
        ids = sorted(missing)
        for k in range(0, len(ids), 200):
            chunk = ",".join(map(str, ids[k : k + 200]))
            cols, geoms = nhd.table(hu4, "NHDFlowline", ["NHDPlusID"], where=f"NHDPlusID IN ({chunk})", geometry=True)
            for i, g in zip(cols["nhdplusid"], geoms):
                if g is not None:
                    have[missing.pop(int(i))] = joined(g)[-1]
    return have


def classify(end_of: dict[int, int], dn: dict[int, int], shore: set[int], where: dict[int, LonLat], sinks: Sinks, sea: coast.Coast):
    """Fate and sink name for each end flowline."""
    out: dict[int, tuple[int, str | None]] = {}
    sides = {"gulf": GULF, "atl": ATLANTIC}
    for e in set(end_of.values()):
        d = dn.get(e, 0)
        p = where.get(e)
        if d in shore:
            out[e] = (sides[coast.sea_side(p)] if p else GULF, None)
        elif d != 0:
            out[e] = (OFF, None)
        elif p is None:
            out[e] = (INLAND, None)
        else:
            sunk, name = sinks.near(p)
            side = None if sunk else sea.sea_at(p)
            out[e] = (sides[side], None) if side else ((SINK, name) if sunk else (INLAND, None))
    return out


def through(lines: list[Line], dn: dict[int, int], marked: set[int]) -> set[int]:
    """Hydroseqs of the lines whose water passes through a marked flowline."""
    memo: dict[int, bool] = {s: True for s in marked}
    for f in lines:
        path = []
        i = f.hydroseq
        while i not in memo:
            path.append(i)
            d = dn.get(i, 0)
            if d == 0 or d not in dn:
                memo[i] = False
                break
            i = d
        v = memo[i]
        for p in path:
            memo[p] = v
    return {f.hydroseq for f in lines if memo[f.hydroseq]}


# ---------------------------------------------------------------- water


def lake_ids() -> tuple[set[str], set[str]]:
    """Permanent ids of the lakes and reservoirs (for artificial paths through them), and
    of Lake Okeechobee."""
    lakes: set[str] = set()
    okee: set[str] = set()
    for hu4 in C.FLORIDA_HU4S:
        cols, _ = nhd.table(hu4, "NHDWaterbody", ["Permanent_Identifier", "GNIS_Name", "FType"], where="FType IN (390, 436)")
        for pid, name in zip(cols["permanent_identifier"], cols["gnis_name"]):
            lakes.add(pid)
            if name == "Lake Okeechobee":
                okee.add(pid)
    return lakes, okee


def salt_water(land, refresh: bool):
    """The sea: everything in the clip that isn't land, with NHD's bays and lagoons (the
    Census outlines count the Indian River Lagoon as land) and the wide tidal rivers that
    open onto them."""
    water = box(*C.RAIN_SEA_CLIP).difference(land)
    bays, rivers = [], []
    for hu4 in C.FLORIDA_HU4S:
        for ftype, into in ((C.FTYPE_BAY_INLET, bays), (C.FTYPE_STREAM_AREA, rivers)):
            _, geoms = nhd.table(hu4, "NHDArea", ["FType"], where=f"FType = {ftype}", bbox=C.FLORIDA_BBOX, geometry=True)
            into += [make_valid(g) for g in geoms if g is not None]
    salt = unary_union([water, *bays])
    near = prep(salt.buffer(coast.TIDAL_DEG))
    return unary_union([salt, *(g for g in rivers if near.intersects(g))])


def waterbodies(keep_near) -> list[dict]:
    """Florida's lakes and big wetlands, largest first, simplified."""
    out = []
    for hu4 in C.FLORIDA_HU4S:
        cols, geoms = nhd.table(
            hu4, "NHDWaterbody", ["GNIS_Name", "FType", "AreaSqKm"], where="FType IN (390, 436, 466) AND AreaSqKm >= 0.2", bbox=C.FLORIDA_BBOX, geometry=True
        )
        for name, ftype, km2, g in zip(cols["gnis_name"], cols["ftype"], cols["areasqkm"], geoms):
            kind = LAKE_FTYPES[int(ftype)]
            if g is None or km2 < (SWAMP_MIN_KM2 if kind == "swamp" else LAKE_MIN_KM2) or not keep_near.intersects(g):
                continue
            g = make_valid(g)
            if kind == "swamp":
                g = drop_specks(g, SWAMP_SPECK_KM2)
            g = g.simplify(SWAMP_SIMPLIFY_DEG if kind == "swamp" else LAKE_SIMPLIFY_DEG, preserve_topology=True)
            if rings := polygon_rings(g):
                c = g.envelope.centroid
                out.append({"name": name or None, "kind": kind, "km2": round(float(km2), 2), "rings": rings, "at": (c.x, c.y)})
    out.sort(key=lambda b: -b["km2"])
    return out


# ---------------------------------------------------------------- packing


def quantize(coords: list[LonLat]) -> list[tuple[int, int]]:
    q: list[tuple[int, int]] = []
    for lon, lat in coords:
        p = (round((lon - ORIGIN[0]) * SCALE), round((lat - ORIGIN[1]) * SCALE))
        if not q or q[-1] != p:
            q.append(p)
    return q


def delta(q: list[tuple[int, int]]) -> list[int]:
    """[x0, y0, dx1, dy1, ...]: the first point, then each step from the last."""
    flat = [q[0][0], q[0][1]]
    for (x0, y0), (x1, y1) in zip(q, q[1:]):
        flat += [x1 - x0, y1 - y0]
    return flat


def pack_line(coords: list[LonLat]) -> list[int]:
    """Quantize to ~11 m, drop repeats but keep at least two points, and delta-encode."""
    q = quantize(coords)
    if len(q) == 1:
        q = q * 2
    return delta(q)


def polygon_rings(g) -> list[list[int]]:
    """Delta-packed outer and hole rings of a (Multi)Polygon. Rings the ~11 m grid
    collapses below a triangle are dropped."""
    polys = getattr(g, "geoms", [g])
    out = []
    for poly in polys:
        if poly.geom_type != "Polygon" or poly.is_empty:
            continue
        for r in [poly.exterior, *poly.interiors]:
            q = quantize(list(r.coords))
            if len(q) >= 4:
                out.append(delta(q))
    return out


def tile_of(p: LonLat, size: float) -> tuple[int, int]:
    return math.floor((p[0] - C.FLORIDA_BBOX[0]) / size), math.floor((p[1] - C.FLORIDA_BBOX[1]) / size)


# ---------------------------------------------------------------- build


def springs_list(refresh: bool) -> list[list]:
    """[lon, lat, name, magnitude, id] for every FDEP spring (ids match springs.json), plus
    NHD spring points FDEP lacks (no id)."""
    fdep = springs_mod.fetch(refresh)
    out: list[list] = [[round(s.lon, 4), round(s.lat, 4), s.name, s.mag, s.id] for s in fdep]
    tree = shapely.STRtree([Point(s.lon, s.lat) for s in fdep])
    for hu4 in C.FLORIDA_HU4S:
        cols, geoms = nhd.table(hu4, "NHDPoint", ["GNIS_Name", "FType"], where=f"FType = {C.FTYPE_SPRING}", bbox=C.FLORIDA_BBOX, geometry=True)
        for name, g in zip(cols["gnis_name"], geoms):
            if g is None:
                continue
            near = tree.query(g, predicate="dwithin", distance=SPRING_DEDUPE_M / 90_000)
            if all(meters((g.x, g.y), (fdep[i].lon, fdep[i].lat)) > SPRING_DEDUPE_M for i in near):
                out.append([round(g.x, 4), round(g.y, 4), name or "Spring", 0, ""])
    return out


def river_labels(lines: list[Line], fates: list[int]) -> list[list]:
    """[lon, lat, name, fate, km] for each big named river, at the middle of its main
    stem in Florida (one label per level path, since names repeat: two Withlacoochees),
    longest first. Ranking by length, not upstream length, puts the rivers people know
    ahead of the canals and side channels that carry a big river's water."""
    groups: dict[tuple[str, int], list[int]] = defaultdict(list)
    for i, f in enumerate(lines):
        if f.name and f.ftype != C.FTYPE_UNDERGROUND:
            groups[(f.name, f.levelpath)].append(i)
    out = []
    for (name, _), idx in groups.items():
        top = max(lines[i].acc for i in idx)
        length = sum(lines[i].km for i in idx)
        if top < LABEL_KM or length < LABEL_LENGTH_KM:
            continue
        # Upstream to downstream (hydroseq falls going down), then the flowline at half the length.
        idx.sort(key=lambda i: -lines[i].hydroseq)
        half = length / 2
        run = 0.0
        for i in idx:
            run += lines[i].km
            if run >= half:
                c = lines[i].coords[len(lines[i].coords) // 2]
                out.append([round(c[0], 4), round(c[1], 4), name, fates[i], round(length)])
                break
    return sorted(out, key=lambda r: -r[4])


def build(refresh: bool = False) -> tuple[dict, dict[str, dict]]:
    """base.json, and the tiles by path ("1/12-5.json")."""
    fl, land = florida(refresh)
    keep_near = fl.buffer(BORDER_DEG)
    shapely.prepare(keep_near)
    dn, nid_of, acc, shore, level = network()
    seq_of = {n: s for s, n in nid_of.items()}
    lines = flowlines(keep_near, acc, level, seq_of)
    log(f"rain: {len(lines)} flowlines in Florida, {sum(f.km for f in lines):.0f} km")

    end_of = ends([f.hydroseq for f in lines], dn)
    where = end_points(lines, set(end_of.values()), nid_of)
    sinks = sink_points(refresh)
    sea = salt_water(land, refresh)
    fate_at = classify(end_of, dn, shore, where, sinks, coast.Coast(sea))
    fates = [fate_at[end_of[f.hydroseq]][0] for f in lines]
    sink_names = [fate_at[end_of[f.hydroseq]][1] for f in lines]

    lakes, okee = lake_ids()
    in_okee = {f.hydroseq for f in lines if f.wbarea in okee}
    via_okee = through(lines, dn, in_okee)

    # Ids: the base first, then each level's tiles in order.
    level_of = [next(k for k, (km, _) in enumerate(LEVELS) if f.acc >= km) for f in lines]
    tiles: dict[tuple[int, int, int], list[int]] = defaultdict(list)
    for i, f in enumerate(lines):
        k = level_of[i]
        at = tile_of(f.coords[len(f.coords) // 2], LEVELS[k][1]) if k else (0, 0)
        tiles[(k, *at)].append(i)
    order = sorted(tiles)
    gid: dict[int, int] = {}
    first: dict[tuple[int, int, int], int] = {}
    for key in order:
        first[key] = len(gid)
        for i in tiles[key]:
            gid[i] = len(gid)
    by_seq = {f.hydroseq: i for i, f in enumerate(lines)}

    def seg(i: int, names: list[str], index: dict[str, int]) -> list:
        f = lines[i]

        def name_id(n: str | None) -> int:
            if not n:
                return -1
            if n not in index:
                index[n] = len(names)
                names.append(n)
            return index[n]

        j = by_seq.get(dn.get(f.hydroseq, 0))
        flags = (UNDERGROUND if f.ftype == C.FTYPE_UNDERGROUND else 0) | (LAKE if f.ftype == C.FTYPE_ARTIFICIAL and f.wbarea in lakes else 0)
        if end_of[f.hydroseq] == f.hydroseq and fates[i] in (GULF, ATLANTIC):
            flags |= MOUTH
        if f.hydroseq in via_okee:
            flags |= LAKEO
        simple = list(shapely.LineString(f.coords).simplify(SIMPLIFY_DEG, preserve_topology=False).coords) if len(f.coords) > 2 else f.coords
        return [pack_line(simple), fates[i], gid[j] if j is not None else -1, round(f.acc, 1), name_id(f.name), name_id(sink_names[i]), flags]

    # Water: the sea and the big lakes and wetlands in the base, the rest in level-1 tiles.
    bodies = waterbodies(keep_near)
    sea_shape = drop_specks(sea, SEA_SPECK_KM2).simplify(SEA_SIMPLIFY_DEG, preserve_topology=True)
    base_water = [{"name": None, "kind": "sea", "km2": round(sea_shape.area * KM2_PER_DEG2), "rings": polygon_rings(sea_shape)}]
    tile_water: dict[tuple[int, int], list[dict]] = defaultdict(list)
    for b in bodies:
        at = b.pop("at")
        if b["km2"] >= (BASE_SWAMP_KM2 if b["kind"] == "swamp" else BASE_LAKE_KM2):
            base_water.append(b)
        else:
            tile_water[tile_of(at, LEVELS[1][1])].append(b)
    for key in tile_water:
        if (1, *key) not in first:
            first[(1, *key)] = len(gid)
            order.append((1, *key))
    order.sort()

    base_names: list[str] = []
    base_index: dict[str, int] = {}
    base_segs = [seg(i, base_names, base_index) for i in tiles[(0, 0, 0)]]
    out_tiles: dict[str, dict] = {}
    meta_levels = [{"minAcc": LEVELS[0][0], "tileDeg": 0, "tiles": []}] + [{"minAcc": km, "tileDeg": deg, "tiles": []} for km, deg in LEVELS[1:]]
    for key in order:
        k, col, row = key
        if k == 0:
            continue
        names: list[str] = []
        index: dict[str, int] = {}
        segs = [seg(i, names, index) for i in tiles.get(key, [])]
        water = tile_water.get((col, row), []) if k == 1 else []
        out_tiles[f"{k}/{col}-{row}.json"] = {"first": first[key], "names": names, "segs": segs, "water": water}
        meta_levels[k]["tiles"].append([col, row, first[key], len(segs)])

    shares = [0.0] * 5
    for i, f in enumerate(lines):
        if f.ftype != C.FTYPE_ARTIFICIAL:
            shares[fates[i]] += f.km
    total = sum(shares)
    log("rain: fates " + ", ".join(f"{FATES[k]} {100 * v / total:.1f}%" for k, v in enumerate(shares)))

    sink_labels: dict[str, list] = {}
    for i, f in enumerate(lines):
        n = sink_names[i]
        if fates[i] == SINK and n and end_of[f.hydroseq] == f.hydroseq:
            lon, lat = f.coords[-1]
            if n not in sink_labels or f.acc > sink_labels[n][3]:
                sink_labels[n] = [round(lon, 4), round(lat, 4), n, round(f.acc, 1)]

    swallets: dict[str, list] = {}
    for i, f in enumerate(lines):
        j = by_seq.get(dn.get(f.hydroseq, 0))
        if j is None or f.ftype == C.FTYPE_UNDERGROUND or lines[j].ftype != C.FTYPE_UNDERGROUND:
            continue
        sunk, name = sinks.near(f.coords[-1])
        if sunk and name and name not in swallets:
            lon, lat = f.coords[-1]
            swallets[name] = [round(lon, 4), round(lat, 4), name]

    base = {
        "meta": {
            "generator": "waterways-pipeline rain",
            "generatedAt": date.today().isoformat(),
            "sources": [C.NHD_BULK.format(hu4="{" + ",".join(C.FLORIDA_HU4S) + "}"), C.FGS_SWALLETS, C.FDEP_SPRINGS, C.CENSUS_STATES, "config/sinks.json"],
            "coordOrigin": list(ORIGIN),
            "coordScale": SCALE,
            "gridOrigin": list(C.FLORIDA_BBOX[:2]),
            "bounds": list(C.FLORIDA_BBOX),
            "segFields": ["coords", "fate", "next", "acc", "name", "sink", "flags"],
            "fates": FATES,
            "shares": [round(100 * v / total, 2) for v in shares],
            "segCount": len(gid),
            "levels": meta_levels,
        },
        "names": base_names,
        "segs": base_segs,
        "water": base_water,
        "springs": springs_list(refresh),
        "swallets": list(swallets.values()),
        "sinks": sorted(sink_labels.values(), key=lambda s: -s[3]),
        "rivers": river_labels(lines, fates),
    }
    log(f"rain: {len(base_segs)} base segments, {len(out_tiles)} tiles, {len(bodies)} lakes and wetlands")
    return base, out_tiles
