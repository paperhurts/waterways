from datetime import date, timedelta

from waterways_pipeline import lakeo


def year_of(wy: int, value: float) -> dict[str, float]:
    start = date(wy - 1, 10, 1)
    return {(start + timedelta(d)).isoformat(): value for d in range(365)}


def test_south_sums_only_years_every_canal_reports():
    assert lakeo.summed([{1960: -207, 1961: 10}, {1960: 4}, {1960: -290, 1961: 5}]) == {1960: -493}


def test_history_joins_both_moore_haven_gauges(monkeypatch):
    records = {
        lakeo.site("S308"): year_of(1990, 4.0),
        lakeo.S77_OLD: year_of(1990, 139.0),
        lakeo.site("S77"): year_of(2010, 924.0),
        lakeo.site("S351H"): year_of(1990, -6.0) | year_of(2010, 26.0),
        lakeo.site("S351N"): year_of(1990, 187.0) | year_of(2010, 69.0),
        lakeo.site("S354"): year_of(2010, 51.0),
    }
    monkeypatch.setattr(lakeo.usgs, "daily", lambda s, refresh=False, signed=False: records[s] if signed else {})
    h = lakeo.history()
    at = lambda key, year: h[key][h["years"].index(year)]
    assert at("west", 1990) == 139 and at("west", 2010) == 924
    assert at("south", 2010) == 146
    # Miami Canal has no 1990 record, so there's no south total that year.
    assert at("south", 1990) is None


def test_paths_are_cut_at_the_shore():
    from shapely.geometry import box

    lake = box(0, 0, 10, 10)
    through = {"p": [[-5, 5], [-1, 5], [2, 5], [8, 5], [11, 5], [15, 5]], "u": [0] * 6}
    rivers = lakeo.cut_at_shore({"Kissimmee River": through, "Saint Lucie Canal": through, "Hillsboro Canal": {"p": [[20, 0], [30, 0]], "u": [0, 0]}}, lake)
    # The inflow stops at its first point in the lake; the outlet starts at its last.
    assert rivers["Kissimmee River"]["p"] == [[-5, 5], [-1, 5], [2, 5]]
    assert rivers["Saint Lucie Canal"]["p"] == [[8, 5], [11, 5], [15, 5]]
    assert rivers["Hillsboro Canal"]["p"] == [[20, 0], [30, 0]]
