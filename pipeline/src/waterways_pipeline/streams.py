"""The creek network for the rain map, from NHDPlus HR.

Method:
- Take every NHDPlus HR network flowline touching the study area.
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


def sink_points(refresh: bool) -> list[SinkPoint]:
    pts = [SinkPoint(s["lon"], s["lat"], s["name"]) for s in C.named_sinks()]
    for f in arcgis_query(C.FGS_SWALLETS, C.STREAMS_BBOX, fields="NAME", refresh=refresh):
        lon, lat = f["geometry"]["coordinates"][:2]
        pts.append(SinkPoint(lon, lat, (f["properties"].get("NAME") or "").strip() or None))
    for f in arcgis_query(C.NHD_POINTS, C.STREAMS_BBOX, where=f"ftype={C.FTYPE_SINK_RISE}", fields="gnis_name", refresh=refresh):
        lon, lat = f["geometry"]["coordinates"][:2]
        pts.append(SinkPoint(lon, lat, f["properties"].get("gnis_name")))
    return pts


def springs(refresh: bool) -> list[tuple[float, float, str]]:
    """FDEP springs plus NHD spring points, deduplicated by distance."""
    out: list[tuple[float, float, str]] = []
    for f in arcgis_query(C.FDEP_SPRINGS, C.STREAMS_BBOX, fields="SPRING_NAME", refresh=refresh):
        lon, lat = f["geometry"]["coordinates"][:2]
        out.append((round(lon, 4), round(lat, 4), tidy_name(f["properties"].get("SPRING_NAME")) or "Spring"))
    for f in arcgis_query(C.NHD_POINTS, C.STREAMS_BBOX, where=f"ftype={C.FTYPE_SPRING}", fields="gnis_name", refresh=refresh):
        lon, lat = f["geometry"]["coordinates"][:2]
        if all(meters((lon, lat), (s[0], s[1])) > SPRING_DEDUPE_M for s in out):
            out.append((round(lon, 4), round(lat, 4), f["properties"].get("gnis_name") or "Spring"))
    return out


def tidy_name(s: str | None) -> str | None:
    """FDEP names are upper case with stray spaces: 'POE SPRING (ALACHUA) ' → 'Poe Spring (Alachua)'.
    Station codes like GIL1012973 stay upper case."""
    if not s or not s.strip():
        return None
    t = " ".join(s.split()).lower()
    t = re.sub(r"(^|[\s(/-])([a-z])", lambda m: m[1] + m[2].upper(), t)
    return re.sub(r"\b[a-z]+\d\w*", lambda m: m[0].upper(), t, flags=re.I)


def fetch_flowlines(refresh: bool) -> list[Flowline]:
    feats = arcgis_query(C.NHD_FLOWLINES, C.STREAMS_BBOX, fields=FIELDS, refresh=refresh)
    seen: set[int] = set()
    lines: list[Flowline] = []
    for f in feats:
        p = f["properties"]
        if p["nhdplusid"] in seen or not f.get("geometry"):
            continue
        seen.add(p["nhdplusid"])
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
        },
        "names": names,
        "segs": segs,
        "springs": [list(s) for s in springs(refresh)],
        "swallets": swallets(lines, nxt, sinks),
    }
