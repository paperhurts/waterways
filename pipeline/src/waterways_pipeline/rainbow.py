"""Data for the Rainbow River map (rainbow.json).

- Rivers: main stems of the Rainbow, the Withlacoochee from above Holder to the Gulf,
  and the Cross Florida Barge Canal, from NHDPlus HR.
- Vents: FDEP's spring vents along the upper Rainbow and Indian Creek. FDEP lists some
  vents more than once; points within VENT_SAME_M merge under the shortest name.
- Springshed: SWFWMD's Rainbow Springs Group springshed, which it interpreted from
  USGS's 1994 potentiometric maps. (Tracing one from the 10-ft FGS contours doesn't
  work: the spring isn't a low point in the regional surface, which keeps falling west
  to the Gulf, so paths slide past it.)
- Focus area: FDEP's Springs Priority Focus Area for Rainbow.
- Contours: the latest FGS Upper Floridan surface, around the springshed.
- History: water-year mean discharge of the Rainbow at Dunnellon and the Withlacoochee
  near Holder.
"""

from __future__ import annotations

import statistics
from collections import defaultdict
from datetime import date

from shapely.geometry import shape
from shapely.ops import unary_union

from . import aquifer, usgs
from . import config as C
from .fetch import arcgis_query, log
from .geo import ORIGIN, SCALE, LonLat, in_bbox, meters, simplify
from .rivers import KM2_PER_DEG2, main_stems, polygon_rings
from .springs import tidy_name

#: FDEP points closer than this are the same vent listed twice.
VENT_SAME_M = 15
SHED_SIMPLIFY_DEG = 0.002
FOCUS_SIMPLIFY_DEG = 0.001
CONTOUR_SIMPLIFY_DEG = 0.0008
#: A water year (October through September) needs this many daily values to count.
MIN_DAYS = 330


def vents(refresh: bool = False) -> list[list]:
    """[name, lon, lat] per vent, north to south."""
    feats = arcgis_query(C.FDEP_SPRINGS, C.RAINBOW_VENTS_BBOX, fields="SPRING_NAME", refresh=refresh)
    groups: list[tuple[LonLat, list[str]]] = []
    for f in feats:
        p: LonLat = tuple(f["geometry"]["coordinates"][:2])  # type: ignore[assignment]
        name = tidy_name(f["properties"].get("SPRING_NAME")) or "Spring"
        same = next((g for g in groups if meters(g[0], p) <= VENT_SAME_M), None)
        if same:
            same[1].append(name)
        else:
            groups.append((p, [name]))
    return [[min(names, key=len), round(p[0], 5), round(p[1], 5)] for p, names in sorted(groups, key=lambda g: -g[0][1])]


def area(layer: str, field: str, name: str, tolerance: float, refresh: bool = False) -> dict:
    """{km2, rings} for the polygon whose `field` is `name` (only geometry is kept)."""
    feats = arcgis_query(layer, C.RAINBOW_VENTS_BBOX, fields=field, refresh=refresh)
    shapes = [shape(f["geometry"]) for f in feats if f.get("geometry") and (f["properties"].get(field) or "").strip() == name]
    if not shapes:
        raise RuntimeError(f"{layer} has no {field} = {name!r} near Rainbow Springs")
    g = unary_union(shapes)
    return {"km2": round(g.area * KM2_PER_DEG2), "rings": polygon_rings(g.simplify(tolerance, preserve_topology=True))}


def contours(refresh: bool = False) -> list[dict]:
    """The latest surface's contours that cross the map, as {"v": ft, "p": [[lon, lat], ...]}."""
    out = []
    for v, part in aquifer.fetch_contours(aquifer.NOW, refresh, C.RAINBOW_VIEW):
        if any(in_bbox(p, C.RAINBOW_VIEW) for p in part):
            out.append({"v": int(v), "p": [[round(x, 4), round(y, 4)] for x, y in simplify(part, CONTOUR_SIMPLIFY_DEG)]})
    return out


def water_years(days: dict[str, float], today: date | None = None) -> dict[int, int]:
    """Mean discharge per finished water year (a year's October through the next September)."""
    today = today or date.today()
    groups: dict[int, list[float]] = defaultdict(list)
    for iso, v in days.items():
        year, month = int(iso[:4]), int(iso[5:7])
        groups[year + 1 if month >= 10 else year].append(v)
    return {y: round(statistics.fmean(vs)) for y, vs in groups.items() if len(vs) >= MIN_DAYS and date(y, 9, 30) < today}


def history(refresh: bool = False) -> dict:
    site = {g["key"]: g["id"] for g in C.gauges("rainbow")}
    rb = water_years(usgs.daily(site["Rb"], refresh))
    wh = water_years(usgs.daily(site["WH"], refresh))
    years = list(range(min(rb), max(rb) + 1))
    return {"years": years, "Rb": [rb.get(y) for y in years], "WH": [wh.get(y) for y in years]}


def build(refresh: bool = False) -> dict:
    rivers = main_stems(C.RAINBOW_RIVERS, C.RAINBOW_BBOX, refresh)
    vent_list = vents(refresh)
    shed = area(C.SWFWMD_SPRINGSHEDS, "SPRINGSHEDS_NAME", "Rainbow Springs Group", SHED_SIMPLIFY_DEG, refresh)
    focus = area(C.FDEP_PRIORITY_FOCUS, "NAME", "Rainbow", FOCUS_SIMPLIFY_DEG, refresh)
    hist = history(refresh)
    lines = contours(refresh)
    log(f"rainbow: {len(vent_list)} vents; springshed {shed['km2']} km2, focus area {focus['km2']} km2; {len(lines)} contours")
    log(f"rainbow: flows for water years {hist['years'][0]}-{hist['years'][-1]}")
    return {
        "meta": {
            "generator": "waterways-pipeline rainbow",
            "generatedAt": date.today().isoformat(),
            "sources": [C.NHD_FLOWLINES, C.FDEP_SPRINGS, C.SWFWMD_SPRINGSHEDS, C.FDEP_PRIORITY_FOCUS, C.FGS_POTENTIOMETRIC, f"{C.USGS_API}/daily"],
            "coordOrigin": list(ORIGIN),
            "coordScale": SCALE,
            "surface": aquifer.NOW,
        },
        "rivers": rivers,
        "vents": vent_list,
        "springshed": shed,
        "focusArea": focus,
        "contours": lines,
        "history": hist,
    }
