"""The creek network for the rain map, from NHDPlus HR.

Method:
- Take every NHDPlus HR network flowline touching the study area: boxes
  covering the springs belt from the middle Suwannee to Rainbow River, the
  Ocklawaha, and the Atlantic corridor to Lake George (C.STREAMS_AREAS).
  NHD's coastline flowlines are part of its network but aren't creeks; they
  only mark where coastal rivers empty into the sea.
- Link each to its downstream neighbor with hydroseq → dnhydroseq.
- `acc` is the total creek length (km) upstream of and including each
  segment, counted inside the map. It sets line width.
- Fate follows NHDPlus routing: a creek reaches the Gulf or the Atlantic if
  its terminal path is the Suwannee's or the St. Johns'. Otherwise it ends
  where NHDPlus ends it. That end is a sink when a mapped sink point (FGS
  swallet, NHD sink/rise, or config/sinks.json) is within SINK_RADIUS_M; the
  sea when it drains into NHD's coastline (the Withlacoochee, Crystal River,
  and Waccasassa reach the Gulf on their own) or ends right at the Census
  coast; and "inland" otherwise. Water whose path leaves the map takes the
  fate of that path's end if it's on the coast, and is "off" otherwise.
- Where NHD routes a creek into an underground conduit (FType 420), as at
  Rose Sink and Santa Fe River Sink, the water keeps its downstream fate and
  the named swallet is listed in `swallets` so the map can label it.
- Below the study area, the Suwannee and the St. Johns are followed down
  their main stems to the sea. Those flowlines are marked `route`: they carry
  the map's water out, but rain doesn't fall on them and they don't count
  toward fate shares. `mouths` lists the segments that end at the sea.
"""

from __future__ import annotations

from collections import deque
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date

from . import coast as coast_mod
from . import config as C
from . import nhd
from . import springs as springs_mod
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
    #: Past the study area, on a main stem's way to the sea.
    route: bool = False


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


def no_sea(p: LonLat) -> int | None:
    return None


def sea_side(p: LonLat) -> int:
    return GULF if p[0] < coast_mod.PENINSULA_SPINE else ATLANTIC


def classify(
    lines: list[Flowline],
    nxt: list[int],
    sinks: list[SinkPoint],
    sea_at: Callable[[LonLat], int | None] = no_sea,
    leaves_to_sea: dict[int, int] | None = None,
    shore: set[int] | None = None,
) -> tuple[list[int], list[str | None]]:
    """Fate of every segment, and the name of the sink it ends in (if any).

    `shore` holds the hydroseqs of NHD's coastline flowlines: a creek draining into one
    empties into the sea. `sea_at(p)` is the fallback for a creek NHD leaves unlinked:
    GULF or ATLANTIC if it ends on that coast at p, else None. `leaves_to_sea` gives the
    fate of terminal paths that run off the map to the sea."""
    ends = terminals(nxt)
    fate_of_end: dict[int, tuple[int, str | None]] = {}
    for t in set(ends):
        f = lines[t]
        if f.terminalpa == C.TERMINAL_GULF:
            fate_of_end[t] = (GULF, None)
        elif f.terminalpa == C.TERMINAL_ATLANTIC:
            fate_of_end[t] = (ATLANTIC, None)
        elif shore and f.dnhydroseq in shore:
            fate_of_end[t] = (sea_side(f.coords[-1]), None)
        elif f.dnhydroseq != 0 and f.hydroseq != f.terminalpa:
            # The water flows on past the map's edge.
            fate_of_end[t] = ((leaves_to_sea or {}).get(f.terminalpa, OFF), None)
        else:
            # The network ends here: in a sink, at the coast, or inland.
            kind, name = nearest_sink(f.coords[-1], sinks)
            sea = sea_at(f.coords[-1]) if kind == INLAND else None
            fate_of_end[t] = (sea, None) if sea is not None else (kind, name)
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
        for f in nhd.query(layer, area, refresh=refresh, **kw):
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


def map_springs(refresh: bool) -> list[list]:
    """[lon, lat, name, magnitude, id] for every FDEP spring in the study area (ids match
    springs.json, so the journal can link them), plus NHD spring points FDEP lacks (no id)."""
    inside = [s for s in springs_mod.fetch(refresh) if springs_mod.in_areas((s.lon, s.lat), C.STREAMS_AREAS)]
    out: list[list] = [[round(s.lon, 4), round(s.lat, 4), s.name, s.mag, s.id] for s in inside]
    for f in area_query(C.NHD_POINTS, refresh, where=f"ftype={C.FTYPE_SPRING}", fields="nhdplusid,gnis_name"):
        p = tuple(f["geometry"]["coordinates"][:2])
        if all(meters(p, (s.lon, s.lat)) > SPRING_DEDUPE_M for s in inside):
            out.append([round(p[0], 4), round(p[1], 4), f["properties"].get("gnis_name") or "Spring", 0, ""])
    return out


def to_flowline(f: dict) -> Flowline:
    p = f["properties"]
    return Flowline(
        hydroseq=int(p["hydroseq"]),
        dnhydroseq=int(p["dnhydroseq"] or 0),
        terminalpa=int(p["terminalpa"]),
        lengthkm=float(p["lengthkm"] or 0),
        name=p.get("gnis_name") or None,
        ftype=int(p["ftype"]),
        coords=line_coords(f["geometry"]),
    )


def fetch_flowlines(refresh: bool) -> tuple[list[Flowline], set[int]]:
    """The study area's creeks, and the hydroseqs of its coastline. NHD threads the
    coastline into the flow network, so coastal rivers drain into it, but it isn't a creek."""
    feats = [f for f in area_query(C.NHD_FLOWLINES, refresh, fields=FIELDS) if f.get("geometry")]
    shore = {int(f["properties"]["hydroseq"]) for f in feats if int(f["properties"]["ftype"]) == C.FTYPE_COASTLINE}
    return [to_flowline(f) for f in feats if int(f["properties"]["ftype"]) != C.FTYPE_COASTLINE], shore


def route_to_sea(mainstem: list[Flowline], mapped: set[int]) -> list[Flowline]:
    """The part of a main stem below the study area: every flowline downstream of the
    lowest one already on the map (hydroseq falls going downstream). Empty if the
    map doesn't reach this river at all."""
    on_map = [f.hydroseq for f in mainstem if f.hydroseq in mapped]
    if not on_map:
        return []
    lowest = min(on_map)
    return [f for f in mainstem if f.hydroseq < lowest]


def fetch_routes(lines: list[Flowline], refresh: bool) -> list[Flowline]:
    mapped = {f.hydroseq for f in lines}
    out: list[Flowline] = []
    for terminal in (C.TERMINAL_GULF, C.TERMINAL_ATLANTIC):
        mainstem = [to_flowline(f) for f in arcgis_query(C.NHD_FLOWLINES, where=f"levelpathi={terminal}", fields=FIELDS, refresh=refresh) if f.get("geometry")]
        route = route_to_sea(mainstem, mapped)
        for f in route:
            f.route = True
        if route:
            name = next((f.name for f in route if f.name), str(terminal))
            log(f"streams: {len(route)} flowlines, {sum(f.lengthkm for f in route):.0f} km, from the map to the sea along the {name}")
        out += route
    return out


def leaving_to_sea(lines: list[Flowline], nxt: list[int], sea_at: Callable[[LonLat], int | None], refresh: bool) -> dict[int, int]:
    """Terminal paths whose water runs off the map and ends at the sea, with that sea's fate.
    Each path's last flowline has the path's id as its hydroseq; look up where it ends."""
    leaving = {f.terminalpa for i, f in enumerate(lines) if nxt[i] < 0 and f.dnhydroseq != 0 and f.hydroseq != f.terminalpa}
    ids = sorted(leaving - {C.TERMINAL_GULF, C.TERMINAL_ATLANTIC})
    out: dict[int, int] = {}
    for k in range(0, len(ids), 150):
        where = f"hydroseq IN ({','.join(map(str, ids[k : k + 150]))})"
        for f in arcgis_query(C.NHD_FLOWLINES, where=where, fields="hydroseq", refresh=refresh):
            if f.get("geometry") and (sea := sea_at(line_coords(f["geometry"])[-1])) is not None:
                out[int(f["properties"]["hydroseq"])] = sea
    return out


def mouths(lines: list[Flowline], fates: list[int]) -> list[int]:
    """Segments whose water enters the sea: the last flowline of the Gulf or Atlantic
    terminal path (its hydroseq is the path's id)."""
    return [i for i, f in enumerate(lines) if f.hydroseq == f.terminalpa and fates[i] in (GULF, ATLANTIC)]


def build(refresh: bool = False) -> dict:
    lines, shore = fetch_flowlines(refresh)
    log(f"streams: {len(lines)} flowlines, {len(shore)} more on the coastline")
    lines += fetch_routes(lines, refresh)
    nxt = link(lines)
    acc = accumulate(lines, nxt)
    sinks = sink_points(refresh)
    coast = coast_mod.Coast(coast_mod.sea(refresh))
    sides = {"gulf": GULF, "atl": ATLANTIC}

    def sea_at(p: LonLat) -> int | None:
        side = coast.sea_at(p)
        return sides[side] if side else None

    fates, sink_names = classify(lines, nxt, sinks, sea_at, leaving_to_sea(lines, nxt, sea_at, refresh), shore)

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
            int(f.route),
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
            "segFields": ["coords", "fate", "next", "acc", "name", "sink", "underground", "artificial", "route"],
            "springFields": ["lon", "lat", "name", "magnitude", "id"],
            "fates": FATES,
            "areas": [list(a) for a in C.STREAMS_AREAS],
        },
        "names": names,
        "segs": segs,
        "springs": map_springs(refresh),
        "swallets": swallets(lines, nxt, sinks),
        "mouths": mouths(lines, fates),
    }
