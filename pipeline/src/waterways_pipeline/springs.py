"""Florida springs from the FDEP Florida Springs layer.

FDEP lists vents separately ("SILVER SPRING #1" … "#12", "RAINBOW SPRING #3"),
so vents that share a base name within VENT_MERGE_M merge into one spring.
Every spring gets a stable id from its FDEP base name and county; the journal
stores visits against that id, so ids must not depend on display names.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date

from . import config as C
from .fetch import arcgis_query
from .geo import LonLat, meters

#: Trailing vent labels: "#7", "MAIN", "MAMMOTH EAST VENT B", "NATURAL WELL".
VENT_SUFFIX = re.compile(r"\s*(#\s*\d+|\bMAIN\b|\bMAMMOTH\b.*|\bNATURAL WELL\b|\bVENT\b.*)\s*$", re.I)
#: Vents of one spring sit in one pool or run; merge them within this distance.
VENT_MERGE_M = 600
#: Where the common name differs from anything in FDEP's naming.
DISPLAY_NAMES = {"SILVER SPRING": "Silver Springs"}

FIELDS = "SPRING_NAME,COUNTY,MAGNITUDE,HIST_MAG"


def spring_base(name: str) -> str:
    prev = None
    name = " ".join(name.split())
    while prev != name:
        prev, name = name, VENT_SUFFIX.sub("", name)
    return name.strip()


def group_key(base: str) -> str:
    """'RAINBOW SPRINGS' and 'RAINBOW SPRING #3' are the same spring."""
    return re.sub(r"\bSPRINGS\b", "SPRING", base.upper())


def magnitude(props: dict) -> int:
    """Best known Meinzer magnitude (1 = over 100 cfs) for this vent, or 0 if unknown.
    GROUP_MAG is ignored: it rates a whole spring group, so it would make every
    small vent along the Silver River look first-magnitude."""
    known = [int(v) for k in ("MAGNITUDE", "HIST_MAG") if str(v := props.get(k) or "").strip().isdigit() and 1 <= int(v) <= 8]
    return min(known, default=0)


def tidy_name(s: str | None) -> str | None:
    """FDEP names are upper case: 'POE SPRING (ALACHUA)' → 'Poe Spring (Alachua)'.
    Station codes like GIL1012973 stay upper case."""
    if not s or not s.strip():
        return None
    t = " ".join(s.split()).lower()
    t = re.sub(r"(^|[\s(/-])([a-z])", lambda m: m[1] + m[2].upper(), t)
    return re.sub(r"\b[a-z]+\d\w*", lambda m: m[0].upper(), t, flags=re.I)


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


@dataclass
class Vent:
    lon: float
    lat: float
    name: str
    mag: int = 0
    county: str = ""


@dataclass
class Spring:
    key: str
    county: str
    vents: list[Vent] = field(default_factory=list)
    id: str = ""

    @property
    def lon(self) -> float:
        return sum(v.lon for v in self.vents) / len(self.vents)

    @property
    def lat(self) -> float:
        return sum(v.lat for v in self.vents) / len(self.vents)

    @property
    def mag(self) -> int:
        return min((v.mag for v in self.vents if v.mag), default=0)

    @property
    def name(self) -> str:
        if self.key in DISPLAY_NAMES:
            return DISPLAY_NAMES[self.key]
        bases = [spring_base(v.name) for v in self.vents]
        # Prefer the plural a vent list is usually published under ("Rainbow Springs").
        best = next((b for b in bases if re.search(r"\bSPRINGS\b", b, re.I)), bases[0])
        return tidy_name(best) or "Spring"


def group_vents(vents: list[Vent]) -> list[Spring]:
    """Merge vents that share a base name and sit within VENT_MERGE_M of each other."""
    springs: list[Spring] = []
    for v in vents:
        key = group_key(spring_base(v.name))
        s = next((s for s in springs if s.key == key and meters((s.lon, s.lat), (v.lon, v.lat)) <= VENT_MERGE_M), None)
        if s:
            s.vents.append(v)
        else:
            springs.append(Spring(key, v.county, [v]))
    return springs


def assign_ids(springs: list[Spring]) -> None:
    """name--county, with a ~1 km grid suffix only where that collides
    (FDEP reuses generic names like "COLUMBIA SPRING" across a county)."""
    base = {id(s): f"{slug(s.key)}--{slug(s.county or 'fl')}" for s in springs}
    counts: dict[str, int] = {}
    for b in base.values():
        counts[b] = counts.get(b, 0) + 1
    for s in springs:
        b = base[id(s)]
        s.id = b if counts[b] == 1 else f"{b}-{round(abs(s.lat) * 100)}-{round(abs(s.lon) * 100)}"
    seen: dict[str, int] = {}
    for s in sorted(springs, key=lambda s: (s.id, s.lat, s.lon)):
        n = seen.get(s.id, 0)
        seen[s.id] = n + 1
        if n:
            s.id = f"{s.id}-{n + 1}"


def fetch(refresh: bool = False) -> list[Spring]:
    """Every spring in Florida, grouped and with ids."""
    vents = []
    for f in arcgis_query(C.FDEP_SPRINGS, None, fields=FIELDS, refresh=refresh):
        if not f.get("geometry"):
            continue
        p = f["properties"]
        lon, lat = f["geometry"]["coordinates"][:2]
        vents.append(Vent(lon, lat, (p.get("SPRING_NAME") or "SPRING").strip() or "SPRING", magnitude(p), (p.get("COUNTY") or "").strip().title()))
    springs = group_vents(vents)
    assign_ids(springs)
    return sorted(springs, key=lambda s: s.id)


def in_areas(p: LonLat, areas: list[C.Bbox]) -> bool:
    return any(a[0] <= p[0] <= a[2] and a[1] <= p[1] <= a[3] for a in areas)


def build(refresh: bool = False) -> dict:
    """springs.json: the journal's statewide list."""
    springs = fetch(refresh)
    return {
        "meta": {
            "generator": "waterways-pipeline springs",
            "generatedAt": date.today().isoformat(),
            "sources": [C.FDEP_SPRINGS],
            "fields": ["id", "name", "county", "lon", "lat", "magnitude", "onRainMap"],
        },
        "springs": [[s.id, s.name, s.county, round(s.lon, 5), round(s.lat, 5), s.mag, int(in_areas((s.lon, s.lat), C.STREAMS_AREAS))] for s in springs],
    }
