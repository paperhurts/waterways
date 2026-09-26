from waterways_pipeline import apalachicola
from waterways_pipeline.geo import ORIGIN, SCALE, pack


def test_simplified_points_sit_on_the_packing_grid_so_flags_line_up():
    # Points closer together than the ~11 m grid would collapse when packed.
    path = [(-85.0, 30.0), (-85.00001, 30.00001), (-84.99, 30.01), (-84.98, 30.0)]
    pts = apalachicola.simplified(path)
    assert len(pack(pts)) == 2 * len(pts)
    for x, y in pts:
        assert abs((x - ORIGIN[0]) * SCALE - round((x - ORIGIN[0]) * SCALE)) < 1e-6
        assert abs((y - ORIGIN[1]) * SCALE - round((y - ORIGIN[1]) * SCALE)) < 1e-6
