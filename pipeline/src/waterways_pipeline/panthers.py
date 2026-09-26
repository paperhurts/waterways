"""Data for the panther map (panthers.json), and this year's deaths for snapshot.json.

- Cats: FWC's radio telemetry of Florida panthers since 1981, the aerial fixes of every
  collared cat, including the eight Texas pumas released in 1995 (ids TX101-TX108). One
  position a month per cat (the month's middle fix), rounded to PRIVACY_DEG, with the
  newest RECENT_YEARS years left off so no living cat's current range is pinned.
- Deaths: FWC's panther mortality records since 1972: month, cause, sex, age, county, and
  the place rounded to DEATH_DEG. The records' location notes are left out: some name
  private landowners and describe driveways.
- Zones: the USFWS MERIT panther subteam's habitat zones and the focus area north of the
  Caloosahatchee, via FDEP; zone names and geometry only.
- Roads: Census TIGER's primary and secondary roads.
- River: the Caloosahatchee from Lake Okeechobee to the Gulf, the Lake Okeechobee map's paths.
- Water: the sea (the rain map's salt water, less Cuba, the Bahamas, and Mexico), lakes, and wetlands.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta, timezone

import shapely
from shapely.geometry import box, shape
from shapely.ops import unary_union
from shapely.validation import make_valid

from . import config as C
from . import lakeo, nhd, rain
from .fetch import arcgis_query, log
from .geo import ORIGIN, SCALE, pack
from .rivers import KM2_PER_DEG2, drop_specks, main_stems, polygon_rings

HU4S = ("0309", "0310")
#: Collar fixes are rounded to this (degrees, ~500 m), and deaths to DEATH_DEG (~1 km).
PRIVACY_DEG = 0.005
DEATH_DEG = 0.01
#: Collar fixes this recent (years before the newest fix) are left off.
RECENT_YEARS = 2
#: Deaths before this year are left off: one skull from 1949, dated roughly.
FIRST_DEATH_YEAR = 1972
LAKE_KM2, SWAMP_KM2 = 2.0, 10.0
LAKE_TOL, SWAMP_TOL, SEA_TOL, FAR_SEA_TOL = 0.001, 0.004, 0.003, 0.04
ZONE_TOL, ROAD_TOL, RIVER_TOL = 0.002, 0.002, 0.0003
#: Road pieces shorter than this (degrees) are left off: town streets, mostly.
ROAD_MIN_DEG = 0.03
ZONES = {"PRIMARY": "primary", "SECONDARY": "secondary", "DISPERSAL": "dispersal", "NORTH AREA": "north"}
#: FWC's causes of death, grouped for the chart and the map. Anything else is "other".
CAUSES = {
    "Vehicular trauma": "vehicle",
    "Intraspecific aggression": "fight",
    "Illegal kill": "illegal",
    "Infectious disease - Pseudorabies": "disease",
    "Infectious disease - FeLV": "disease",
    "Infectious disease - Other": "disease",
    "Degenerative diseases": "disease",
}
AGE_UNITS = {"years": 1.0, "months": 12.0, "days": 365.25}


EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


def utc(ms: int) -> datetime:
    # Not datetime.fromtimestamp: on Windows it rejects times before 1970.
    return EPOCH + timedelta(milliseconds=ms)


def rounded(v: float, step: float) -> float:
    return round(round(v / step) * step, 6)


def pack_points(pts: list[tuple[float, float]]) -> list[int]:
    """Like geo.pack, but keeping repeated points: each lines up with its month."""
    return [v for lon, lat in pts for v in (round((lon - ORIGIN[0]) * SCALE), round((lat - ORIGIN[1]) * SCALE))]


def cause_group(cause: str) -> str:
    return CAUSES.get((cause or "").strip(), "other")


def age_years(age: str, units: str) -> float | None:
    """FWC's age, which comes in years, months, or days, in years (one decimal)."""
    try:
        v = float(age)
    except (TypeError, ValueError):
        return None
    div = AGE_UNITS.get((units or "").strip().lower())
    return round(v / div, 1) if div else None


def monthly(fixes: list[tuple[str, datetime, float, float]], start: int, cutoff: datetime) -> list[dict]:
    """Each cat's fixes before `cutoff`, thinned to one a month (the month's middle one by
    time) and rounded to PRIVACY_DEG. Months count from `start`'s January. Cats in the
    order they were first fixed."""
    by: dict[str, dict[int, list[tuple[datetime, float, float]]]] = defaultdict(lambda: defaultdict(list))
    for cat, t, lon, lat in fixes:
        if t < cutoff:
            by[cat][(t.year - start) * 12 + t.month - 1].append((t, lon, lat))
    out = []
    for cat, months in by.items():
        ms = sorted(months)
        pts = []
        for m in ms:
            day = sorted(months[m])
            _, lon, lat = day[len(day) // 2]
            pts.append((rounded(lon, PRIVACY_DEG), rounded(lat, PRIVACY_DEG)))
        out.append({"id": cat, "n": sum(len(v) for v in months.values()), "m": ms, "p": pack_points(pts)})
    return sorted(out, key=lambda c: (c["m"][0], c["id"]))


def telemetry(refresh: bool = False) -> list[tuple[str, datetime, float, float]]:
    """Every fix as (cat, time, lon, lat)."""
    feats = arcgis_query(C.FWC_PANTHER_TELEMETRY, fields="FLGTDATE,CATNUMBER", refresh=refresh)
    fixes = []
    for f in feats:
        p, g = f["properties"], f.get("geometry")
        if not g or not p.get("FLGTDATE") or not p.get("CATNUMBER"):
            continue
        lon, lat = g["coordinates"][:2]
        fixes.append((str(p["CATNUMBER"]).strip(), utc(p["FLGTDATE"]), float(lon), float(lat)))
    return fixes


def death_row(p: dict, lon: float, lat: float, collared: set[str]) -> list:
    """[month "YYYY-MM", cause group, FWC's cause, sex "F"/"M"/None, age in years, county, lon, lat, collar id]."""
    t = utc(p["Date"])
    sex = {"Female": "F", "Male": "M"}.get((p.get("SEX") or "").strip())
    cat = (p.get("PANTHERID") or "").strip()
    return [
        f"{t.year:04d}-{t.month:02d}",
        cause_group(p.get("CAUSE")),
        (p.get("CAUSE") or "Unknown").strip(),
        sex,
        age_years(p.get("AGE"), p.get("AGE_UNITS")),
        (p.get("COUNTY") or "").strip() or None,
        rounded(lon, DEATH_DEG),
        rounded(lat, DEATH_DEG),
        cat if cat in collared else None,
    ]


def deaths(collared: set[str], refresh: bool = False) -> list[list]:
    feats = arcgis_query(C.FWC_PANTHER_MORTALITY, fields="PANTHERID,SEX,AGE,AGE_UNITS,CAUSE,COUNTY,Date", refresh=refresh)
    rows = []
    for f in feats:
        p, g = f["properties"], f.get("geometry")
        if not g or not p.get("Date") or utc(p["Date"]).year < FIRST_DEATH_YEAR:
            continue
        rows.append(death_row(p, *g["coordinates"][:2], collared))
    return sorted(rows, key=lambda r: r[0])


def zones(refresh: bool = False) -> list[dict]:
    feats = arcgis_query(C.FDEP_PANTHER_ZONES, fields="ZONE,ACRES", refresh=refresh)
    out = []
    for f in feats:
        zone = ZONES.get((f["properties"].get("ZONE") or "").strip().upper())
        if not zone or not f.get("geometry"):
            continue
        g = make_valid(shape(f["geometry"])).simplify(ZONE_TOL, preserve_topology=True)
        out.append({"zone": zone, "acres": round(f["properties"]["ACRES"]), "rings": polygon_rings(g)})
    return sorted(out, key=lambda z: list(ZONES.values()).index(z["zone"]))


def roads(refresh: bool = False) -> list[list[int]]:
    lines = []
    for layer in (C.TIGER_PRIMARY_ROADS, C.TIGER_SECONDARY_ROADS):
        for f in arcgis_query(layer, C.PANTHER_WATER, fields="NAME", refresh=refresh, generalize=ROAD_TOL / 2):
            if f.get("geometry"):
                lines.append(shape(f["geometry"]))
    merged = shapely.line_merge(unary_union(lines).intersection(box(*C.PANTHER_WATER)))
    out = []
    for part in shapely.get_parts(merged):
        part = part.simplify(ROAD_TOL)
        if part.length >= ROAD_MIN_DEG and len(part.coords) >= 2:
            out.append(pack(list(part.coords)))
    return out


def river(refresh: bool = False) -> list[list[int]]:
    """The Caloosahatchee's canal and river, from the lake's shore to the Gulf."""
    names = ["Caloosahatchee Canal", "Caloosahatchee River"]
    stems = lakeo.cut_at_shore(main_stems(names, C.LAKEO_VIEW, refresh), lakeo.lake_outline(refresh))
    return [pack(list(shapely.LineString(stems[n]["p"]).simplify(RIVER_TOL).coords)) for n in names if len(stems[n]["p"]) >= 2]


def water(refresh: bool = False) -> list[dict]:
    clip = box(*C.PANTHER_WATER)
    states = arcgis_query(C.CENSUS_STATES, C.PANTHER_SEA, fields="STUSAB", refresh=refresh)
    # The Census outlines are the US's alone: without its neighbors, Cuba and the Bahamas would read as sea.
    quoted = ",".join(f"'{n}'" for n in C.NEIGHBORS)
    abroad = arcgis_query(C.WORLD_COUNTRIES, C.PANTHER_SEA, where=f"COUNTRY IN ({quoted})", fields="COUNTRY", refresh=refresh, order="FID")
    land = unary_union([make_valid(shape(f["geometry"])) for f in [*states, *abroad] if f.get("geometry")])
    salt = rain.salt_water(land, refresh).intersection(box(*C.PANTHER_SEA))
    # The coast in detail near the range; the rest only fills the screen's edges. The pieces meet
    # without overlapping: the page fills every sea piece together even-odd.
    near = drop_specks(salt.intersection(clip), 1.0).simplify(SEA_TOL, preserve_topology=True)
    far = drop_specks(salt.difference(clip), 50.0).simplify(FAR_SEA_TOL, preserve_topology=True)
    bodies = [{"name": None, "kind": "sea", "km2": round(g.area * KM2_PER_DEG2), "rings": polygon_rings(g)} for g in (near, far)]
    swamps = []
    for hu4 in HU4S:
        cols, geoms = nhd.table(hu4, "NHDWaterbody", ["GNIS_Name", "FType", "AreaSqKm"], bbox=C.PANTHER_WATER, geometry=True)
        for name, ft, a, g in zip(cols["gnis_name"], cols["ftype"], cols["areasqkm"], geoms):
            ft = int(ft)
            if ft in (390, 436) and a >= LAKE_KM2:
                g = g.intersection(clip).simplify(LAKE_TOL, preserve_topology=True)
                if rings := polygon_rings(g):
                    bodies.append({"name": name or None, "kind": "lake", "km2": round(g.area * KM2_PER_DEG2, 1), "rings": rings})
            elif ft == 466:
                swamps.append(g)
    marsh = drop_specks(unary_union(swamps).intersection(clip), SWAMP_KM2).simplify(SWAMP_TOL, preserve_topology=True)
    bodies.append({"name": None, "kind": "swamp", "km2": round(marsh.area * KM2_PER_DEG2), "rings": polygon_rings(marsh)})
    return sorted(bodies, key=lambda b: (b["kind"] != "sea", -b["km2"]))


def latest(today: date | None = None) -> dict:
    """snapshot.json's panther block: this year's deaths so far, fresh from FWC."""
    year = (today or date.today()).year
    feats = arcgis_query(C.FWC_PANTHER_MORTALITY, where=f"YEAR = {year}", fields="CAUSE,Date", refresh=True)
    days = [utc(f["properties"]["Date"]).date() for f in feats if f["properties"].get("Date")]
    return {
        "year": year,
        "deaths": len(feats),
        "vehicle": sum(1 for f in feats if cause_group(f["properties"].get("CAUSE")) == "vehicle"),
        "through": max(days).isoformat() if days else None,
    }


def build(refresh: bool = False) -> dict:
    fixes = telemetry(refresh)
    start = min(t.year for _, t, _, _ in fixes)
    newest = max(t for _, t, _, _ in fixes)
    cutoff = newest.replace(year=newest.year - RECENT_YEARS)
    cats = monthly(fixes, start, cutoff)
    dead = deaths({c["id"] for c in cats}, refresh)
    last = dead[-1][0]
    end = (int(last[:4]) - start) * 12 + int(last[5:]) - 1
    log(f"panthers: {len(cats)} cats, {sum(len(c['m']) for c in cats)} monthly positions {start} to {cutoff.date()}; {len(dead)} deaths through {last}")
    return {
        "meta": {
            "generator": "waterways-pipeline panthers",
            "generatedAt": date.today().isoformat(),
            "sources": [C.FWC_PANTHER_TELEMETRY, C.FWC_PANTHER_MORTALITY, C.FDEP_PANTHER_ZONES, C.TIGER_PRIMARY_ROADS, C.TIGER_SECONDARY_ROADS, C.NHD_BULK, C.CENSUS_STATES, C.WORLD_COUNTRIES],
            "coordOrigin": list(ORIGIN),
            "coordScale": SCALE,
        },
        "start": start,
        "cutoff": cutoff.date().isoformat(),
        "end": end,
        "cats": cats,
        "deaths": dead,
        "zones": zones(refresh),
        "roads": roads(refresh),
        "river": river(refresh),
        "water": water(refresh),
    }
