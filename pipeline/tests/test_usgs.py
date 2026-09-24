import pytest

from waterways_pipeline.usgs import flows_for, monthly_means, ratio_to_fort_white

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
