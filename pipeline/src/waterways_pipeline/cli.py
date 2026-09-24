"""`waterways <dataset>`: regenerate datasets into public/data/."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from . import aquifer, rivers, streams, usgs
from .config import OUT
from .fetch import log

DATASETS = ["streams", "rivers", "lakes", "aquifer", "snapshot"]


def write(out: Path, name: str, data: dict) -> None:
    out.mkdir(parents=True, exist_ok=True)
    text = json.dumps(data, separators=(",", ":"), ensure_ascii=False)
    (out / name).write_text(text + "\n", encoding="utf-8")
    log(f"wrote {out / name} ({len(text) / 1024:.0f} KB)")


def run(dataset: str, out: Path, refresh: bool) -> None:
    if dataset == "streams":
        write(out, "streams.json", streams.build(refresh))
    elif dataset == "rivers":
        write(out, "rivers.json", rivers.build_rivers(refresh))
    elif dataset == "lakes":
        write(out, "lakes.json", rivers.build_lakes(refresh))
    elif dataset == "aquifer":
        aq, contours = aquifer.build(refresh)
        write(out, "aquifer.json", aq)
        write(out, "contours.json", contours)
    elif dataset == "snapshot":
        # Always fresh: this is the point of the snapshot.
        write(out, "snapshot.json", usgs.latest())


def main() -> None:
    p = argparse.ArgumentParser(prog="waterways", description=__doc__)
    p.add_argument("dataset", choices=[*DATASETS, "all"])
    p.add_argument("--out", type=Path, default=OUT, help=f"output directory (default: {OUT})")
    p.add_argument("--refresh", action="store_true", help="ignore the download cache and refetch sources")
    args = p.parse_args()
    for d in DATASETS if args.dataset == "all" else [args.dataset]:
        run(d, args.out, args.refresh)
