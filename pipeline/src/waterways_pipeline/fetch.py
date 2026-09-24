"""HTTP with retries and an on-disk cache, plus a paging ArcGIS REST query.

Every response is cached under pipeline/cache/ keyed by its URL, so reruns
are fast and offline-friendly. Pass refresh=True to refetch.
"""

from __future__ import annotations

import hashlib
import json
import sys
import time
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


def get_json(url: str, params: dict[str, Any] | None = None, *, refresh: bool = False, cache: bool = True) -> Any:
    full = f"{url}?{urlencode(params)}" if params else url
    path = CACHE / f"{hashlib.sha1(full.encode()).hexdigest()[:16]}.json"
    if cache and path.exists() and not refresh:
        return json.loads(path.read_text(encoding="utf-8"))
    log(f"GET {full[:140]}{'…' if len(full) > 140 else ''}")
    t0 = time.monotonic()
    res = _session.get(full, timeout=180)
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
) -> list[dict]:
    """All GeoJSON features matching a query, following ArcGIS result paging."""
    base = {
        "where": where,
        "outFields": fields,
        "outSR": 4326,
        "f": "geojson",
        "orderByFields": "OBJECTID",
        "resultRecordCount": page_size,
    }
    if bbox:
        base |= {
            "geometry": ",".join(map(str, bbox)),
            "geometryType": "esriGeometryEnvelope",
            "inSR": 4326,
            "spatialRel": "esriSpatialRelIntersects",
        }
    features: list[dict] = []
    while True:
        page = get_json(f"{layer}/query", base | {"resultOffset": len(features)}, refresh=refresh)
        batch = page.get("features", [])
        features.extend(batch)
        more = page.get("exceededTransferLimit") or page.get("properties", {}).get("exceededTransferLimit")
        if not batch or not more:
            return features


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)
