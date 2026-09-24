from waterways_pipeline.rivers import join_path, main_levelpaths, trim


def test_main_levelpath_is_the_one_with_most_named_length():
    named = [
        {"properties": {"gnis_name": "Santa Fe River", "levelpathi": 1, "lengthkm": 50}},
        {"properties": {"gnis_name": "Santa Fe River", "levelpathi": 2, "lengthkm": 3}},
        {"properties": {"gnis_name": "New River", "levelpathi": 7, "lengthkm": 9}},
    ]
    assert main_levelpaths(named) == {"Santa Fe River": 1, "New River": 7}


def test_join_path_orders_upstream_first_and_flags_underground_ends():
    segs = [
        (10, [(2.0, 0.0), (3.0, 0.0)], False),  # downstream, surface
        (30, [(0.0, 0.0), (1.0, 0.0)], False),  # upstream, surface
        (20, [(1.0, 0.0), (2.0, 0.0)], True),  # underground in between
    ]
    pts, u = join_path(segs)
    assert pts == [(0.0, 0.0), (1.0, 0.0), (2.0, 0.0), (3.0, 0.0)]
    # Only the middle edge has both ends flagged.
    assert u == [0, 1, 1, 0]


def test_trim_drops_vertices_outside_the_box_at_the_ends():
    pts = [(-84.0, 29.8), (-82.5, 29.8), (-82.4, 29.8), (-81.0, 29.8)]
    assert trim(pts, [0, 1, 0, 0], (-83.0, 29.0, -82.0, 30.0)) == ([(-82.5, 29.8), (-82.4, 29.8)], [1, 0])
