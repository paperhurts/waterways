import pytest
from shapely.geometry import box

from waterways_pipeline import coast
from waterways_pipeline import config as C
from waterways_pipeline.rain import (
    ATLANTIC,
    GULF,
    INLAND,
    OFF,
    SINK,
    Line,
    SinkPoint,
    Sinks,
    classify,
    ends,
    pack_line,
    polygon_rings,
    river_labels,
    through,
    tile_of,
)

# Headwaters 30 and 40 join at 20, which flows to 10, the end of the line.
DN = {30: 20, 40: 20, 20: 10, 10: 0}


def test_ends_follow_the_network_to_its_last_flowline():
    assert ends([30, 40, 20, 10], DN) == {30: 10, 40: 10, 20: 10, 10: 10}


def test_ends_stop_where_the_water_leaves_the_loaded_hucs():
    # 7 drains into 99, which isn't in any of the files read.
    assert ends([7], {7: 99}) == {7: 7}


def test_ends_reject_cycles():
    with pytest.raises(ValueError, match="cycle"):
        ends([1], {1: 2, 2: 1})


class NoSea:
    def sea_at(self, p):
        return None


class AllSea:
    def sea_at(self, p):
        return coast.sea_side(p)


def fate(e, dn, *, shore=(), at=(-82.5, 29.8), sinks=(), sea=NoSea()):
    return classify({e: e}, dn, set(shore), {e: at}, Sinks(list(sinks)), sea)[e]


def test_a_river_draining_into_the_coastline_reaches_the_sea_on_its_side():
    # The Withlacoochee at Yankeetown; the St. Lucie at Stuart.
    assert fate(1, {1: 500}, shore=[500], at=(-82.76, 29.0)) == (GULF, None)
    assert fate(1, {1: 500}, shore=[500], at=(-80.2, 27.2)) == (ATLANTIC, None)


def test_the_sides_split_down_the_peninsula_and_along_the_keys():
    # Naples and Florida Bay are the Gulf's, though east of the springs belt's old -82° line;
    # Biscayne Bay and the reef off Key Largo are the Atlantic's.
    assert coast.sea_side((-81.8, 26.14)) == "gulf"
    assert coast.sea_side((-80.75, 25.05)) == "gulf"
    assert coast.sea_side((-80.2, 25.6)) == "atl"
    assert coast.sea_side((-80.35, 25.0)) == "atl"
    assert coast.sea_side((-87.2, 30.35)) == "gulf"
    assert coast.sea_side((-81.4, 30.4)) == "atl"


def test_an_end_near_a_sink_point_is_that_sink():
    near = [SinkPoint(-82.5005, 29.8005, None), SinkPoint(-82.5, 29.8001, "Mill Creek Swallet")]
    assert fate(1, {1: 0}, sinks=near) == (SINK, "Mill Creek Swallet")
    assert fate(1, {1: 0}, sinks=near[:1]) == (SINK, None)


def test_a_mapped_sink_beats_the_coast():
    near = [SinkPoint(-82.5, 29.8001, "Shore Sink")]
    assert fate(1, {1: 0}, sinks=near, sea=AllSea()) == (SINK, "Shore Sink")


def test_an_unlinked_creek_ending_on_the_coast_reaches_the_sea():
    assert fate(1, {1: 0}, at=(-82.76, 29.0), sea=AllSea()) == (GULF, None)


def test_an_end_far_from_sinks_and_sea_is_inland():
    assert fate(1, {1: 0}, sinks=[SinkPoint(-82.0, 29.0, "Far Sink")]) == (INLAND, None)


def test_water_draining_out_of_the_loaded_hucs_leaves_florida():
    assert fate(1, {1: 99}) == (OFF, None)


def line(seq, acc=1.0, km=1.0, name=None, levelpath=0, ftype=460, at=(-82.5, 29.8)):
    return Line(nid=seq, hydroseq=seq, acc=acc, km=km, name=name, ftype=ftype, wbarea=None, levelpath=levelpath, coords=[(at[0] - 0.01, at[1]), at])


def test_through_marks_everything_upstream_of_a_flowline():
    lines = [line(s) for s in (30, 40, 20, 10)]
    assert through(lines, DN, {20}) == {30, 40, 20}
    assert through(lines, DN, {40}) == {40}


def test_pack_line_quantizes_and_delta_encodes():
    # 11 m steps; the repeat is dropped.
    assert pack_line([(-83.0, 29.5), (-82.999, 29.5), (-82.999, 29.5), (-82.998, 29.501)]) == [0, 0, 10, 0, 10, 10]
    # A line that collapses to one point keeps two, so it can still be drawn.
    assert pack_line([(-83.0, 29.5), (-83.000001, 29.5)]) == [0, 0, 0, 0]


def test_polygon_rings_are_delta_packed_and_drop_slivers():
    rings = polygon_rings(box(-83.0, 29.5, -82.99, 29.51))
    assert len(rings) == 1
    # The ring closes, so its steps sum back to the start.
    _, *dx = rings[0][0::2]
    _, *dy = rings[0][1::2]
    assert (sum(dx), sum(dy)) == (0, 0)
    assert polygon_rings(box(-83.0, 29.5, -82.99999, 29.50001)) == []


def test_tiles_count_from_florida_s_corner():
    west, south = C.FLORIDA_BBOX[:2]
    assert tile_of((west + 0.01, south + 0.01), 0.5) == (0, 0)
    assert tile_of((west + 1.2, south + 0.6), 0.5) == (2, 1)


def test_river_labels_skip_a_delta_s_short_side_channels():
    # A long river, and a 3 km cutoff that carries its whole upstream length.
    river = [line(s, acc=5000, km=10, name="Big River", levelpath=1) for s in (5, 4, 3)]
    cutoff = [line(9, acc=4999, km=3, name="Cutoff", levelpath=2)]
    labels = river_labels(river + cutoff, [GULF] * 4)
    assert [r[2] for r in labels] == ["Big River"]
    # Ranked by its length in Florida.
    assert labels[0][3:] == [GULF, 30]
