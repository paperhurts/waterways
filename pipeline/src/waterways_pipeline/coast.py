"""The sea, for drawing it and for telling which creeks reach it.

The sea is everything in a clip box that isn't land in the Census Bureau's
shoreline-clipped state outlines. (NHD's sea polygons end offshore in
watershed-boundary staircases, so they can't draw a coast.) Those outlines count
the Indian River Lagoon as land; the rain map adds NHD's bays to fix that
(rain.salt_water).
"""

from __future__ import annotations

from typing import Literal

from shapely.geometry import Point, Polygon, box, shape
from shapely.ops import unary_union
from shapely.prepared import prep

from . import config as C
from .fetch import arcgis_query
from .geo import LonLat

#: A creek that ends this close to the sea (degrees, about 1.5 km) empties into it. The
#: Census coastline is generalized, and NHD often ends coastal creeks at the marsh edge.
COAST_DEG = 0.015
#: The Atlantic side of Florida: east of a line down the peninsula's spine to Biscayne
#: Bay, then outside the Keys. Florida Bay and everything west of it is the Gulf's. Only
#: coastal points are ever tested, so the line can cut across land freely.
ATLANTIC_SIDE = Polygon([
    (-82.05, 32.5), (-82.05, 30.0), (-81.6, 28.5), (-81.1, 27.0), (-80.85, 25.9), (-80.55, 25.35),
    (-80.62, 24.97), (-81.1, 24.66), (-81.8, 24.52), (-82.2, 24.42), (-82.2, 23.0), (-78.0, 23.0), (-78.0, 32.5),
])
_atlantic = prep(ATLANTIC_SIDE)


def sea_side(p: LonLat) -> Literal["gulf", "atl"]:
    """Which sea a coastal point faces."""
    return "atl" if _atlantic.contains(Point(p)) else "gulf"


def sea(refresh: bool, clip: C.Bbox):
    """Everything in `clip` that isn't land."""
    states = arcgis_query(C.CENSUS_STATES, clip, fields="STUSAB", refresh=refresh)
    land = unary_union([shape(f["geometry"]) for f in states if f.get("geometry")])
    return box(*clip).difference(land)


#: A wide river counts as tidal when it comes this close (degrees, ~100 m) to the sea or a lagoon.
TIDAL_DEG = 0.001


class Coast:
    def __init__(self, sea_geometry) -> None:
        self._near = prep(sea_geometry.buffer(COAST_DEG))

    def sea_at(self, p: LonLat) -> Literal["gulf", "atl"] | None:
        """Which sea a creek ending at `p` empties into, or None if it ends inland."""
        if not self._near.contains(Point(p)):
            return None
        return sea_side(p)
