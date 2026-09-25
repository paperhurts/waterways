from datetime import date, timedelta

from waterways_pipeline import stlucie


def year_of(wy: int, value: float) -> dict[str, float]:
    start = date(wy - 1, 10, 1)
    return {(start + timedelta(d)).isoformat(): value for d in range(365)}


def test_history_joins_the_two_lock_gauges_and_keeps_backflow(monkeypatch):
    records = {
        "02276877": year_of(1950, 2000.0) | year_of(1990, -150.0),
        stlucie.S80_OLD: year_of(1960, 1800.0),
        "02276998": year_of(2019, 300.0),
    }
    monkeypatch.setattr(stlucie.usgs, "daily", lambda site, refresh=False, signed=False: records[site] if signed else {})
    h = stlucie.history()
    assert h["years"][0] == 1950 and h["years"][-1] == 2019
    at = lambda key, year: h[key][h["years"].index(year)]
    assert at("S308", 1990) == -150
    assert at("S80", 1960) == 1800 and at("S80", 2019) == 300
    assert at("S308", 1960) is None


def test_the_south_forks_path_splits_where_the_north_fork_joins():
    shared = {"p": [[0, 0], [1, 1], [2, 2], [3, 3]], "u": [0, 0, 0, 0]}
    rivers = {stlucie.SOUTH_FORK: shared, stlucie.ESTUARY: shared, stlucie.NORTH_FORK: {"p": [[5, 0], [2.1, 1.9]], "u": [0, 0]}}
    out = stlucie.split_forks(rivers)
    assert out[stlucie.SOUTH_FORK]["p"] == [[0, 0], [1, 1], [2, 2]]
    assert out[stlucie.ESTUARY]["p"] == [[2, 2], [3, 3]]
    assert len(out[stlucie.ESTUARY]["u"]) == 2
