import math
from datetime import UTC, datetime

from waterways_pipeline import cwms, kissimmee

LAT = 27.5
#: ~1 m of longitude and latitude here, in degrees.
DX, DY = 1 / (111_320 * math.cos(math.radians(LAT))), 1 / 110_540


def straight(x0: float, meters: float, step: float = 100.0) -> list[tuple[float, float]]:
    return [(x0 + i * step * DX, LAT) for i in range(int(meters / step) + 1)]


def winding(x0: float, meters: float, amp: float = 400.0, wave: float = 800.0, step: float = 25.0) -> list[tuple[float, float]]:
    """A path that swings amp meters either side of a straight line, every wave meters."""
    return [(x0 + i * step * DX, LAT + amp * DY * math.sin(2 * math.pi * i * step / wave)) for i in range(int(meters / step) + 1)]


def test_sinuosity_tells_a_canal_from_a_winding_river():
    assert max(kissimmee.sinuosity(straight(-81.0, 6000))) < 1.01
    bends = kissimmee.sinuosity(winding(-81.0, 6000))
    assert min(bends[20:-20]) > kissimmee.WINDING


def test_classes_follow_the_canal_ways_and_the_bends():
    # Open canal for 4 km, then a winding river over a filled canal, then a straight
    # stretch on the filled canal (the last phase, which NHD still maps as canal).
    canal = straight(-81.0, 4000)
    x1 = canal[-1][0]
    bends = winding(x1, 4000)
    x2 = bends[-1][0]
    filled_run = straight(x2, 4000)
    path = canal + bends[1:] + filled_run[1:]
    open_ = [straight(-81.0, 4000)]
    filled = [straight(x1, 8000)]
    cls = kissimmee.classify(path, open_, filled)
    n1, n2 = len(canal), len(canal) + len(bends) - 1
    assert set(cls[: n1 - 3]) == {0}
    assert cls[n1 + 40 : n2 - 40].count(1) > 0.9 * len(cls[n1 + 40 : n2 - 40])
    assert set(cls[n2 + 20 :]) == {2}


def test_simplify_keeps_each_class_where_it_was():
    path = straight(-81.0, 3000, step=10) + straight(-81.0 + 3010 * DX, 3000, step=10)
    cls = [0] * 301 + [1] * 301
    pts, out = kissimmee.simplify(path, cls)
    assert len(pts) == len(out) < 20
    assert out[0] == 0 and out[-1] == 1
    # The class changes once, at the same place.
    change = next(i for i in range(len(out)) if out[i] == 1)
    assert abs(pts[change][0] - path[301][0]) < 20 * DX


def test_run_miles_sums_each_class():
    path = straight(-81.0, 1609.34 * 2, step=1609.34)
    assert kissimmee.run_miles(path, [0, 1, 1]) == {"canal": 1.0, "river": 1.0, "filled": 0.0}


def test_cwms_readings_and_daily_means():
    rows = cwms.parse({"values": [[1790398800000, 1130.6, 0], [1790402400000, None, 0], [1790406000000, 1132.5, 0]]})
    assert [v for _, v in rows] == [1130.6, 1132.5]
    assert rows[0][0] == datetime.fromtimestamp(1790398800, UTC)
    hours = [(datetime(2026, 9, 1, h, tzinfo=UTC), 100.0 + h) for h in range(24)] + [(datetime(2026, 9, 2, 0, tzinfo=UTC), 5.0)]
    days = cwms.daily_means(hours)
    assert days == {"2026-09-01": 111.5}
    assert cwms.daily_means(hours, min_readings=1)["2026-09-02"] == 5.0
