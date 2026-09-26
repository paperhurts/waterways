"""Data for the coral reef map (reefs.json).

- Habitat: FWC FWRI's Unified Florida Reef Map, Martin County to the Dry Tortugas,
  geometry and classes only, split by Coral Reef Watch station (C.REEF_STATIONS):
  - reef: aggregate reefs and spur and groove, the reef tract itself, as polygons;
  - patches: individual and aggregated patch reefs, one point each (they're specks
    at map scale, and 15,000 rings would be most of the file);
  - hard bottom (pavement, ridges, rubble) and seagrass, the smallest pieces dropped;
  - artificial reefs, one point each.
  Polygons are dissolved per class, simplified, and delta-packed like the rain map's.
- Regions: the Unified Reef Map's twelve regions, for cards.
- Water: the sea with every bay in it (the rain map's salt water), for the coast.
- Heat: NOAA Coral Reef Watch's yearly peak Degree Heating Weeks at each station since
  1985 (crw.py). Today's heat goes in snapshot.json.
"""

from __future__ import annotations

from datetime import date

import shapely
from shapely.geometry import MultiPolygon, box, shape
from shapely.ops import unary_union
from shapely.validation import make_valid

from . import config as C
from . import crw, rain
from .fetch import arcgis_query, log
from .geo import ORIGIN, SCALE
from .rain import delta, polygon_rings, quantize
from .rivers import KM2_PER_DEG2, drop_specks

HABITAT = f"{C.URM}/7"
REGIONS = f"{C.URM}/14"
#: Classes (FIRST_ClassLv1 or Lv0), as (where clause, smallest piece kept in km², simplify degrees).
GROUPS = {
    "reef": ("FIRST_ClassLv1 = 'Aggregate Reef'", 0.0, 0.0003),
    "hardbottom": ("FIRST_ClassLv1 IN ('Pavement', 'Ridge', 'Reef Rubble')", 0.02, 0.0008),
    "seagrass": ("FIRST_ClassLv0 = 'Seagrass'", 0.3, 0.0015),
}
PATCHES = "FIRST_ClassLv1 = 'Individual or Aggregated Patch Reef'"
ARTIFICIAL = "FIRST_ClassLv0 = 'Artificial'"
#: The server simplifies geometry this much first (degrees, ~10 m), which keeps pages small.
GENERALIZE = 0.0001
REGION_SIMPLIFY_DEG = 0.002


def polygons(g) -> MultiPolygon:
    """The polygonal parts of a geometry (make_valid can leave lines in a collection)."""
    parts = []
    for p in shapely.get_parts(g):
        if p.geom_type == "Polygon":
            parts.append(p)
        elif p.geom_type == "MultiPolygon":
            parts.extend(p.geoms)
    return MultiPolygon(parts)


def regions(refresh: bool) -> list[tuple[str, str, object]]:
    """(region, station, shape) for every Unified Reef Map region."""
    station_of = {r: k for k, rs in C.REEF_STATIONS.items() for r in rs}
    out = []
    for f in arcgis_query(REGIONS, None, fields="Region", refresh=refresh):
        name = f["properties"]["Region"]
        if name not in station_of:
            raise RuntimeError(f"no Coral Reef Watch station for reef region {name!r}")
        out.append((name, station_of[name], make_valid(shape(f["geometry"]))))
    return out


def by_station(g, regs) -> dict[str, MultiPolygon]:
    return {k: polygons(g.intersection(unary_union([s for _, st, s in regs if st == k]))) for k in C.REEF_STATIONS}


def points(where: str, regs, refresh: bool) -> dict[str, list[int]]:
    """A point inside each feature, delta-packed per station."""
    pts: dict[str, list[tuple[float, float]]] = {k: [] for k in C.REEF_STATIONS}
    tree = [(st, s) for _, st, s in regs]
    for f in arcgis_query(HABITAT, None, where=where, fields="OBJECTID", refresh=refresh, generalize=GENERALIZE):
        if not f.get("geometry"):
            continue
        p = make_valid(shape(f["geometry"])).representative_point()
        st = next((st for st, s in tree if s.contains(p)), None)
        if st:
            pts[st].append((p.x, p.y))
    return {k: delta(quantize(sorted(v))) if v else [] for k, v in pts.items()}


def habitat(refresh: bool, regs) -> dict:
    out: dict = {}
    for name, (where, speck, tol) in GROUPS.items():
        feats = arcgis_query(HABITAT, None, where=where, fields="OBJECTID", refresh=refresh, generalize=GENERALIZE)
        g = polygons(unary_union([make_valid(shape(f["geometry"])) for f in feats if f.get("geometry")]))
        if speck:
            g = drop_specks(g, speck)
        if name == "reef":
            out[name] = {k: polygon_rings(v.simplify(tol, preserve_topology=True)) for k, v in by_station(g, regs).items()}
        else:
            out[name] = polygon_rings(g.simplify(tol, preserve_topology=True))
        log(f"reefs: {name}: {len(feats)} features, {g.area * KM2_PER_DEG2:.0f} km²")
    out["patches"] = points(PATCHES, regs, refresh)
    out["artificial"] = points(ARTIFICIAL, regs, refresh)
    return out


def sea(refresh: bool) -> list[list[int]]:
    states = arcgis_query(C.CENSUS_STATES, C.REEF_WATER, fields="STUSAB", refresh=refresh)
    land = unary_union([make_valid(shape(f["geometry"])) for f in states if f.get("geometry")])
    water = drop_specks(rain.salt_water(land, refresh).intersection(box(*C.REEF_WATER)), 0.5)
    return polygon_rings(water.simplify(0.0005, preserve_topology=True))


def build(refresh: bool = False) -> dict:
    regs = regions(refresh)
    heat = {k: crw.yearly_peaks(crw.fetch(k)) for k in C.REEF_STATIONS}
    years = sorted(set().union(*heat.values()))
    return {
        "meta": {
            "generator": "waterways-pipeline reefs",
            "generatedAt": date.today().isoformat(),
            "sources": [HABITAT, REGIONS, *crw.STATIONS.values(), C.CENSUS_STATES],
            "coordOrigin": list(ORIGIN),
            "coordScale": SCALE,
        },
        "sea": sea(refresh),
        "habitat": habitat(refresh, regs),
        "regions": [{"name": n, "station": st, "rings": polygon_rings(s.simplify(REGION_SIMPLIFY_DEG, preserve_topology=True))} for n, st, s in regs],
        "heat": {"years": years, **{k: [v.get(y) for y in years] for k, v in heat.items()}},
    }
