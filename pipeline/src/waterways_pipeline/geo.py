"""Small geometry helpers shared by the builders."""

from __future__ import annotations

import math

from shapely.geometry import LineString, MultiLineString, shape

LonLat = tuple[float, float]

#: Packed coordinates: ints of (lon - ORIGIN[0]) * SCALE. Matches the frontend decoder.
ORIGIN = (-83.0, 29.5)
SCALE = 1e4


def meters(a: LonLat, b: LonLat) -> float:
    """Approximate ground distance; fine at this latitude and scale."""
    lat = math.radians((a[1] + b[1]) / 2)
    return math.hypot((a[0] - b[0]) * 111_320 * math.cos(lat), (a[1] - b[1]) * 110_540)


def line_coords(geometry: dict) -> list[LonLat]:
    """Coordinates of a GeoJSON (Multi)LineString, with multi parts joined end to end."""
    g = shape(geometry)
    parts = g.geoms if isinstance(g, MultiLineString) else [g]
    out: list[LonLat] = []
    for part in parts:
        for x, y in part.coords:
            if not out or (x, y) != out[-1]:
                out.append((x, y))
    return out


def line_parts(geometry: dict) -> list[list[LonLat]]:
    """Each part of a GeoJSON (Multi)LineString separately. Contour layers pack a
    whole statewide level into one multi-part feature, so joining parts would
    draw lines across the state."""
    g = shape(geometry)
    return [list(part.coords) for part in (g.geoms if isinstance(g, MultiLineString) else [g])]


def simplify(coords: list[LonLat], tolerance: float) -> list[LonLat]:
    if len(coords) < 3 or tolerance <= 0:
        return coords
    return list(LineString(coords).simplify(tolerance, preserve_topology=False).coords)


def pack(coords: list[LonLat]) -> list[int]:
    """Quantize to ~11 m and flatten, dropping repeated points but keeping at least two."""
    flat: list[int] = []
    for lon, lat in coords:
        x = round((lon - ORIGIN[0]) * SCALE)
        y = round((lat - ORIGIN[1]) * SCALE)
        if len(flat) >= 2 and flat[-2] == x and flat[-1] == y:
            continue
        flat += [x, y]
    if len(flat) == 2:
        flat += flat
    return flat


def in_bbox(p: LonLat, bbox: tuple[float, float, float, float]) -> bool:
    return bbox[0] <= p[0] <= bbox[2] and bbox[1] <= p[1] <= bbox[3]
