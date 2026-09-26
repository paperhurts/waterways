from datetime import date, datetime, timezone

from waterways_pipeline import panthers
from waterways_pipeline.geo import ORIGIN, SCALE


def at(y: int, m: int, d: int = 1) -> datetime:
    return datetime(y, m, d, tzinfo=timezone.utc)


def ms(t: datetime) -> int:
    return int((t - panthers.EPOCH).total_seconds() * 1000)


def test_monthly_keeps_the_middle_fix_rounded_and_drops_recent_ones():
    fixes = [
        ("FP1", at(1990, 1, 3), -81.1011, 26.1011),
        ("FP1", at(1990, 1, 15), -81.2011, 26.2011),
        ("FP1", at(1990, 1, 28), -81.3011, 26.3011),
        # The same place next month still counts: positions line up with months.
        ("FP1", at(1990, 2, 10), -81.2011, 26.2011),
        ("FP1", at(2024, 6, 1), -81.0, 26.0),
        ("TX101", at(1995, 3, 2), -81.5, 25.9),
    ]
    cats = panthers.monthly(fixes, 1981, at(2024, 1, 1))
    assert [c["id"] for c in cats] == ["FP1", "TX101"]
    fp1 = cats[0]
    assert fp1["m"] == [108, 109]
    assert fp1["n"] == 4  # the 2024 fix is past the cutoff
    x = round((panthers.rounded(-81.2011, panthers.PRIVACY_DEG) - ORIGIN[0]) * SCALE)
    y = round((panthers.rounded(26.2011, panthers.PRIVACY_DEG) - ORIGIN[1]) * SCALE)
    assert fp1["p"] == [x, y, x, y]
    assert x % 50 == 0 and y % 50 == 0


def test_causes_group_and_unknown_ones_are_other():
    assert panthers.cause_group("Vehicular trauma") == "vehicle"
    assert panthers.cause_group("Intraspecific aggression") == "fight"
    assert panthers.cause_group("Infectious disease - Pseudorabies") == "disease"
    assert panthers.cause_group("Something new") == "other"
    assert panthers.cause_group(None) == "other"


def test_ages_come_in_years_months_or_days():
    assert panthers.age_years("2.5", "Years") == 2.5
    assert panthers.age_years("6", "Months") == 0.5
    assert panthers.age_years("", "Years") is None
    assert panthers.age_years("3", "") is None


def test_death_rows_leave_out_location_notes_and_link_only_collared_cats():
    props = {
        "Date": ms(at(2016, 3, 9)), "CAUSE": "Vehicular trauma", "SEX": "Female", "AGE": "3", "AGE_UNITS": "Years",
        "COUNTY": "Collier", "PANTHERID": "FP224", "LOCATION": "private property off a lane, by the owner's driveway",
    }
    row = panthers.death_row(props, -81.36789, 26.21234, {"FP224"})
    assert row == ["2016-03", "vehicle", "Vehicular trauma", "F", 3.0, "Collier", -81.37, 26.21, "FP224"]
    assert "driveway" not in str(row)
    assert panthers.death_row(props, -81.36789, 26.21234, set())[-1] is None


def test_dates_before_1970_work():
    assert panthers.utc(ms(at(1949, 6, 1))).year == 1949


def test_latest_counts_this_years_deaths(monkeypatch):
    feats = [
        {"properties": {"CAUSE": "Vehicular trauma", "Date": ms(at(2026, 5, 16))}},
        {"properties": {"CAUSE": "Intraspecific aggression", "Date": ms(at(2026, 7, 1))}},
    ]
    seen = {}

    def query(layer, *args, where="1=1", refresh=False, **kw):
        seen["where"], seen["refresh"] = where, refresh
        return feats

    monkeypatch.setattr(panthers, "arcgis_query", query)
    out = panthers.latest(date(2026, 9, 26))
    assert out == {"year": 2026, "deaths": 2, "vehicle": 1, "through": "2026-07-01"}
    assert seen == {"where": "YEAR = 2026", "refresh": True}
