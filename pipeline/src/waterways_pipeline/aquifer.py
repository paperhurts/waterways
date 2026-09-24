"""Upper Floridan aquifer potentiometric surfaces, gridded from FGS contours.

Every surface (USGS pre-development through FGS September 2022) comes from
one FDEP/FGS layer keyed by MONTH_YEAR. Each grid cell gets a value
interpolated between the two nearest contour lines of different elevation,
weighted by distance. Unlike triangulating contour vertices, that doesn't
leave flat terraces between lines of the same level.
"""

from __future__ import annotations

import base64
from datetime import date

import numpy as np
import shapely
from shapely.geometry import MultiLineString

from . import config as C
from . import usgs
from .fetch import arcgis_query, log
from .geo import line_parts, simplify

#: (label shown in the app, FGS MONTH_YEAR, month whose river flows go with it)
STEPS: list[tuple[str, str, usgs.Month | str]] = [
    ("Before development", "Pre-development", "typical"),
    ("1934", "1934", (1934, 5)),
    ("July 1961", "July 1961", (1961, 7)),
    ("May 1980", "May 1980", (1980, 5)),
    ("May 1990", "May 1990", (1990, 5)),
    ("May 1995", "May 1995", (1995, 5)),
    ("May 2000", "May 2000", (2000, 5)),
    ("May 2010", "May 2010", (2010, 5)),
    *[(f"May {y}", f"May {y}", (y, 5)) for y in range(2012, 2023)],
]
#: The latest surface, drawn under current gauge readings.
NOW = "September 2022"
#: Fetch a margin around the grid so contours just outside still shape its edges.
FETCH_PAD_DEG = 0.3
CONTOUR_SIMPLIFY_DEG = 0.0008
KX = float(np.cos(np.radians(29.75)))


def grid_bbox(pad: float = 0.0) -> C.Bbox:
    g = C.AQUIFER_GRID
    return (g["lon0"] - pad, g["lat0"] - pad, g["lon0"] + (g["nx"] - 1) * g["res"] + pad, g["lat0"] + (g["ny"] - 1) * g["res"] + pad)


def fetch_contours(month_year: str, refresh: bool = False) -> list[tuple[float, list[tuple[float, float]]]]:
    feats = arcgis_query(C.FGS_POTENTIOMETRIC, grid_bbox(FETCH_PAD_DEG), where=f"MONTH_YEAR='{month_year}'", fields="CONTOUR,MONTH_YEAR", refresh=refresh)
    out = [(float(f["properties"]["CONTOUR"]), part) for f in feats if f.get("geometry") for part in line_parts(f["geometry"])]
    if not out:
        raise RuntimeError(f"FGS returned no contours for {month_year!r}")
    return out


def interpolate(contours: list[tuple[float, list[tuple[float, float]]]], spec: dict = C.AQUIFER_GRID) -> np.ndarray:
    """Grid of feet, shape (ny, nx), row 0 at the southern edge."""
    nx, ny = spec["nx"], spec["ny"]
    lon = spec["lon0"] + np.arange(nx) * spec["res"]
    lat = spec["lat0"] + np.arange(ny) * spec["res"]
    gx, gy = np.meshgrid(lon * KX, lat)
    cells = shapely.points(gx.ravel(), gy.ravel())

    levels = sorted({v for v, _ in contours})
    dist = np.empty((len(levels), cells.size))
    for k, level in enumerate(levels):
        lines = MultiLineString([[(x * KX, y) for x, y in c] for v, c in contours if v == level and len(c) > 1])
        dist[k] = shapely.distance(cells, lines)

    lv = np.array(levels)
    order = np.argsort(dist, axis=0)
    first = order[0]
    d1 = np.take_along_axis(dist, first[None], 0)[0]
    # Nearest line whose level differs from the nearest one.
    masked = np.where(lv[:, None] == lv[first][None, :], np.inf, dist)
    second = np.argmin(masked, axis=0)
    d2 = np.take_along_axis(masked, second[None], 0)[0]
    l1, l2 = lv[first], lv[second]
    single = ~np.isfinite(d2)
    w = np.where(single, 1.0, d2 / np.where(single, 1.0, d1 + d2 + 1e-12))
    z = np.where(single, l1, l1 * w + l2 * (1 - w))
    return z.reshape(ny, nx)


def encode(z: np.ndarray) -> str:
    """Half-foot bytes, base64. Matches decodeGrid in src/santa-fe/aquifer.ts."""
    return base64.b64encode(np.clip(np.round(z * 2), 0, 255).astype(np.uint8).tobytes()).decode()


def window_mean(z: np.ndarray, spec: dict = C.AQUIFER_GRID, window: C.Bbox = C.AQUIFER_MEAN_WINDOW) -> float:
    lon = spec["lon0"] + np.arange(spec["nx"]) * spec["res"]
    lat = spec["lat0"] + np.arange(spec["ny"]) * spec["res"]
    cols = (lon >= window[0] - 1e-9) & (lon <= window[2] + 1e-9)
    rows = (lat >= window[1] - 1e-9) & (lat <= window[3] + 1e-9)
    return round(float(z[np.ix_(rows, cols)].mean()), 1)


def build(refresh: bool = False) -> tuple[dict, dict]:
    """(aquifer.json, contours.json)."""
    months = usgs.all_monthly(refresh)
    grids, steps = {}, []
    now_contours = fetch_contours(NOW, refresh)
    for label, month_year, when in [*STEPS, ("Now", NOW, "")]:
        z = interpolate(now_contours if month_year == NOW else fetch_contours(month_year, refresh))
        grids[month_year] = encode(z)
        mean = window_mean(z)
        if label == "Now":
            now = {"grid": NOW, "mean": mean}
            continue
        flows, est = usgs.flows_for(months, when)
        steps.append({"label": label, "grid": month_year, "mean": mean, "flows": flows, "est": est, "typical": when == "typical"})
        log(f"aquifer: {label}: mean {mean} ft, Fort White {flows['F']} cfs{', est. ' + ','.join(est) if est else ''}")

    aquifer = {
        "meta": {
            "generator": "waterways-pipeline aquifer",
            "generatedAt": date.today().isoformat(),
            "sources": [C.FGS_POTENTIOMETRIC, f"{C.USGS_API}/daily"],
            "encoding": "base64 uint8 per cell, feet = byte / 2; row-major, row 0 = southernmost (lat0)",
            "meanWindow": list(C.AQUIFER_MEAN_WINDOW),
        },
        "grid": C.AQUIFER_GRID,
        "grids": grids,
        "steps": steps,
        "now": now,
    }
    contours = {
        "meta": {"generator": "waterways-pipeline aquifer", "generatedAt": date.today().isoformat(), "sources": [C.FGS_POTENTIOMETRIC], "surface": NOW, "intervalFt": 10},
        "contours": [
            {"v": int(v), "p": [[round(x, 4), round(y, 4)] for x, y in simplify(c, CONTOUR_SIMPLIFY_DEG)]}
            for v, c in now_contours
            if any(C.RIVERS_BBOX[0] - 0.2 <= x <= C.RIVERS_BBOX[2] + 0.2 and C.RIVERS_BBOX[1] - 0.1 <= y <= C.RIVERS_BBOX[3] + 0.1 for x, y in c)
        ],
    }
    return aquifer, contours
