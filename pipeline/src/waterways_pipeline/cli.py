"""`waterways <dataset>`: regenerate datasets into public/data/."""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

from . import aquifer, crw, cwms, irl, kissimmee, lakeo, parks, rain, rainbow, reefs, rivers, springs, statewide, stlucie, usgs
from . import config as C
from .config import OUT
from .fetch import log

DATASETS = ["springs", "rain", "rivers", "lakes", "aquifer", "rainbow", "st-lucie", "lake-o", "indian-river", "reefs", "kissimmee", "statewide", "parks", "snapshot"]


def write(out: Path, name: str, data: dict, quiet: bool = False) -> None:
    out.mkdir(parents=True, exist_ok=True)
    text = json.dumps(data, separators=(",", ":"), ensure_ascii=False)
    (out / name).write_text(text + "\n", encoding="utf-8")
    if not quiet:
        log(f"wrote {out / name} ({len(text) / 1024:.0f} KB)")


def run(dataset: str, out: Path, refresh: bool) -> None:
    if dataset == "springs":
        write(out, "springs.json", springs.build(refresh))
    elif dataset == "rain":
        base, tiles = rain.build(refresh)
        # Tiles are regenerated whole, so clear out any left from an older cut.
        shutil.rmtree(out / "rain", ignore_errors=True)
        write(out / "rain", "base.json", base)
        for path, tile in tiles.items():
            level, name = path.split("/")
            write(out / "rain" / level, name, tile, quiet=True)
        log(f"wrote {len(tiles)} tiles")
    elif dataset == "rivers":
        write(out, "rivers.json", rivers.build_rivers(refresh))
    elif dataset == "lakes":
        for name, area in C.LAKE_MAPS.items():
            write(out, f"lakes-{name}.json", rivers.build_lakes(area, refresh))
    elif dataset == "aquifer":
        aq, contours = aquifer.build(refresh)
        write(out, "aquifer.json", aq)
        write(out, "contours.json", contours)
    elif dataset == "rainbow":
        write(out, "rainbow.json", rainbow.build(refresh))
    elif dataset == "st-lucie":
        write(out, "st-lucie.json", stlucie.build(refresh))
    elif dataset == "indian-river":
        write(out, "indian-river.json", irl.build(refresh))
    elif dataset == "reefs":
        write(out, "reefs.json", reefs.build(refresh))
    elif dataset == "kissimmee":
        write(out, "kissimmee.json", kissimmee.build(refresh))
    elif dataset == "lake-o":
        write(out, "lake-o.json", lakeo.build(refresh))
    elif dataset == "statewide":
        write(out, "statewide.json", statewide.build(refresh))
    elif dataset == "parks":
        write(out, "parks.json", parks.build(refresh))
    elif dataset == "snapshot":
        # Always fresh: this is the point of the snapshot.
        snap = usgs.latest()
        # The Kissimmee's structures come from the Corps; if it's down, they're just unknown.
        try:
            snap["cfs"] |= cwms.latest()
        except Exception as err:  # noqa: BLE001
            log(f"snapshot: no CWMS readings ({err})")
            snap["cfs"] |= {g["key"]: None for g in C.gauges() if g.get("source") == "cwms"}
        # The reef's heat stress rides along; NOAA being down mustn't lose the gauges.
        try:
            snap["reef"] = crw.latest()
        except Exception as err:  # noqa: BLE001
            log(f"snapshot: no reef heat stress ({err})")
        write(out, "snapshot.json", snap)


def main() -> None:
    p = argparse.ArgumentParser(prog="waterways", description=__doc__)
    p.add_argument("dataset", choices=[*DATASETS, "all"])
    p.add_argument("--out", type=Path, default=OUT, help=f"output directory (default: {OUT})")
    p.add_argument("--refresh", action="store_true", help="ignore the download cache and refetch sources")
    args = p.parse_args()
    for d in DATASETS if args.dataset == "all" else [args.dataset]:
        run(d, args.out, args.refresh)
