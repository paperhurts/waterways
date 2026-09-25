import numpy as np
from shapely.geometry import LineString, Point

from waterways_pipeline import nhd


def test_bulk_rows_become_map_server_features():
    names = ["NHDPlusID", "GNIS_Name", "FType", "LengthKM"]
    data = [np.array([1.5e13, 2.5e13, 3.5e13, None], dtype=object), np.array(["Wekiva River", None, "X", "Y"], dtype=object), np.array([460, 558, 460, 460]), np.array([0.5, 0.2, 1.0, 1.0])]
    geoms = [LineString([(0.1, 0.1, 5), (0.2, 0.2, 5)]), LineString([(0.3, 0.3), (0.4, 0.4)]), LineString([(5, 5), (6, 6)]), Point(0.5, 0.5)]
    vaa = {int(1.5e13): (10, 9, 1, 7, 2)}
    feats = nhd.to_features(names, data, geoms, (0, 0, 1, 1), "nhdplusid,gnis_name,ftype,lengthkm,hydroseq,dnhydroseq,terminalpa", vaa)
    # Outside the box, missing an id, or off the flow network: dropped.
    assert len(feats) == 1
    f = feats[0]
    assert f["properties"] == {"nhdplusid": int(1.5e13), "gnis_name": "Wekiva River", "ftype": 460, "lengthkm": 0.5, "hydroseq": 10, "dnhydroseq": 9, "terminalpa": 1}
    assert f["geometry"]["coordinates"] == ((0.1, 0.1), (0.2, 0.2))


def test_other_layers_keep_everything_in_the_box():
    names = ["NHDPlusID", "FType"]
    data = [np.array([7.0, 8.0], dtype=object), np.array([312, 312])]
    feats = nhd.to_features(names, data, [Point(0.5, 0.5), Point(2, 2)], (0, 0, 1, 1), "nhdplusid", None)
    assert [f["properties"] for f in feats] == [{"nhdplusid": 7}]


def test_blank_network_attributes_are_none():
    assert nhd.whole(float("nan")) is None
    assert nhd.whole(None) is None
    assert nhd.whole(15000300000195.0) == 15000300000195
