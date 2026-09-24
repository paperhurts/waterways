import pytest

from waterways_pipeline import config as C
from waterways_pipeline.geo import pack
from waterways_pipeline.streams import (
    ATLANTIC,
    GULF,
    INLAND,
    OFF,
    SINK,
    Flowline,
    SinkPoint,
    accumulate,
    classify,
    link,
    terminals,
    tidy_name,
)


def fl(seq, dn, tpa=0, km=1.0, end=(-82.5, 29.8)):
    return Flowline(hydroseq=seq, dnhydroseq=dn, terminalpa=tpa, lengthkm=km, name=None, ftype=460, coords=[(end[0] - 0.01, end[1]), end])


# Headwaters 30 and 40 join at 20, which flows to 10, which leaves toward the Gulf.
NET = [fl(30, 20, C.TERMINAL_GULF), fl(40, 20, C.TERMINAL_GULF, km=2), fl(20, 10, C.TERMINAL_GULF), fl(10, 5, C.TERMINAL_GULF)]


def test_link_follows_dnhydroseq_and_stops_at_the_map_edge():
    assert link(NET) == [2, 2, 3, -1]


def test_accumulate_sums_upstream_length():
    assert accumulate(NET, link(NET)) == [1.0, 2.0, 4.0, 5.0]


def test_accumulate_rejects_cycles():
    loop = [fl(1, 2), fl(2, 1)]
    with pytest.raises(ValueError, match="cycle"):
        accumulate(loop, link(loop))


def test_terminals_point_at_the_last_in_map_segment():
    assert terminals(link(NET)) == [3, 3, 3, 3]


def test_ocean_fates_come_from_the_terminal_path():
    net = [fl(2, 1, C.TERMINAL_ATLANTIC), fl(1, 0, C.TERMINAL_ATLANTIC)]
    fates, _ = classify(net, link(net), [])
    assert fates == [ATLANTIC, ATLANTIC]
    fates, _ = classify(NET, link(NET), [])
    assert fates == [GULF] * 4


def test_an_in_map_end_near_a_sink_point_is_a_sink():
    net = [fl(2, 1, 1), fl(1, 0, 1, end=(-82.5, 29.8))]
    near = [SinkPoint(-82.5005, 29.8005, None), SinkPoint(-82.5, 29.8001, "Mill Creek Swallet")]
    fates, names = classify(net, link(net), near)
    assert fates == [SINK, SINK]
    assert names == ["Mill Creek Swallet"] * 2


def test_an_in_map_end_far_from_sinks_is_inland():
    net = [fl(1, 0, 1)]
    fates, names = classify(net, link(net), [SinkPoint(-82.0, 29.0, "Far Sink")])
    assert (fates, names) == ([INLAND], [None])


def test_water_leaving_toward_another_end_is_off_the_map():
    net = [fl(1, 99, 12345)]
    assert classify(net, link(net), [])[0] == [OFF]


@pytest.mark.parametrize(
    ("raw", "tidy"),
    [
        ("POE SPRING (ALACHUA) ", "Poe Spring (Alachua)"),
        ("DEVILS EAR SPRING", "Devils Ear Spring"),
        ("GIL1012973", "GIL1012973"),
        ("  ", None),
        ("HART SPRINGS #3", "Hart Springs #3"),
    ],
)
def test_tidy_name(raw, tidy):
    assert tidy_name(raw) == tidy


def test_pack_quantizes_relative_to_origin_and_keeps_two_points():
    assert pack([(-82.5, 29.8), (-82.49999, 29.80001)]) == [5000, 3000, 5000, 3000]
    assert pack([(-83.0, 29.5), (-82.9, 29.6)]) == [0, 0, 1000, 1000]
