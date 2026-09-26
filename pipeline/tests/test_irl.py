import base64

import numpy as np
from shapely.geometry import box

from waterways_pipeline import config as C
from waterways_pipeline import irl


def test_flushing_counts_km_by_water_from_the_nearest_inlet(monkeypatch):
    # A lagoon 0.1° long and 0.01° wide, running east from an inlet at its west end, with
    # a wall of land across it that water must go around.
    monkeypatch.setattr(C, "IRL_GRID", {"lon0": -81.0, "lat0": 28.0, "res": 0.004, "nx": 30, "ny": 10})
    monkeypatch.setattr(C, "IRL_INLETS", [{"name": "West Inlet", "lon": -81.0, "lat": 28.02}])
    lagoon = box(-81.0, 28.0, -80.9, 28.04).difference(box(-80.95, 28.0, -80.945, 28.03))
    grid, farthest = irl.flushing(lagoon)
    km = np.frombuffer(base64.b64decode(grid), dtype=np.uint8).reshape(10, 30)
    row = km[5]
    assert row[0] == 0
    # Distance grows going east, and the land between isn't lagoon.
    assert row[5] < row[20] < row[28]
    assert km[0, 25] != 255 and km[9, 0] != 255
    # ~10 km along, plus the detour around the wall.
    assert 9 <= farthest <= 12


def test_the_lagoon_leaves_out_the_open_ocean():
    salt = box(-81.0, 28.0, -80.0, 29.0)
    ocean = box(-80.5, 28.0, -80.0, 29.0)
    lagoon = irl.lagoon_of(salt, ocean)
    assert lagoon.bounds[2] <= -80.5 + 1e-9
