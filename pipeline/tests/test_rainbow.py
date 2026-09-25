from datetime import date, timedelta

from waterways_pipeline import rainbow


def days(start: date, n: int, value: float) -> dict[str, float]:
    return {(start + timedelta(d)).isoformat(): value for d in range(n)}


def test_water_years_run_october_to_september():
    # October 2019 belongs to water year 2020.
    wy = rainbow.water_years(days(date(2019, 10, 1), 366, 600.0), today=date(2026, 9, 25))
    assert wy == {2020: 600}


def test_water_years_skip_gappy_and_unfinished_years():
    record = days(date(2020, 10, 1), 200, 500.0)  # water year 2021: too few days
    record |= days(date(2025, 10, 1), 360, 700.0)  # water year 2026: not over on Sept 25
    assert rainbow.water_years(record, today=date(2026, 9, 25)) == {}
    assert rainbow.water_years(record, today=date(2026, 10, 2)) == {2026: 700}


def test_vents_listed_twice_merge_under_the_shortest_name(monkeypatch):
    feats = [
        {"geometry": {"coordinates": [-82.4375, 29.1025]}, "properties": {"SPRING_NAME": "RAINBOW SPRINGS VENT #1"}},
        {"geometry": {"coordinates": [-82.43751, 29.10251]}, "properties": {"SPRING_NAME": "RAINBOW SPRINGS"}},
        {"geometry": {"coordinates": [-82.4364, 29.0985]}, "properties": {"SPRING_NAME": "RAINBOW SPRING #5"}},
    ]
    monkeypatch.setattr(rainbow, "arcgis_query", lambda *a, **k: feats)
    assert [v[0] for v in rainbow.vents()] == ["Rainbow Springs", "Rainbow Spring #5"]
