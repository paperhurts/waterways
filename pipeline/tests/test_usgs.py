import pytest

from waterways_pipeline.usgs import depth, flows_for, monthly_means, parse_salinity, ratio_to_fort_white, reading

# Fort White has a long record; O'Leno only reported in two Mays.
MONTHS = {
    "F": {(y, 5): 1000.0 + y for y in range(1950, 2000)} | {(1995, 7): 500.0},
    "W": {(y, 5): 100.0 for y in range(1950, 2000)},
    "O": {(1995, 5): 200.0, (1996, 5): 300.0, (1995, 7): 50.0},
}


def test_monthly_means_need_most_of_the_month():
    days = {f"2022-05-{d:02d}": 100.0 for d in range(1, 22)} | {f"2022-06-{d:02d}": 1.0 for d in range(1, 5)}
    assert monthly_means(days) == {(2022, 5): 100.0}


def test_ratio_is_the_median_over_the_same_calendar_month():
    assert ratio_to_fort_white(MONTHS, "O", 5) == pytest.approx((200 / 2995 + 300 / 2996) / 2)
    assert ratio_to_fort_white(MONTHS, "O", 7) == pytest.approx(50 / 500)


def test_measured_months_are_used_as_is():
    flows, est = flows_for(MONTHS, (1995, 5))
    assert flows["O"] == 200.0
    assert est == []


def test_missing_scaled_gauges_are_estimated_from_fort_white():
    flows, est = flows_for(MONTHS, (1980, 5))
    assert est == ["O"]
    assert flows["O"] == round(2980 * ratio_to_fort_white(MONTHS, "O", 5), 1)
    assert flows["W"] == 100.0


def test_typical_uses_long_records_directly_and_estimates_short_ones():
    flows, est = flows_for(MONTHS, "typical")
    assert flows["F"] == 2974.5
    assert flows["W"] == 100.0
    assert est == ["O"]


def test_missing_fort_white_is_an_error():
    with pytest.raises(RuntimeError, match="Fort White"):
        flows_for(MONTHS, (1900, 5))


def test_negative_flow_is_kept_only_where_water_runs_backward():
    assert reading("-648", signed=True) == -648.0
    assert reading("-648") is None
    assert reading("-999999", signed=True) is None
    assert reading(None) is None
    assert reading("12.5") == 12.5


def test_salinity_keeps_the_newest_reading_at_each_depth():
    def feat(series, site, time, value):
        return {"properties": {"time_series_id": series, "monitoring_location_id": f"USGS-{site}", "time": time, "value": value}}

    layer = {"a": depth("TOP (from SP cond)"), "b": depth("BOTTOM"), "c": depth("TOP")}
    stations = [{"id": "02277100", "key": "SP", "short": "Speedy Point"}, {"id": "02277110", "key": "SS", "short": "Steele Point"}]
    feats = [
        feat("a", "02277100", "2026-09-25T14:45:00+00:00", "13"),
        feat("b", "02277100", "2026-09-25T14:45:00+00:00", "21"),
        feat("c", "02277110", "2026-09-25T14:45:00+00:00", "23"),
        # An older series at the same depth, and one with no known depth.
        feat("c", "02277110", "2026-09-20T14:45:00+00:00", "30"),
        feat("z", "02277110", "2026-09-25T14:45:00+00:00", "99"),
    ]
    assert parse_salinity(feats, layer, stations) == {"SP": {"top": 13.0, "bottom": 21.0}, "SS": {"top": 23.0, "bottom": None}}
