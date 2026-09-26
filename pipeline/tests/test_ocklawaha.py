import json

from shapely.geometry import box

from waterways_pipeline import ocklawaha


def test_the_river_is_flagged_where_it_crosses_the_reservoir():
    res = box(-81.9, 29.4, -81.8, 29.5)
    path = [(-81.95, 29.45), (-81.85, 29.45), (-81.75, 29.45)]
    assert ocklawaha.flag_reservoir(path, res) == [0, 1, 0]


def test_springs_in_or_just_off_the_reservoir_are_drowned(tmp_path):
    res = box(-81.9, 29.4, -81.8, 29.5)
    f = tmp_path / "springs.json"
    rows = [
        ["in--putnam", "In Spring", "Putnam", -81.85, 29.45, 3, 1, ""],
        ["edge--putnam", "Edge Spring", "Putnam", -81.797, 29.45, 0, 1, ""],
        ["far--putnam", "Far Spring", "Putnam", -81.7, 29.45, 0, 1, ""],
    ]
    f.write_text(json.dumps({"springs": rows}), encoding="utf-8")
    assert [s[0] for s in ocklawaha.drowned_springs(res, f)] == ["in--putnam", "edge--putnam"]
