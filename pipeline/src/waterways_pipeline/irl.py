"""Data for the Indian River Lagoon map (indian-river.json).

- Water: the sea with every bay and tidal river in it (the rain map's salt water),
  then lakes, packed like the lakes files.
- Lagoon: that salt water less the open Atlantic: the lagoon behind the barrier islands,
  Mosquito Lagoon, the Banana River, and the estuaries that open onto them.
- Flushing: how far each cell of the lagoon is by water from the nearest inlet (km), on
  the C.IRL_GRID grid, from a shortest-path walk through the lagoon's cells. Water far
  from an inlet trades with the sea slowest. Base64 uint8, row 0 south, 255 = not lagoon.
  The walk runs through the lagoon widened by most of a cell, so channels narrower than
  a cell (Mosquito Lagoon's among its mangrove islands) still connect; the page clips it
  to the lagoon's outline. The canals that also link the water (Haulover, the barge canal
  to Port Canaveral) aren't lagoon, so the walk goes the way the tide mostly does.
- Inlets: C.IRL_INLETS, each checked to sit where the lagoon meets the sea.
- Streams: for each gauged creek and canal, NHD's path from the gauge down into the
  lagoon, followed flowline to flowline by their ends (NHD draws each in the direction
  water flows). Vero's North and South canals aren't in NHD's flow network, so the
  network's links can't be used. For Haulover Canal, the canal itself, west (the Indian
  River) to east (Mosquito Lagoon), the direction USGS counts as positive.
- History: water-year mean flow into the lagoon from the drainage canals and from the
  creeks (C.IRL_CANALS, C.IRL_CREEKS), in years every gauge of a group reports.
"""

from __future__ import annotations

import base64
import heapq
import math
from datetime import date

import numpy as np
import shapely
from shapely.geometry import LineString, Point, box, shape
from shapely.ops import nearest_points, unary_union
from shapely.validation import make_valid

from . import config as C
from . import nhd, rain, usgs
from .fetch import arcgis_query, log
from .geo import ORIGIN, SCALE, LonLat, meters, pack
from .rainbow import water_years
from .rivers import KM2_PER_DEG2, LAKE_SIMPLIFY_DEG, SEA_SIMPLIFY_DEG, drop_specks, polygon_rings

#: The HUCs the lagoon's watershed spans (the St. Johns' and south Florida's).
HU4S = ["0308", "0309"]
#: A point well out in the Atlantic, to find the open ocean among the salt water.
OFFSHORE: LonLat = (-79.9, 28.0)
#: An inlet must sit this close (m) to both the lagoon and the open ocean.
INLET_REACH_M = 1500
#: Lagoon cells this close (m) to an inlet start the walk at zero.
INLET_SEED_M = 1200
LAKE_MIN_KM2 = 0.5
#: Lakes come from a tighter box than the sea: the lagoon's watershed and a margin.
LAKES_BOX: C.Bbox = (-81.4, 26.7, -79.6, 29.4)
LAGOON_SPECK_KM2 = 0.2
#: A gauge must sit this close (m) to the flowline it's on.
ON_LINE_M = 400
STREAM_SIMPLIFY_DEG = 0.0003


def salt_and_ocean(refresh: bool):
    """The salt water in the view's clip, and the open Atlantic part of it."""
    states = arcgis_query(C.CENSUS_STATES, C.IRL_WATER, fields="STUSAB", refresh=refresh)
    land = unary_union([make_valid(shape(f["geometry"])) for f in states if f.get("geometry")])
    clip = box(*C.IRL_WATER)
    salt = rain.salt_water(land, refresh).intersection(clip)
    census_water = clip.difference(land)
    ocean = next(g for g in getattr(census_water, "geoms", [census_water]) if g.contains(Point(OFFSHORE)))
    return salt, ocean


def lagoon_of(salt, ocean):
    return drop_specks(salt.difference(ocean).intersection(box(*C.IRL_VIEW)), LAGOON_SPECK_KM2)


def check_inlets(lagoon, ocean) -> None:
    for inlet in C.IRL_INLETS:
        p = Point(inlet["lon"], inlet["lat"])
        for what, g in (("lagoon", lagoon), ("ocean", ocean)):
            near = nearest_points(p, g)[1]
            if meters((p.x, p.y), (near.x, near.y)) > INLET_REACH_M:
                raise RuntimeError(f"{inlet['name']} isn't within {INLET_REACH_M} m of the {what}")


def flushing(lagoon) -> tuple[str, int]:
    """Base64 uint8 km by water from each lagoon cell to its nearest inlet (255 = not
    lagoon), and the farthest distance."""
    g = C.IRL_GRID
    nx, ny, res = g["nx"], g["ny"], g["res"]
    xs = g["lon0"] + (np.arange(nx) + 0.5) * res
    ys = g["lat0"] + (np.arange(ny) + 0.5) * res
    gx, gy = np.meshgrid(xs, ys)
    water = shapely.contains_xy(lagoon.buffer(res * 0.75), gx, gy)
    km_x = res * 111.32 * math.cos(math.radians((g["lat0"] + ny * res / 2)))
    km_y = res * 110.57
    dist = np.full((ny, nx), np.inf)
    heap: list[tuple[float, int, int]] = []
    for inlet in C.IRL_INLETS:
        for r in range(ny):
            for c in range(nx):
                if water[r, c] and meters((inlet["lon"], inlet["lat"]), (gx[r, c], gy[r, c])) <= INLET_SEED_M:
                    dist[r, c] = 0.0
                    heap.append((0.0, r, c))
    if not heap:
        raise RuntimeError("no lagoon cells near any inlet")
    heapq.heapify(heap)
    steps = [(dr, dc, math.hypot(dr * km_y, dc * km_x)) for dr in (-1, 0, 1) for dc in (-1, 0, 1) if dr or dc]
    while heap:
        d, r, c = heapq.heappop(heap)
        if d > dist[r, c]:
            continue
        for dr, dc, cost in steps:
            rr, cc = r + dr, c + dc
            if 0 <= rr < ny and 0 <= cc < nx and water[rr, cc] and d + cost < dist[rr, cc]:
                dist[rr, cc] = d + cost
                heapq.heappush(heap, (d + cost, rr, cc))
    reached = np.isfinite(dist)
    km = np.where(reached, np.minimum(np.round(dist), 254), 255).astype(np.uint8)
    unreached = int((water & ~reached).sum())
    if unreached:
        log(f"irl: {unreached} lagoon cells have no water path to an inlet")
    return base64.b64encode(km.tobytes()).decode(), int(dist[reached].max())


def water(salt, refresh: bool) -> list[dict]:
    """The sea (with the lagoon), then lakes largest first, like the lakes files."""
    sea = drop_specks(salt, 0.5).simplify(SEA_SIMPLIFY_DEG, preserve_topology=True)
    bodies = [{"name": None, "kind": "sea", "km2": round(sea.area * KM2_PER_DEG2), "rings": polygon_rings(sea)}]
    for hu4 in HU4S:
        cols, geoms = nhd.table(hu4, "NHDWaterbody", ["GNIS_Name", "FType", "AreaSqKm"], where=f"FType IN (390, 436) AND AreaSqKm >= {LAKE_MIN_KM2}", bbox=LAKES_BOX, geometry=True)
        for name, km2, g in zip(cols["gnis_name"], cols["areasqkm"], geoms):
            if g is None:
                continue
            g = make_valid(g).intersection(box(*LAKES_BOX)).simplify(LAKE_SIMPLIFY_DEG, preserve_topology=True)
            if rings := polygon_rings(g):
                bodies.append({"name": name or None, "kind": "lake", "km2": round(float(km2), 2), "rings": rings})
    bodies[1:] = sorted(bodies[1:], key=lambda b: -b["km2"])
    return bodies


def streams(lagoon) -> dict[str, list[int]]:
    """Each gauge's path into the lagoon, packed flat."""
    lines: list[tuple[list[LonLat], str | None]] = []
    for hu4 in HU4S:
        cols, geoms = nhd.table(hu4, "NHDFlowline", ["GNIS_Name", "FType"], bbox=C.IRL_WATER, geometry=True)
        lines += [(rain.joined(g), name or None) for name, ftype, g in zip(cols["gnis_name"], cols["ftype"], geoms) if g is not None and ftype != C.FTYPE_COASTLINE]
    key = lambda p: (round(p[0], 6), round(p[1], 6))  # noqa: E731
    starting: dict[tuple[float, float], list[int]] = {}
    for i, (pts, _) in enumerate(lines):
        starting.setdefault(key(pts[0]), []).append(i)
    tree = shapely.STRtree([LineString(pts) if len(pts) > 1 else Point(pts[0]) for pts, _ in lines])
    shapely.prepare(lagoon)
    inside = lambda p: lagoon.contains(Point(p))  # noqa: E731
    out: dict[str, list[int]] = {}
    for gauge in C.gauges("indian-river"):
        at = Point(gauge["lon"], gauge["lat"])
        if gauge["key"] == "HAUL":
            pts = sorted({p for pts, name in lines if name == "Haulover Canal" for p in pts})
            if len(pts) < 2:
                raise RuntimeError("NHD has no flowline named Haulover Canal")
            # West to east: from the Indian River toward Mosquito Lagoon.
            out["HAUL"] = pack(list(LineString(pts).simplify(STREAM_SIMPLIFY_DEG).coords))
            continue
        idx = tree.query_nearest(at, max_distance=ON_LINE_M / 90_000)
        if not len(idx):
            raise RuntimeError(f"no flowline near the {gauge['short']} gauge")
        i = int(idx[0])
        first, name = lines[i]
        k = min(range(len(first)), key=lambda j: meters(first[j], (at.x, at.y)))
        path: list[LonLat] = first[k:] if len(first) - k > 1 else first[-2:]
        seen = {i}
        # Downstream, flowline by flowline, until the water is in the lagoon.
        while not any(inside(p) for p in path[-3:]):
            nxt = [j for j in starting.get(key(path[-1]), []) if j not in seen]
            if not nxt:
                break
            j = next((j for j in nxt if lines[j][1] == name), nxt[0])
            seen.add(j)
            name = lines[j][1] or name
            path += lines[j][0][1:]
        if not any(inside(p) for p in path):
            # A ditch NHD leaves unjoined at the shore: finish the last few hundred meters straight.
            end = nearest_points(Point(path[-1]), lagoon)[1]
            if meters(path[-1], (end.x, end.y)) > 2000:
                raise RuntimeError(f"{gauge['short']}'s water doesn't reach the lagoon")
            path.append((end.x, end.y))
        cut = next(i for i, p in enumerate(path) if inside(p))
        if cut == 0:
            # The gauge is on tidal water the lagoon already includes: a stub to its edge.
            log(f"irl: the {gauge['short']} gauge sits in the lagoon's tidal water")
            cut = 1
        out[gauge["key"]] = pack(list(LineString(path[: cut + 1]).simplify(STREAM_SIMPLIFY_DEG).coords))
    return out


def history(refresh: bool) -> dict:
    """Water-year mean inflow from each group, in years every gauge in it reports."""
    site = {g["key"]: g["id"] for g in C.gauges("indian-river")}
    years_of = {k: water_years(usgs.daily(site[k], refresh)) for k in [*C.IRL_CANALS, *C.IRL_CREEKS]}

    def total(keys: list[str]) -> dict[int, int]:
        common = set.intersection(*(set(years_of[k]) for k in keys))
        return {y: sum(years_of[k][y] for k in keys) for y in common}

    canals, creeks = total(C.IRL_CANALS), total(C.IRL_CREEKS)
    years = list(range(min(canals | creeks), max(canals | creeks) + 1))
    return {"years": years, "canals": [canals.get(y) for y in years], "creeks": [creeks.get(y) for y in years]}


def build(refresh: bool = False) -> dict:
    salt, ocean = salt_and_ocean(refresh)
    lagoon = lagoon_of(salt, ocean)
    check_inlets(lagoon, ocean)
    grid, farthest = flushing(lagoon)
    log(f"irl: lagoon {lagoon.area * KM2_PER_DEG2:.0f} km², farthest {farthest} km by water from an inlet")
    lagoon_shape = lagoon.simplify(SEA_SIMPLIFY_DEG, preserve_topology=True)
    return {
        "meta": {
            "generator": "waterways-pipeline irl",
            "generatedAt": date.today().isoformat(),
            "sources": [C.NHD_BULK.format(hu4="{" + ",".join(HU4S) + "}"), C.CENSUS_STATES, f"{C.USGS_API}/daily"],
            "coordOrigin": list(ORIGIN),
            "coordScale": SCALE,
        },
        "water": water(salt, refresh),
        "lagoon": polygon_rings(lagoon_shape),
        "grid": C.IRL_GRID | {"km": grid, "farthest": farthest},
        "inlets": C.IRL_INLETS,
        "streams": streams(lagoon),
        "history": history(refresh),
    }
