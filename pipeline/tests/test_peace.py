import base64

import numpy as np

from waterways_pipeline import aquifer, peace


def test_drawdown_is_the_fall_from_pre_development_in_whole_feet(monkeypatch):
    spec = {"lon0": -82.0, "lat0": 27.0, "res": 0.1, "nx": 3, "ny": 2}
    monkeypatch.setattr(peace.C, "PEACE_GRID", spec)
    surfaces = {"Pre-development": 100.0, peace.NOW: 76.4, peace.DRY: 110.0}
    monkeypatch.setattr(aquifer, "fetch_contours", lambda month, refresh=False, bbox=None: month)
    monkeypatch.setattr(aquifer, "interpolate", lambda month, spec: np.full((spec["ny"], spec["nx"]), surfaces[month]))
    dd = peace.drawdown()
    now = np.frombuffer(base64.b64decode(dd["now"]), dtype=np.uint8)
    dry = np.frombuffer(base64.b64decode(dd["dry"]), dtype=np.uint8)
    assert now.tolist() == [24] * 6
    # A surface above the old one reads as no fall, not a wraparound.
    assert dry.tolist() == [0] * 6
    assert dd["nowMax"] == 24 and dd["months"]["dry"] == peace.DRY


def test_simplified_points_sit_on_the_packing_grid():
    pts = peace.simplified([(-81.8, 27.9), (-81.80001, 27.90001), (-81.79, 27.85), (-81.78, 27.8)])
    assert len(pts) == len(set(pts))
