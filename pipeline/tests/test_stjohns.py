from waterways_pipeline import stjohns


def test_miles_to_sea_count_down_the_path():
    # Three points about a mile apart along a meridian, going north.
    path = [(-81.5, 30.0), (-81.5, 30.0 + 1609.34 / 110_540), (-81.5, 30.0 + 2 * 1609.34 / 110_540)]
    miles = stjohns.miles_to_sea(path)
    assert [round(m, 2) for m in miles] == [2.0, 1.0, 0.0]


def test_simplified_points_sit_on_the_packing_grid():
    pts = stjohns.simplified([(-81.5, 30.0), (-81.50001, 30.00001), (-81.49, 30.1)])
    assert len(pts) == len(set(pts)) == 2
