"""Data for the Apalachicola River map (apalachicola.json).

- Rivers: NHDPlus HR main paths of the Chattahoochee (from Buford Dam, below Lake
  Lanier), the Flint, the Apalachicola (from Jim Woodruff Lock and Dam, where the two
  meet at Lake Seminole, to Apalachicola Bay), and the Chipola, which joins it. Each
  vertex is flagged where it's in a reservoir or lake of at least POOL_KM2.
- Context: the basin's other big streams (NHD arbolate sum of at least CONTEXT_KM), since
  the rain map's creeks stop at Florida's line.
- Water: the sea and the bay (the rain map's salt water), the Corps' reservoirs and other
  lakes, and wetlands, packed like the lakes files.
- Oysters: FWC's statewide oyster beds in and around the bay, geometry only.
- Borders: the Florida, Georgia, and Alabama lines, from the Census outlines.
- History: water-year mean flow of the Apalachicola at Chattahoochee, just below the
  dam, from USGS daily records.
"""

from __future__ import annotations

from datetime import date

import shapely
from shapely.geometry import box, shape
from shapely.ops import unary_union
from shapely.validation import make_valid

from . import config as C
from . import nhd, rain, usgs
from .fetch import arcgis_query, log
from .geo import ORIGIN, SCALE, pack
from .rainbow import water_years
from .rivers import KM2_PER_DEG2, drop_specks, polygon_rings

HU4 = "0313"
SIMPLIFY_DEG = 0.0003
#: Other streams drawn for the basin's shape: at least this much stream upstream (km).
CONTEXT_KM = 200.0
CONTEXT_TOL = 0.003
LAKE_KM2, SWAMP_KM2 = 2.0, 10.0
LAKE_TOL, SWAMP_TOL, SEA_TOL, FAR_SEA_TOL = 0.002, 0.006, 0.0015, 0.025
#: The coast drawn in detail: the bay and its barrier islands.
BAY_BOX: C.Bbox = (-85.6, 29.45, -84.3, 30.1)
OYSTER_BOX: C.Bbox = (-85.3, 29.55, -84.55, 29.95)
OYSTER_TOL = 0.0004
#: A river is pooled behind a dam where it's in a lake at least this big (km²).
POOL_KM2 = 5.0


def simplified(path: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """Simplified, then snapped to the packing grid with repeats dropped, so per-vertex
    flags line up with the packed points."""
    out: list[tuple[float, float]] = []
    for x, y in shapely.LineString(path).simplify(SIMPLIFY_DEG).coords:
        q = (ORIGIN[0] + round((x - ORIGIN[0]) * SCALE) / SCALE, ORIGIN[1] + round((y - ORIGIN[1]) * SCALE) / SCALE)
        if not out or q != out[-1]:
            out.append(q)
    return out


def main_stems() -> dict[str, list[tuple[float, float]]]:
    """Each river's path, upstream to downstream."""
    g = {x["key"]: (x["lon"], x["lat"]) for x in C.gauges("apalachicola")}
    dam = {s["name"]: (s["lon"], s["lat"]) for s in C.AP_STRUCTURES}
    woodruff = dam["Jim Woodruff Dam"]
    return {
        "Chattahoochee River": nhd.level_path(HU4, C.AP_VIEW, "Chattahoochee River", g["BUF"], woodruff),
        "Flint River": nhd.level_path(HU4, C.AP_VIEW, "Flint River", C.FLINT_HEAD, woodruff),
        "Apalachicola River": nhd.level_path(HU4, C.AP_VIEW, "Apalachicola River", woodruff, C.AP_MOUTH),
        "Chipola River": nhd.level_path(HU4, C.AP_VIEW, "Chipola River", g["ALT"], C.CHIPOLA_MOUTH),
    }


def context(mains: list[list[tuple[float, float]]]) -> list[list[int]]:
    """The basin's other big streams, simplified and packed."""
    vaa, _ = nhd.table(HU4, "NHDPlusFlowlineVAA", ["NHDPlusID", "ArbolateSu"])
    big = {int(i) for i, a in zip(vaa["nhdplusid"], vaa["arbolatesu"]) if a == a and a >= CONTEXT_KM}
    cols, geoms = nhd.table(HU4, "NHDFlowline", ["NHDPlusID"], bbox=C.AP_VIEW, geometry=True)
    on_main = unary_union([shapely.LineString(m) for m in mains]).buffer(0.003)
    shapely.prepare(on_main)
    lines = [g for i, g in zip(cols["nhdplusid"], geoms) if int(i) in big and g is not None]
    merged = shapely.line_merge(unary_union(lines))
    out = []
    for part in shapely.get_parts(merged):
        if on_main.contains(part.interpolate(0.5, normalized=True)):
            continue
        coords = list(part.simplify(CONTEXT_TOL).coords)
        if len(coords) >= 2:
            out.append(pack(coords))
    return out


def water(refresh: bool = False) -> list[dict]:
    """The sea (with the bay), then lakes and wetlands, largest first."""
    clip = box(*C.AP_WATER)
    states = arcgis_query(C.CENSUS_STATES, C.AP_SEA, fields="STUSAB", refresh=refresh)
    land = unary_union([make_valid(shape(f["geometry"])) for f in states if f.get("geometry")])
    salt = rain.salt_water(land, refresh).intersection(box(*C.AP_SEA))
    # Apalachicola Bay's coast in detail; the rest only needs to fill the screen's edges.
    bay = box(*BAY_BOX)
    near = drop_specks(salt.intersection(bay), 0.5).simplify(SEA_TOL, preserve_topology=True)
    far = drop_specks(salt.difference(bay), 20.0).simplify(FAR_SEA_TOL, preserve_topology=True)
    bodies = [{"name": None, "kind": "sea", "km2": round(g.area * KM2_PER_DEG2), "rings": polygon_rings(g)} for g in (near, far)]
    cols, geoms = nhd.table(HU4, "NHDWaterbody", ["GNIS_Name", "FType", "AreaSqKm"], bbox=C.AP_WATER, geometry=True)
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


def borders(refresh: bool = False) -> list[list[int]]:
    """Where Florida, Georgia, and Alabama meet each other (not the coast), packed."""
    states = arcgis_query(C.CENSUS_STATES, C.AP_WATER, fields="STUSAB", refresh=refresh)
    by = {f["properties"]["STUSAB"]: make_valid(shape(f["geometry"])) for f in states if f.get("geometry")}
    out = []
    for a, b in (("FL", "GA"), ("FL", "AL"), ("GA", "AL")):
        if a in by and b in by:
            line = shapely.line_merge(by[a].boundary.intersection(by[b].boundary.buffer(0.002)))
            for part in shapely.get_parts(line):
                if part.geom_type == "LineString" and part.length > 0.05:
                    out.append(pack(list(part.simplify(0.002).coords)))
    return out


def oysters(refresh: bool = False) -> list[list[int]]:
    feats = arcgis_query(C.FWC_OYSTERS, OYSTER_BOX, fields="OBJECTID", refresh=refresh)
    g = unary_union([make_valid(shape(f["geometry"])) for f in feats if f.get("geometry")])
    log(f"apalachicola: {len(feats)} oyster beds, {g.area * KM2_PER_DEG2:.1f} km²")
    return polygon_rings(g.simplify(OYSTER_TOL, preserve_topology=True))


def pools() -> object:
    """The reservoirs and big lakes, as one prepared shape."""
    cols, geoms = nhd.table(HU4, "NHDWaterbody", ["FType", "AreaSqKm"], bbox=C.AP_VIEW, geometry=True)
    g = unary_union([g for ft, a, g in zip(cols["ftype"], cols["areasqkm"], geoms) if int(ft) in (390, 436) and a >= POOL_KM2]).buffer(0.001)
    shapely.prepare(g)
    return g


def history(refresh: bool = False) -> dict:
    site = {g["key"]: g["id"] for g in C.gauges("apalachicola")}
    chat = water_years(usgs.daily(site["CHAT"], refresh))
    years = list(range(min(chat), max(chat) + 1))
    return {"years": years, "CHAT": [chat.get(y) for y in years]}


def build(refresh: bool = False) -> dict:
    stems = main_stems()
    wet = pools()
    rivers = {}
    for name, path in stems.items():
        pts = simplified(path)
        rivers[name] = {"p": pack(pts), "pool": [int(wet.contains(shapely.Point(q))) for q in pts]}
    ctx = context(list(stems.values()))
    hist = history(refresh)
    log(f"apalachicola: {sum(len(r['pool']) for r in rivers.values())} river vertices, {sum(sum(r['pool']) for r in rivers.values())} pooled, {len(ctx)} context streams, flow for water years {hist['years'][0]}-{hist['years'][-1]}")
    return {
        "meta": {
            "generator": "waterways-pipeline apalachicola",
            "generatedAt": date.today().isoformat(),
            "sources": [C.NHD_BULK, C.CENSUS_STATES, C.FWC_OYSTERS, f"{C.USGS_API}/daily"],
            "coordOrigin": list(ORIGIN),
            "coordScale": SCALE,
        },
        "rivers": rivers,
        "context": ctx,
        "water": water(refresh),
        "oysters": oysters(refresh),
        "borders": borders(refresh),
        "structures": C.AP_STRUCTURES,
        "history": hist,
    }
