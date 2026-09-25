"""HTTP with retries and an on-disk cache, plus a paging ArcGIS REST query.

Every response is cached under pipeline/cache/ keyed by its URL, so reruns
are fast and offline-friendly. Pass refresh=True to refetch.
"""

from __future__ import annotations

import hashlib
import json
import sys
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from .config import CACHE, Bbox

_session = requests.Session()
_session.headers["User-Agent"] = "waterways-pipeline (+https://github.com/paperhurts/waterways)"
_session.mount(
    "https://",
    HTTPAdapter(max_retries=Retry(total=4, backoff_factor=2, status_forcelist=[429, 500, 502, 503, 504])),
)


def cache_path(url: str, params: dict[str, Any] | None = None) -> Path:
    full = f"{url}?{urlencode(params)}" if params else url
    return CACHE / f"{hashlib.sha1(full.encode()).hexdigest()[:16]}.json"


def get_json(url: str, params: dict[str, Any] | None = None, *, refresh: bool = False, cache: bool = True) -> Any:
    full = f"{url}?{urlencode(params)}" if params else url
    path = cache_path(url, params)
    if cache and path.exists() and not refresh:
        return json.loads(path.read_text(encoding="utf-8"))
    log(f"GET {full[:140]}{'…' if len(full) > 140 else ''}")
    t0 = time.monotonic()
    # NHD's server can think for several minutes before it sends a big page back.
    res = _session.get(full, timeout=(30, 600))
    res.raise_for_status()
    body = res.json()
    if isinstance(body, dict) and "error" in body:
        raise RuntimeError(f"{url}: {body['error']}")
    log(f"  {len(res.content) / 1e6:.1f} MB in {time.monotonic() - t0:.0f}s")
    if cache:
        CACHE.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(body), encoding="utf-8")
    return body


def arcgis_query(
    layer: str,
    bbox: Bbox | None = None,
    *,
    where: str = "1=1",
    fields: str = "*",
    page_size: int = 2000,
    refresh: bool = False,
    generalize: float | None = None,
) -> list[dict]:
    """All GeoJSON features matching a query, following ArcGIS result paging.
    `generalize` (degrees) has the server simplify geometry first, which keeps big
    polygons like the Everglades' marshes from timing out."""
    base = {
        "where": where,
        "outFields": fields,
        "outSR": 4326,
        "f": "geojson",
        "orderByFields": "OBJECTID",
        "resultRecordCount": page_size,
    }
    if generalize:
        base["maxAllowableOffset"] = generalize
    if bbox:
        base |= {
            "geometry": ",".join(map(str, bbox)),
            "geometryType": "esriGeometryEnvelope",
            "inSR": 4326,
            "spatialRel": "esriSpatialRelIntersects",
        }
    features: list[dict] = []
    while True:
        params = base | {"resultOffset": len(features)}
        try:
            page = get_json(f"{layer}/query", params, refresh=refresh)
        except requests.RequestException as err:
            if features:
                raise
            # Some boxes time out however they're paged. Fetching the same features by
            # object id, a few at a time, gets through; save them as this page's answer.
            log(f"  {err.__class__.__name__}; fetching by object id instead")
            page = {"type": "FeatureCollection", "features": by_object_ids(layer, base, refresh)}
            cache_path(f"{layer}/query", params).write_text(json.dumps(page), encoding="utf-8")
        batch = page.get("features", [])
        features.extend(batch)
        more = page.get("exceededTransferLimit") or page.get("properties", {}).get("exceededTransferLimit")
        if not batch or not more:
            return features


#: Features per request when fetching by object id.
ID_CHUNK = 50


def by_object_ids(layer: str, query: dict[str, Any], refresh: bool = False) -> list[dict]:
    """Every feature a query matches, fetched by object id in small chunks."""
    ids_query = {k: v for k, v in query.items() if k not in ("outFields", "orderByFields", "resultRecordCount", "maxAllowableOffset")}
    ids = sorted(get_json(f"{layer}/query", ids_query | {"f": "json", "returnIdsOnly": "true"}, refresh=refresh).get("objectIds") or [])
    out: list[dict] = []
    for k in range(0, len(ids), ID_CHUNK):
        chunk = {"objectIds": ",".join(map(str, ids[k : k + ID_CHUNK])), "outFields": query["outFields"], "outSR": 4326, "f": "geojson"}
        if "maxAllowableOffset" in query:
            chunk["maxAllowableOffset"] = query["maxAllowableOffset"]
        out.extend(get_json(f"{layer}/query", chunk, refresh=refresh).get("features", []))
    return out


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)
