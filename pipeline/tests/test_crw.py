from waterways_pipeline.crw import LEVELS, level, now, parse, yearly_peaks

FILE = """Name:
Florida Keys

YYYY MM DD SST_MIN SST_MAX SST@90th_HS SSTA@90th_HS 90th_HS>0 DHW_from_90th_HS>1 BAA_7day_max
2022 08 01 29.0000 30.5000 30.1000      1.1000       0.2000    3.0000            1
2023 08 01 30.0000 32.0000 31.5000      2.5000       2.0000   22.2986            4
2023 08 02 29.9000 31.9000 31.4000      2.4000       1.9000   21.9000            4
2026 09 23 29.7600 30.9400 30.7700      2.0260       1.2300   21.2143            4
2026 09 24 29.7900 30.8300 30.6800      1.9790       1.1200   21.0757            4
"""


def test_levels_follow_noaas_current_scale():
    assert level(-0.3, 25) == 0  # no HotSpot today: no stress, whatever the DHW
    assert level(0.5, 2) == 1  # watch
    assert level(1.2, 2) == 2  # warning
    assert [level(1.5, d) for d in (4, 8, 12, 16, 20, 30)] == [3, 4, 5, 6, 7, 7]
    assert LEVELS[7] == "Alert Level 5"


def test_parse_reads_the_daily_rows_only():
    rows = parse(FILE)
    assert [r["date"] for r in rows] == ["2022-08-01", "2023-08-01", "2023-08-02", "2026-09-23", "2026-09-24"]
    assert rows[1]["dhw"] == 22.2986
    assert rows[0]["level"] == 1


def test_yearly_peaks_and_now():
    rows = parse(FILE)
    assert yearly_peaks(rows) == {2022: 3.0, 2023: 22.3, 2026: 21.2}
    today = now(rows)
    assert today == {"date": "2026-09-24", "sst": 30.68, "dhw": 21.1, "level": 7, "peak": 21.2}
