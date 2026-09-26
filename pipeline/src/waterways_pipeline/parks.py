"""Data for the state parks map (parks.json), and which park each spring is in (the
`park` field of springs.json).

- Parks: FDEP's Florida State Park Boundaries, every park, preserve, trail, and historic
  site the Division of Recreation and Parks runs. Only the name, counties, acreage, a
  floridastateparks.org link, and the geometry are kept. Two tiny sites that other parks
  manage ("… (Managed by …)") are left out.
- Water: FDEP maps each park's natural communities (FNAI's classification). Their acres
  are summed per park and grouped by the water they are (WATER below). A park's class:
    1. reef, if it holds living reef: FDEP's coral and worm reef communities, or FWC's
       Unified Reef Map's reef tract and patch reefs (only Pennekamp's, as it happens);
    2. springs, if it holds a spring run (SPRING_RUN_ACRES), a first- or second-magnitude
       spring, or is named for springs and holds one;
    3. lakes, if it's named for its lake ("Lake …"): the lake itself is rarely park land;
    4. otherwise whichever of rivers, lakes and wetlands, and coast covers the most, if
       that's at least MIN_WATER_ACRES and MIN_WATER_SHARE of the park. A park on salt
       water is coast if its coast comes within COAST_TIE of the most: the bay or lagoon
       it's named for usually isn't park land (Big Lagoon, Bald Point);
    5. otherwise land.
  Open salt water inside a park (the rain map's sea) counts as coast too, since FDEP
  leaves some submerged parks unmapped (San Pedro's shipwreck preserve).
- Springs: an FDEP spring is in a park when it's within SPRING_TOL_M of it. FDEP's
  points sit in the channel, and a park's line often follows the bank.
- First-magnitude springs: FDEP lists many first-magnitude vents separately (a dozen at
  Silver Springs, ten at Gainer), so vents within BIG_MERGE_M of each other count as one.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import date

import shapely
from shapely.geometry import Point, box, shape
from shapely.ops import nearest_points, polylabel, unary_union
from shapely.validation import make_valid

from . import config as C
from . import rain, reefs, springs, statewide
from .fetch import arcgis_query, get_json, log
from .geo import ORIGIN, SCALE, meters
from .rain import polygon_rings
from .rivers import KM2_PER_DEG2

BOUNDARIES = f"{C.FDEP_PARKS}/0"
COMMUNITIES = f"{C.FDEP_PARKS}/5"
CLASSES = ["springs", "rivers", "lakes", "coast", "reef", "land"]
ACRES_PER_KM2 = 247.105

#: FNAI natural communities that are water, by FDEP's EC_TYPE (typos and all) → (class, plain name).
WATER: dict[str, tuple[str, str]] = {
    "Spring-Run Stream": ("springs", "spring runs"),
    "Aquatic Cave": ("springs", "underwater caves"),
    "Blackwater Stream": ("rivers", "blackwater streams"),
    "Alluvial Stream": ("rivers", "alluvial streams"),
    "Seepage Stream": ("rivers", "seepage streams"),
    "Floodplain Swamp": ("rivers", "floodplain swamp"),
    "Floodplain Marsh": ("rivers", "floodplain marsh"),
    "Alluvial Forest": ("rivers", "floodplain forest"),
    "Bottomland Forest": ("rivers", "floodplain forest"),
    "River Floodplain Lake": ("rivers", "floodplain lakes"),
    "Marsh Lake": ("lakes", "lakes"),
    "Flatwoods/Prairie Lake": ("lakes", "lakes"),
    "Clastic Upland Lake": ("lakes", "lakes"),
    "Swamp Lake": ("lakes", "lakes"),
    "Sandhill Upland Lake": ("lakes", "lakes"),
    "Sinkhole Lake": ("lakes", "lakes"),
    "Coastal Dune Lake": ("lakes", "coastal dune lakes"),
    "Sinkhole": ("lakes", "sinkholes"),
    "Basin Marsh": ("lakes", "marsh"),
    "Depression Marsh": ("lakes", "marsh"),
    "Glades Marsh": ("lakes", "marsh"),
    "Slough Marsh": ("lakes", "marsh"),
    "Coastal Interdunal Swale": ("lakes", "marsh"),
    "Wet Prairie": ("lakes", "wet prairie"),
    "Marl Prairie": ("lakes", "wet prairie"),
    "Basin Swamp": ("lakes", "swamp"),
    "Dome Swamp": ("lakes", "swamp"),
    "Strand Swamp": ("lakes", "swamp"),
    "Baygall": ("lakes", "swamp"),
    "Slough": ("lakes", "sloughs"),
    "Marine Seagrass Bed": ("coast", "seagrass"),
    "Estuarine Seagrass Bed": ("coast", "seagrass"),
    "Mangrove Swamp": ("coast", "mangroves"),
    "Marine Tidal Swamp": ("coast", "mangroves"),
    "Estuarine Tidal Swamp": ("coast", "mangroves"),
    "Salt Marsh": ("coast", "salt marsh"),
    "Salt Maarsh": ("coast", "salt marsh"),
    "Marine Tidal Marsh": ("coast", "salt marsh"),
    "Estuarine Tidal Marsh": ("coast", "salt marsh"),
    "Marine Unconsolidated Substrate": ("coast", "sandy bottom"),
    "Estuarine Unconsolidated Substrate": ("coast", "sandy bottom"),
    "Eustarine Unconsolidated Substrate": ("coast", "sandy bottom"),
    "Marine Consolidated Substrate": ("coast", "hard bottom"),
    "Estuarine Consolidated Substrate": ("coast", "hard bottom"),
    "Marine Composite Substrate": ("coast", "sand and hard bottom"),
    "Estuarine Composite Substrate": ("coast", "sand and hard bottom"),
    "Marine Mollusk Reef": ("coast", "oyster reef"),
    "Estuarine Mollusk Reef": ("coast", "oyster reef"),
    "Beach Dune": ("coast", "beach and dunes"),
    "Coastal Strand": ("coast", "beach and dunes"),
    "CoastalStrand": ("coast", "beach and dunes"),
    "Coastal Grassland": ("coast", "beach and dunes"),
    "Coastal Berm": ("coast", "beach and dunes"),
    "Keys Tidal Rock Barren": ("coast", "tidal rock flats"),
    "Marine Coral Reef": ("reef", "coral reef"),
    "Marine Worm Reef": ("reef", "worm reef"),
}
SPRING_RUN_ACRES = 2.0
MIN_WATER_ACRES, MIN_WATER_SHARE = 10.0, 0.03
COAST_TIE = 0.75
#: A park this close to salt water (degrees, ~100 m) is on it.
SHORE_DEG = 0.001
SPRING_TOL_M = 50.0
BIG_MERGE_M = 2000.0
#: Water communities listed on a park's card.
CARD_WATERS = 4
PARK_SIMPLIFY_DEG = 0.0002


@dataclass
class Park:
    unit: str
    name: str
    county: str
    acres: float
    url: str | None
    geom: object
    water: dict[str, float] = field(default_factory=dict)
    kinds: dict[str, float] = field(default_factory=dict)
    springs: list = field(default_factory=list)
    big: int = 0
    coastal: bool = False
    cls: str = "land"


def tidy_county(s: str | None) -> str:
    """FDEP's county lists vary ("Martin,Palm Beach", "Dade"); make them read alike."""
    names = [c.strip() for c in (s or "").split(",") if c.strip()]
    return ", ".join("Miami-Dade" if c == "Dade" else c for c in names)


def boundaries(refresh: bool = False) -> list[Park]:
    feats = arcgis_query(BOUNDARIES, None, fields="UNIT_ID,SITE_NAME,ACREAGE,COUNTY,URL", refresh=refresh)
    out = []
    for f in feats:
        p = f["properties"]
        name = " ".join((p["SITE_NAME"] or "").split())
        if not f.get("geometry") or "(Managed by" in name:
            continue
        url = (p.get("URL") or "").strip()
        out.append(Park(p["UNIT_ID"], name, tidy_county(p.get("COUNTY")), float(p["ACREAGE"] or 0), url if url.startswith("https://www.floridastateparks.org/") else None, make_valid(shape(f["geometry"]))))
    names = [p.name for p in out]
    if len(set(names)) != len(names):
        raise RuntimeError("two parks share a name; springs.json names a spring's park by name")
    return sorted(out, key=lambda p: p.name)


def community_acres(refresh: bool = False) -> dict[str, dict[str, float]]:
    """{unit id: {EC_TYPE: acres}}. The server sums them, a range of unit ids at a time:
    it caps a statistics query at 2,000 rows and ignores paging for one."""
    stats = json.dumps([{"statisticType": "sum", "onStatisticField": "ACREAGE", "outStatisticFieldName": "acres"}])
    out: dict[str, dict[str, float]] = {}
    ranges = [("S00000", "S00050"), ("S00050", "S00100"), ("S00100", "S00200"), ("S00200", "S00250"), ("S00250", "S99999")]
    for lo, hi in ranges:
        r = get_json(f"{COMMUNITIES}/query", {"where": f"UNIT_ID >= '{lo}' AND UNIT_ID < '{hi}'", "outStatistics": stats, "groupByFieldsForStatistics": "UNIT_ID,EC_TYPE", "f": "json"}, refresh=refresh)
        if r.get("exceededTransferLimit"):
            raise RuntimeError(f"natural communities {lo}–{hi}: too many rows; split the range")
        for row in r["features"]:
            a = {k.lower(): v for k, v in row["attributes"].items()}
            kind = (a["ec_type"] or "").strip()
            out.setdefault(a["unit_id"], {})
            out[a["unit_id"]][kind] = out[a["unit_id"]].get(kind, 0.0) + float(a["acres"] or 0)
    return out


def acres(g) -> float:
    """Area in acres, from degrees at Florida's latitude."""
    return g.area * KM2_PER_DEG2 * ACRES_PER_KM2


def salt_water(refresh: bool):
    """The sea, bays, lagoons, and tidal rivers (the rain map's), as one prepared shape."""
    states = arcgis_query(C.CENSUS_STATES, statewide.VIEW, fields="STUSAB", refresh=refresh)
    land = unary_union([make_valid(shape(f["geometry"])) for f in states if f.get("geometry")])
    sea = rain.salt_water(land, refresh).intersection(box(*statewide.VIEW))
    shapely.prepare(sea)
    return sea


def live_reef(refresh: bool) -> list:
    """FWC's reef tract and patch reefs, as shapes."""
    shapes = []
    for where in (reefs.GROUPS["reef"][0], reefs.PATCHES):
        feats = arcgis_query(reefs.HABITAT, None, where=where, fields="OBJECTID", refresh=refresh, generalize=reefs.GENERALIZE)
        shapes += [make_valid(shape(f["geometry"])) for f in feats if f.get("geometry")]
    return shapes


def spring_parks(spr: list, parks: list[Park]) -> dict[str, Park]:
    """{spring id: its park} for the springs within SPRING_TOL_M of one."""
    geoms = [p.geom for p in parks]
    tree = shapely.STRtree(geoms)
    out = {}
    for s in spr:
        pt = Point(s.lon, s.lat)
        # A generous degree box first, then the ground distance to each park nearby.
        best, best_m = None, SPRING_TOL_M
        for i in tree.query(pt, predicate="dwithin", distance=SPRING_TOL_M / 90_000):
            g = geoms[i]
            if g.contains(pt):
                best, best_m = parks[i], 0.0
                break
            near = nearest_points(g, pt)[0]
            d = meters((near.x, near.y), (s.lon, s.lat))
            if d <= best_m:
                best, best_m = parks[i], d
        if best:
            out[s.id] = best
    return out


def big_springs(spr: list) -> list[list]:
    """First-magnitude vents grouped into springs: vents within BIG_MERGE_M of another in
    the group join it."""
    groups: list[list] = []
    for s in (s for s in spr if s.mag == 1):
        near = [g for g in groups if any(meters((s.lon, s.lat), (t.lon, t.lat)) <= BIG_MERGE_M for t in g)]
        merged = [s, *(t for g in near for t in g)]
        groups = [g for g in groups if not any(g is n for n in near)] + [merged]
    return groups


def classify(p: Park, reef_tree) -> str:
    """The park's class, by the rules in the module note."""
    if p.water.get("reef", 0) > 0 or len(reef_tree.query(p.geom, predicate="intersects")):
        return "reef"
    if p.water.get("springs", 0) >= SPRING_RUN_ACRES or any(s.mag in (1, 2) for s in p.springs) or (p.springs and "Spring" in p.name):
        return "springs"
    if p.name.startswith("Lake "):
        return "lakes"
    best = max(("rivers", "lakes", "coast"), key=lambda k: p.water.get(k, 0))
    if p.coastal and p.water.get("coast", 0) >= COAST_TIE * p.water.get(best, 0):
        best = "coast"
    w = p.water.get(best, 0)
    if w >= MIN_WATER_ACRES and w >= MIN_WATER_SHARE * p.acres:
        return best
    return "land"


def survey(refresh: bool = False) -> tuple[list[Park], dict[str, Park], list[list]]:
    """The parks with their water, springs, and class; {spring id: park}; and the
    first-magnitude springs, each a list of vents."""
    parks = boundaries(refresh)
    by_unit = community_acres(refresh)
    sea = salt_water(refresh)
    for p in parks:
        for kind, a in by_unit.get(p.unit, {}).items():
            if kind in WATER:
                cls, label = WATER[kind]
                p.water[cls] = p.water.get(cls, 0.0) + a
                p.kinds[label] = p.kinds.get(label, 0.0) + a
        open_sea = acres(p.geom.intersection(sea)) if sea.intersects(p.geom) else 0.0
        p.water["coast"] = max(p.water.get("coast", 0.0), open_sea)
        p.coastal = sea.intersects(p.geom.buffer(SHORE_DEG))
    spr = springs.fetch(refresh)
    where = spring_parks(spr, parks)
    for s in spr:
        if s.id in where:
            where[s.id].springs.append(s)
    groups = big_springs(spr)
    for g in groups:
        homes = {where[s.id].name for s in g if s.id in where}
        for p in parks:
            if p.name in homes:
                p.big += 1
    reef_tree = shapely.STRtree(live_reef(refresh))
    for p in parks:
        p.cls = classify(p, reef_tree)
    return parks, where, groups


def label_point(g) -> list[float]:
    """The point deepest inside the park's biggest piece, for its marker: on a trail a
    few dozen meters wide, anywhere else could round off it."""
    parts = list(getattr(g, "geoms", [g]))
    biggest = max((q for q in parts if q.geom_type == "Polygon"), key=lambda q: q.area)
    p = polylabel(biggest, tolerance=1e-5)
    return [round(p.x, 4), round(p.y, 4)]


def build(refresh: bool = False) -> dict:
    parks, where, groups = survey(refresh)
    counts = {c: sum(p.cls == c for p in parks) for c in CLASSES}
    log(f"parks: {len(parks)} parks {counts}; {len(where)} springs in parks; {sum(p.big for p in parks)} of {len(groups)} first-magnitude springs")
    return {
        "meta": {
            "generator": "waterways-pipeline parks",
            "generatedAt": date.today().isoformat(),
            "sources": [BOUNDARIES, COMMUNITIES, C.FDEP_SPRINGS, reefs.HABITAT, C.CENSUS_STATES, C.NHD_BULK],
            "coordOrigin": list(ORIGIN),
            "coordScale": SCALE,
            "classes": CLASSES,
        },
        "firstMagnitude": len(groups),
        "parks": [
            {
                "name": p.name,
                "county": p.county,
                "acres": round(p.acres),
                "url": p.url,
                "water": CLASSES.index(p.cls),
                "kinds": [[k, round(a)] for k, a in sorted(p.kinds.items(), key=lambda kv: -kv[1]) if round(a) > 0][:CARD_WATERS],
                "springs": len(p.springs),
                "big": p.big,
                "at": label_point(shape_),
                "rings": polygon_rings(shape_),
            }
            for p in parks
            for shape_ in [p.geom.simplify(PARK_SIMPLIFY_DEG, preserve_topology=True)]
        ],
    }


def park_names(refresh: bool = False) -> dict[str, str]:
    """{spring id: park name} for springs.json."""
    parks = boundaries(refresh)
    return {sid: p.name for sid, p in spring_parks(springs.fetch(refresh), parks).items()}

