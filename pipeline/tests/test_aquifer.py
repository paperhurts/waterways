import base64

import numpy as np

from waterways_pipeline.aquifer import encode, interpolate, window_mean

SPEC = {"lon0": -83.0, "lat0": 29.0, "res": 0.01, "nx": 21, "ny": 11}


def ns_line(lon, level):
    return (level, [(lon, 28.9), (lon, 29.2)])


def test_interpolates_linearly_between_parallel_contours():
    # 10 ft at the west edge, 20 ft at the east edge: halfway should be 15.
    z = interpolate([ns_line(-83.0, 10), ns_line(-82.8, 20)], SPEC)
    assert z.shape == (11, 21)
    assert np.allclose(z[:, 0], 10)
    assert np.allclose(z[:, 20], 20)
    assert np.allclose(z[:, 10], 15, atol=0.01)
    # Monotonic west to east, with no flat terraces.
    assert np.all(np.diff(z[5]) > 0)


def test_single_level_fills_with_that_level():
    z = interpolate([ns_line(-82.9, 40)], SPEC)
    assert np.allclose(z, 40)


def test_encode_is_half_foot_bytes():
    raw = base64.b64decode(encode(np.array([[0, 0.5, 40, 200]])))
    assert list(raw) == [0, 1, 80, 255]


def test_window_mean_uses_only_cells_inside():
    z = np.zeros((SPEC["ny"], SPEC["nx"]))
    z[:, 10:] = 10
    assert window_mean(z, SPEC, (-82.9, 29.0, -82.8, 29.1)) == 10.0
    assert window_mean(z, SPEC, (-83.0, 29.0, -82.91, 29.1)) == 0.0


def test_multipart_contours_stay_separate():
    # Two pieces of the 10-ft line far apart; joined, they'd cut straight across the grid.
    from waterways_pipeline.geo import line_parts

    geom = {"type": "MultiLineString", "coordinates": [[[-84.0, 28.0], [-84.0, 28.1]], [[-80.0, 31.0], [-80.0, 31.1]]]}
    assert len(line_parts(geom)) == 2
