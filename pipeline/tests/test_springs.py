import pytest

from waterways_pipeline.springs import Vent, assign_ids, group_vents, magnitude, spring_base, tidy_name


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


@pytest.mark.parametrize(
    ("raw", "base"),
    [
        ("SILVER SPRING #7", "SILVER SPRING"),
        ("SILVER SPRING MAMMOTH EAST VENT B", "SILVER SPRING"),
        ("SILVER SPRING MAIN", "SILVER SPRING"),
        ("SILVER GLEN SPRINGS NATURAL WELL", "SILVER GLEN SPRINGS"),
        ("WATERMELON SPRING (ALACHUA) #2", "WATERMELON SPRING (ALACHUA)"),
        ("POE SPRING (ALACHUA)", "POE SPRING (ALACHUA)"),
    ],
)
def test_spring_base_strips_vent_labels(raw, base):
    assert spring_base(raw) == base


def test_magnitude_takes_the_best_known_rating():
    assert magnitude({"MAGNITUDE": "3", "HIST_MAG": "2"}) == 2
    # A group's rating says nothing about one small vent in it.
    assert magnitude({"MAGNITUDE": "Unknown", "HIST_MAG": "Unknown", "GROUP_MAG": "1"}) == 0
    assert magnitude({"MAGNITUDE": "Unknown", "HIST_MAG": " ", "GROUP_MAG": None}) == 0


def test_vents_of_one_spring_merge_but_neighbors_stay_apart():
    vents = [
        Vent(-82.0525, 29.2160, "SILVER SPRING #1", 0),
        Vent(-82.0530, 29.2155, "SILVER SPRING MAMMOTH WEST VENT A", 1),
        Vent(-82.0520, 29.2150, "SILVER SPRING #7", 0),
        Vent(-82.0510, 29.2152, "OTHER SPRING", 0),  # nearby, different spring
        Vent(-81.9000, 29.2150, "SILVER SPRING #9", 0),  # same base, far away
    ]
    groups = group_vents(vents)
    assert [(g.key, len(g.vents), g.mag) for g in groups] == [("SILVER SPRING", 3, 1), ("OTHER SPRING", 1, 0), ("SILVER SPRING", 1, 0)]
    assert groups[0].name == "Silver Springs"


def test_singular_and_plural_names_are_one_spring_shown_plural():
    groups = group_vents([Vent(-82.438, 29.102, "RAINBOW SPRING #3", 1), Vent(-82.437, 29.101, "RAINBOW SPRINGS", 0)])
    assert len(groups) == 1
    assert groups[0].name == "Rainbow Springs"


def test_ids_are_name_and_county_with_a_grid_suffix_only_on_collisions():
    springs = group_vents([
        Vent(-82.43, 29.10, "RAINBOW SPRINGS", 1, "Marion"),
        Vent(-82.60, 30.10, "COLUMBIA SPRING", 0, "Columbia"),
        Vent(-82.70, 29.90, "COLUMBIA SPRING", 0, "Columbia"),
    ])
    assign_ids(springs)
    ids = sorted(s.id for s in springs)
    assert ids == ["columbia-spring--columbia-2990-8270", "columbia-spring--columbia-3010-8260", "rainbow-spring--marion"]
