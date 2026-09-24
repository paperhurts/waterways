"""The creek network for the rain map, from NHDPlus HR.

Method:
- Take every NHDPlus HR network flowline touching the study area: the
  Suwannee–Gainesville box plus the Atlantic corridor to Lake George.
- Link each to its downstream neighbor with hydroseq → dnhydroseq.
- `acc` is the total creek length (km) upstream of and including each
  segment, counted inside the map. It sets line width.
- Fate follows NHDPlus routing: a creek reaches the Gulf or the Atlantic if
  its terminal path is the Suwannee's or the St. Johns'. Otherwise it ends
  where NHDPlus ends it. That end is a sink when a mapped sink point (FGS
  swallet, NHD sink/rise, or config/sinks.json) is within SINK_RADIUS_M, and
  "inland" otherwise. Water whose path leaves the map toward some other end
  is "off".
- Where NHD routes a creek into an underground conduit (FType 420), as at
  Rose Sink and Santa Fe River Sink, the water keeps its downstream fate and
  the named swallet is listed in `swallets` so the map can label it.
"""

from __future__ import annotations

import re
from collections import deque
from dataclasses import dataclass
from datetime import date

from . import config as C
from .fetch import arcgis_query, log
from .geo import ORIGIN, SCALE, LonLat, line_coords, meters, pack, simplify

GULF, ATLANTIC, SINK, INLAND, OFF = range(5)
FATES = ["gulf", "atl", "sink", "inland", "off"]

#: Sink survey points are GPS'd at the swallet, which can sit a few hundred meters
#: from where NHD ends the creek. 600 m catches Chronicity Sink and Devil's
#: Millhopper; widening to 800 m adds nothing.
SINK_RADIUS_M = 600
SPRING_DEDUPE_M = 150
SIMPLIFY_DEG = 0.00015

FIELDS = "nhdplusid,gnis_name,ftype,lengthkm,hydroseq,dnhydroseq,terminalpa"


@dataclass
class Flowline:
    hydroseq: int
    dnhydroseq: int
    terminalpa: int
    lengthkm: float
    name: str | None
    ftype: int
    coords: list[LonLat]


@dataclass
class SinkPoint:
    lon: float
    lat: float
    name: str | None


def link(lines: list[Flowline]) -> list[int]:
    """Index of each flowline's downstream neighbor inside the set, or -1."""
    by_seq = {f.hydroseq: i for i, f in enumerate(lines)}
    return [by_seq.get(f.dnhydroseq, -1) for f in lines]


def accumulate(lines: list[Flowline], nxt: list[int]) -> list[float]:
    """Upstream length including each segment, processed headwaters first."""
    acc = [f.lengthkm for f in lines]
    indeg = [0] * len(lines)
    for j in nxt:
        if j >= 0:
            indeg[j] += 1
    queue = deque(i for i, d in enumerate(indeg) if d == 0)
    done = 0
    while queue:
        i = queue.popleft()
        done += 1
        j = nxt[i]
        if j >= 0:
            acc[j] += acc[i]
            indeg[j] -= 1
            if indeg[j] == 0:
                queue.append(j)
    if done != len(lines):
        raise ValueError(f"flow network has a cycle ({len(lines) - done} segments unresolved)")
    return acc


def terminals(nxt: list[int]) -> list[int]:
    """The last in-map segment each segment's water reaches."""
    out = [-1] * len(nxt)
    for start in range(len(nxt)):
        path = []
        i = start
        while out[i] < 0 and nxt[i] >= 0:
            path.append(i)
            i = nxt[i]
        end = out[i] if out[i] >= 0 else i
        out[i] = end
        for p in path:
            out[p] = end
    return out


def classify(lines: list[Flowline], nxt: list[int], sinks: list[SinkPoint]) -> tuple[list[int], list[str | None]]:
    """Fate of every segment, and the name of the sink it ends in (if any)."""
    ends = terminals(nxt)
    fate_of_end: dict[int, tuple[int, str | None]] = {}
    for t in set(ends):
        f = lines[t]
        if f.terminalpa == C.TERMINAL_GULF:
            fate_of_end[t] = (GULF, None)
        elif f.terminalpa == C.TERMINAL_ATLANTIC:
            fate_of_end[t] = (ATLANTIC, None)
        elif f.dnhydroseq != 0:
            fate_of_end[t] = (OFF, None)
        else:
            fate_of_end[t] = nearest_sink(f.coords[-1], sinks)
    fates = [fate_of_end[ends[i]][0] for i in range(len(lines))]
    sink_names = [fate_of_end[ends[i]][1] for i in range(len(lines))]
    return fates, sink_names


def nearest_sink(p: LonLat, sinks: list[SinkPoint]) -> tuple[int, str | None]:
    near = sorted((s for s in sinks if meters(p, (s.lon, s.lat)) <= SINK_RADIUS_M), key=lambda s: meters(p, (s.lon, s.lat)))
    if not near:
        return INLAND, None
    named = [s for s in near if s.name]
    return SINK, named[0].name if named else None


def swallets(lines: list[Flowline], nxt: list[int], sinks: list[SinkPoint]) -> list[list]:
    """Named sinks where a surface creek flows into an underground conduit."""
    out: dict[str, list] = {}
    for i, f in enumerate(lines):
        j = nxt[i]
        if j < 0 or f.ftype == C.FTYPE_UNDERGROUND or lines[j].ftype != C.FTYPE_UNDERGROUND:
            continue
        kind, name = nearest_sink(f.coords[-1], sinks)
        if kind == SINK and name and name not in out:
            lon, lat = f.coords[-1]
            out[name] = [round(lon, 4), round(lat, 4), name]
    return list(out.values())


def area_query(layer: str, refresh: bool, **kw) -> list[dict]:
    """Query every study-area box and drop features seen in an overlap."""
    seen: set = set()
    out: list[dict] = []
    for area in C.STREAMS_AREAS:
        for f in arcgis_query(layer, area, refresh=refresh, **kw):
            key = f["properties"].get("nhdplusid") or tuple(f["geometry"]["coordinates"][:2])
            if key not in seen:
                seen.add(key)
                out.append(f)
    return out


def sink_points(refresh: bool) -> list[SinkPoint]:
    pts = [SinkPoint(s["lon"], s["lat"], s["name"]) for s in C.named_sinks()]
    for f in area_query(C.FGS_SWALLETS, refresh, fields="NAME"):
        lon, lat = f["geometry"]["coordinates"][:2]
        pts.append(SinkPoint(lon, lat, (f["properties"].get("NAME") or "").strip() or None))
    for f in area_query(C.NHD_POINTS, refresh, where=f"ftype={C.FTYPE_SINK_RISE}", fields="nhdplusid,gnis_name"):
        lon, lat = f["geometry"]["coordinates"][:2]
        pts.append(SinkPoint(lon, lat, f["properties"].get("gnis_name")))
    return pts


#: Trailing vent labels in FDEP names: "SILVER SPRING #7", "... MAMMOTH EAST VENT B", "... NATURAL WELL".
VENT_SUFFIX = re.compile(r"\s*(#\s*\d+|\bMAIN\b|\bMAMMOTH\b.*|\bNATURAL WELL\b|\bVENT\b.*)\s*$", re.I)
#: Vents of the same spring sit in one pool or run; merge them within this distance.
VENT_MERGE_M = 600


def spring_base(name: str) -> str:
    prev = None
    while prev != name:
        prev, name = name, VENT_SUFFIX.sub("", name)
    return name.strip()


def magnitude(props: dict) -> int:
    """Best known Meinzer magnitude (1 = over 100 cfs) for this vent, or 0 if unknown.
    GROUP_MAG is ignored: it rates a whole spring group, so it would make every
    small vent along the Silver River look first-magnitude."""
    known = [int(v) for k in ("MAGNITUDE", "HIST_MAG") if str(v := props.get(k) or "").strip().isdigit() and 1 <= int(v) <= 8]
    return min(known, default=0)


#: Where the common name differs from FDEP's per-vent naming.
DISPLAY_NAMES = {"SILVER SPRING": "Silver Springs"}


@dataclass
class SpringGroup:
    base: str
    pts: list[LonLat]
    mag: int
    name: str | None = None

    @property
    def center(self) -> LonLat:
        return (sum(p[0] for p in self.pts) / len(self.pts), sum(p[1] for p in self.pts) / len(self.pts))


def group_vents(vents: list[tuple[float, float, str, int]]) -> list[SpringGroup]:
    """Merge vents that share a base name and sit within VENT_MERGE_M of each other."""
    groups: list[SpringGroup] = []
    for lon, lat, name, mag in vents:
        base = spring_base(name)
        g = next((g for g in groups if g.base == base and meters(g.center, (lon, lat)) <= VENT_MERGE_M), None)
        if g:
            g.pts.append((lon, lat))
            g.mag = min((m for m in (g.mag, mag) if m), default=0)
        else:
            groups.append(SpringGroup(base, [(lon, lat)], mag))
    return groups


def springs(refresh: bool) -> list[list]:
    """[lon, lat, name, magnitude] per spring: FDEP springs with multi-vent springs merged,
    named by GNIS where NHD has an official name for a merged group, plus any NHD
    spring points FDEP doesn't have."""
    vents = []
    for f in area_query(C.FDEP_SPRINGS, refresh, fields="SPRING_NAME,MAGNITUDE,HIST_MAG,GROUP_MAG"):
        lon, lat = f["geometry"]["coordinates"][:2]
        vents.append((lon, lat, (f["properties"].get("SPRING_NAME") or "SPRING").strip() or "SPRING", magnitude(f["properties"])))
    groups = group_vents(vents)
    extra: list[list] = []
    for f in area_query(C.NHD_POINTS, refresh, where=f"ftype={C.FTYPE_SPRING}", fields="nhdplusid,gnis_name"):
        p = tuple(f["geometry"]["coordinates"][:2])
        gnis = f["properties"].get("gnis_name")
        near = min(groups, key=lambda g: meters(g.center, p), default=None)
        d = meters(near.center, p) if near else float("inf")
        if near and gnis and len(near.pts) > 1 and d <= VENT_MERGE_M:
            near.name = gnis
        elif d > SPRING_DEDUPE_M:
            extra.append([round(p[0], 4), round(p[1], 4), gnis or "Spring", 0])
    out = [[round(g.center[0], 4), round(g.center[1], 4), g.name or DISPLAY_NAMES.get(g.base) or tidy_name(g.base) or "Spring", g.mag] for g in groups]
    return out + extra


def tidy_name(s: str | None) -> str | None:
    """FDEP names are upper case with stray spaces: 'POE SPRING (ALACHUA) ' → 'Poe Spring (Alachua)'.
    Station codes like GIL1012973 stay upper case."""
    if not s or not s.strip():
        return None
    t = " ".join(s.split()).lower()
    t = re.sub(r"(^|[\s(/-])([a-z])", lambda m: m[1] + m[2].upper(), t)
    return re.sub(r"\b[a-z]+\d\w*", lambda m: m[0].upper(), t, flags=re.I)


def fetch_flowlines(refresh: bool) -> list[Flowline]:
    lines: list[Flowline] = []
    for f in area_query(C.NHD_FLOWLINES, refresh, fields=FIELDS):
        p = f["properties"]
        if not f.get("geometry"):
            continue
        lines.append(
            Flowline(
                hydroseq=int(p["hydroseq"]),
                dnhydroseq=int(p["dnhydroseq"] or 0),
                terminalpa=int(p["terminalpa"]),
                lengthkm=float(p["lengthkm"] or 0),
                name=p.get("gnis_name") or None,
                ftype=int(p["ftype"]),
                coords=line_coords(f["geometry"]),
            )
        )
    return lines


def build(refresh: bool = False) -> dict:
    lines = fetch_flowlines(refresh)
    log(f"streams: {len(lines)} flowlines")
    nxt = link(lines)
    acc = accumulate(lines, nxt)
    sinks = sink_points(refresh)
    fates, sink_names = classify(lines, nxt, sinks)

    names: list[str] = []
    index: dict[str, int] = {}

    def name_id(n: str | None) -> int:
        if not n:
            return -1
        if n not in index:
            index[n] = len(names)
            names.append(n)
        return index[n]

    segs = [
        [
            pack(simplify(f.coords, SIMPLIFY_DEG)),
            fates[i],
            nxt[i],
            round(acc[i], 1),
            name_id(f.name),
            name_id(sink_names[i]),
            int(f.ftype == C.FTYPE_UNDERGROUND),
            int(f.ftype == C.FTYPE_ARTIFICIAL),
        ]
        for i, f in enumerate(lines)
    ]
    counts = {FATES[k]: fates.count(k) for k in range(5)}
    log(f"streams: fates {counts}")
    return {
        "meta": {
            "generator": "waterways-pipeline streams",
            "generatedAt": date.today().isoformat(),
            "sources": [C.NHD_FLOWLINES, C.NHD_POINTS, C.FGS_SWALLETS, C.FDEP_SPRINGS, "config/sinks.json"],
            "coordOrigin": list(ORIGIN),
            "coordScale": SCALE,
            "segFields": ["coords", "fate", "next", "acc", "name", "sink", "underground", "artificial"],
            "fates": FATES,
            "areas": [list(a) for a in C.STREAMS_AREAS],
        },
        "names": names,
        "segs": segs,
        "springs": springs(refresh),
        "swallets": swallets(lines, nxt, sinks),
    }
