"""NHDPlus HR features, from USGS's map server or from its bulk files.

The map server (hydro.nationalmap.gov) answers ArcGIS queries, but it times out on big
ones. USGS also publishes the same release as one file geodatabase per 4-digit HUC, and
the boxes in C.BULK_AREAS are read from those. Features come back in the map server's
GeoJSON shape (lowercase field names, flowlines with their network attributes joined
on), so the builders don't care which source a box came from.
"""

from __future__ import annotations

import zipfile
from functools import cache
from pathlib import Path

import shapely
from shapely.geometry import box, mapping

from . import config as C
from .fetch import arcgis_query, download, log

#: Map server layer → the bulk file's layer.
LAYERS = {C.NHD_FLOWLINES: "NHDFlowline", C.NHD_WATERBODIES: "NHDWaterbody", C.NHD_AREAS: "NHDArea", C.NHD_POINTS: "NHDPoint"}
#: The flow network attributes the map server joins onto each flowline (from NHDPlusFlowlineVAA).
VAA = ("hydroseq", "dnhydroseq", "terminalpa", "levelpathi", "streamorde")
BULK_DIR = C.CACHE / "nhdplus_hr"


def query(layer: str, area: C.Bbox, *, where: str = "1=1", fields: str = "*", refresh: bool = False, generalize: float | None = None) -> list[dict]:
    """Features in one box, like arcgis_query, read from the bulk files if the box is in
    C.BULK_AREAS. Flowlines are the network flowlines only, as on the map server.
    `generalize` only matters to the map server: the bulk files are read locally, in full."""
    hu4s = C.BULK_AREAS.get(area)
    if hu4s is None or layer not in LAYERS:
        return arcgis_query(layer, area, where=where, fields=fields, refresh=refresh, generalize=generalize)
    seen: set[int] = set()
    out: list[dict] = []
    for hu4 in hu4s:
        for f in bulk(LAYERS[layer], hu4, area, where, fields, refresh):
            if (key := f["properties"]["nhdplusid"]) not in seen:
                seen.add(key)
                out.append(f)
    return out


def gdb(hu4: str, refresh: bool = False) -> Path:
    """The unpacked file geodatabase for a 4-digit HUC, downloading it the first time."""
    name = f"NHDPLUS_H_{hu4}_HU4_GDB"
    path = BULK_DIR / hu4 / f"{name}.gdb"
    if path.exists() and not refresh:
        return path
    zipped = BULK_DIR / f"{name}.zip"
    download(C.NHD_BULK.format(hu4=hu4), zipped)
    log(f"  unpacking {zipped.name}")
    with zipfile.ZipFile(zipped) as z:
        z.extractall(BULK_DIR / hu4)
    zipped.unlink()
    return path


def whole(v) -> int | None:
    """An integer attribute, or None where the file leaves it blank (NaN), as the map server does."""
    return None if v is None or v != v else int(v)


@cache
def network(hu4: str) -> dict[int, tuple[int | None, ...]]:
    """nhdplusid → the VAA fields, for every flowline in the flow network."""
    import pyogrio.raw

    meta, _, _, data = pyogrio.raw.read(gdb(hu4), layer="NHDPlusFlowlineVAA", read_geometry=False)
    cols = {k.lower(): v for k, v in zip(meta["fields"], data)}
    return {int(i): tuple(whole(cols[k][n]) for k in VAA) for n, i in enumerate(cols["nhdplusid"])}


def table(hu4: str, layer: str, columns: list[str], *, where: str | None = None, bbox: C.Bbox | None = None, geometry: bool = False):
    """A bulk file layer's columns (keyed lowercase) and, with `geometry`, its 2D shapes.
    `where` can only use fields that are in `columns`."""
    import pyogrio.raw

    meta, _, geoms, data = pyogrio.raw.read(gdb(hu4), layer=layer, columns=columns, where=where, bbox=bbox, read_geometry=geometry)
    cols = {k.lower(): v for k, v in zip(meta["fields"], data)}
    return cols, (shapely.force_2d(shapely.from_wkb(geoms)) if geometry else None)


def named(layer: str, hu4: str, name: str, refresh: bool = False) -> list:
    """The 2D geometry of every feature in a bulk file's layer with this GNIS name."""
    import pyogrio.raw

    quoted = name.replace("'", "''")
    _, _, geoms, _ = pyogrio.raw.read(gdb(hu4, refresh), layer=layer, where=f"GNIS_Name = '{quoted}'")
    return [shapely.force_2d(g) for g in shapely.from_wkb(geoms) if g is not None]


def bulk(layer: str, hu4: str, area: C.Bbox, where: str, fields: str, refresh: bool = False) -> list[dict]:
    import pyogrio.raw

    path = gdb(hu4, refresh)
    meta, _, geoms, data = pyogrio.raw.read(path, layer=layer, bbox=area, where=None if where == "1=1" else where)
    return to_features(meta["fields"], data, shapely.from_wkb(geoms), area, fields, network(hu4) if layer == "NHDFlowline" else None)


def to_features(names, data, geoms, area: C.Bbox, fields: str, vaa: dict[int, tuple[int | None, ...]] | None) -> list[dict]:
    """GeoJSON-like features with the requested fields, lowercase as the map server names
    them. The bulk read's box filter is by envelope, so keep only what touches the box.
    With `vaa`, only network flowlines, with their network attributes."""
    cols = {k.lower(): v for k, v in zip(names, data)}
    want = list(cols) + list(VAA) if fields == "*" else [f.strip().lower() for f in fields.split(",")]
    clip = box(*area)
    out = []
    for n, g in enumerate(geoms):
        raw = cols["nhdplusid"][n]
        if raw is None or g is None or not g.intersects(clip):
            continue
        nid = int(raw)
        if vaa is not None and nid not in vaa:
            continue
        props = {}
        for k in want:
            if vaa is not None and k in VAA:
                props[k] = vaa[nid][VAA.index(k)]
            elif k in cols:
                v = cols[k][n]
                props[k] = int(v) if k == "nhdplusid" else v.item() if hasattr(v, "item") else v
        out.append({"type": "Feature", "geometry": mapping(shapely.force_2d(g)), "properties": props})
    return out
