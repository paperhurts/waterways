"""Save the Manatee Club's manatee cams: the YouTube streams its webcams page plays now.

The club runs an above-water and an underwater cam at Blue Spring, Homosassa Springs, and
Silver Springs. It streams them live in manatee season, which "usually starts in November
and continues until manatee sightings become intermittent, which is roughly around the
middle of March", and plays recorded highlights the rest of the year, so the videos change.
The snapshot carries the ones on the page now (`cams`); the springs map falls back to those
in src/springs/cams.ts.
"""

from __future__ import annotations

import html
import re

from .fetch import get_text

PAGE = "https://savethemanatee.org/manatees/webcams/"
# The page's names for the parks, and the springs' ids in springs.json.
SPRINGS = {"Blue Spring": "volusia-blue-spring--volusia", "Homosassa": "homosassa-spring--citrus", "Silver Springs": "silver-spring--marion"}
VIEWS = {"Above-Water": "above", "Underwater": "under"}


def parse(page: str) -> dict[str, dict[str, str]]:
    """Each spring's above-water and underwater video ids, from the page's video gallery.
    Each gallery item holds one player and its title ("Underwater Webcam at Blue Spring
    State Park"); the page's other galleries, of past videos, have other titles."""
    cams: dict[str, dict[str, str]] = {}
    for item in page.split('class="pp-video-gallery-item"')[1:]:
        video = re.search(r"youtube(?:-nocookie)?\.com/embed/([\w-]{11})", item)
        title = re.search(r'class="pp-video-title">([^<]+)<', item)
        cam = title and re.match(r"(Above-Water|Underwater) Webcam at (.+)", html.unescape(title.group(1)).strip())
        if not (video and cam):
            continue
        spring = next((sid for name, sid in SPRINGS.items() if name in cam.group(2)), None)
        if spring:
            cams.setdefault(spring, {})[VIEWS[cam.group(1)]] = video.group(1)
    # A page that changed shape fails loudly, and the map keeps its own ids.
    missing = [f"{s} {v}" for s in SPRINGS.values() for v in VIEWS.values() if v not in cams.get(s, {})]
    if missing:
        raise ValueError(f"the webcams page has no {', '.join(missing)}")
    return cams


def latest() -> dict[str, dict[str, str]]:
    """snapshot.json's `cams`: the streams on the club's page now."""
    return parse(get_text(PAGE))
