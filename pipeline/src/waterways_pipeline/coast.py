"""The sea around the rain map, for drawing it and for telling which creeks reach it.

The sea is everything in C.SEA_CLIP that isn't land in the Census Bureau's
shoreline-clipped state outlines. (NHD's sea polygons end offshore in
watershed-boundary staircases, so they can't draw a coast.) Those outlines count
the Indian River Lagoon as land, so in C.LAGOON_AREAS NHD's bays join the sea, and so
do the wide rivers that open onto it, like the St. Lucie's estuary.
"""

from __future__ import annotations

from typing import Literal

from shapely.geometry import Point, box, shape
from shapely.ops import unary_union
from shapely.prepared import prep

from . import config as C
from . import nhd
from .fetch import arcgis_query
from .geo import LonLat

#: A creek that ends this close to the sea (degrees, about 1.5 km) empties into it. The
#: Census coastline is generalized, and NHD often ends coastal creeks at the marsh edge.
COAST_DEG = 0.015
#: West of this longitude the coast is the Gulf's; east of it, the Atlantic's.
PENINSULA_SPINE = -82.0


def sea(refresh: bool = False, clip: C.Bbox = C.SEA_CLIP, lagoons: list[C.Bbox] | None = None):
    """Everything in `clip` that isn't land, and NHD's bays in the `lagoons` boxes
    (by default the rain map's, C.LAGOON_AREAS)."""
    states = arcgis_query(C.CENSUS_STATES, clip, fields="STUSAB", refresh=refresh)
    land = unary_union([shape(f["geometry"]) for f in states if f.get("geometry")])
    water = box(*clip).difference(land)
    boxes = C.LAGOON_AREAS if lagoons is None else lagoons
    if not boxes:
        return water
    salt = unary_union([water, areas(boxes, C.FTYPE_BAY_INLET, refresh)])
    # Wide rivers only count where they open onto that water: the tidal St. Lucie, not the
    # St. Johns' marshes upstream.
    rivers = areas(boxes, C.FTYPE_STREAM_AREA, refresh)
    rivers = [g for g in getattr(rivers, "geoms", [rivers]) if g.intersects(salt.buffer(TIDAL_DEG))]
    return unary_union([salt, *rivers])


#: A wide river counts as tidal when it comes this close (degrees, ~100 m) to the sea or a lagoon.
TIDAL_DEG = 0.001


def areas(boxes: list[C.Bbox], ftype: int, refresh: bool = False):
    """NHD's areas of one type (BayInlet: lagoons, coves, inlets; StreamRiver: wide rivers)
    touching the boxes, clipped to them."""
    seen: set = set()
    parts = []
    for a in boxes:
        for f in nhd.query(C.NHD_AREAS, a, where=f"ftype = {ftype}", fields="nhdplusid", refresh=refresh):
            key = f["properties"].get("nhdplusid")
            if f.get("geometry") and key not in seen:
                seen.add(key)
                parts.append(shape(f["geometry"]).intersection(box(*a)))
    return unary_union(parts)


class Coast:
    def __init__(self, sea_geometry) -> None:
        self._near = prep(sea_geometry.buffer(COAST_DEG))

    def sea_at(self, p: LonLat) -> Literal["gulf", "atl"] | None:
        """Which sea a creek ending at `p` empties into, or None if it ends inland."""
        if not self._near.contains(Point(p)):
            return None
        return "gulf" if p[0] < PENINSULA_SPINE else "atl"
