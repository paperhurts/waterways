import shapely
from shapely.geometry import box

from waterways_pipeline import parks
from waterways_pipeline.springs import Spring, Vent


def spring(sid: str, lon: float, lat: float, mag: int = 0, name: str = "Spring") -> Spring:
    s = Spring(name.upper(), "Levy", [Vent(lon, lat, name, mag)])
    s.id = sid
    return s


def park(name: str, water: dict[str, float], acres: float = 1000.0, springs=(), coastal: bool = False) -> parks.Park:
    p = parks.Park("S00001", name, "Levy", acres, None, box(-82.0, 29.0, -81.9, 29.1), water=dict(water), springs=list(springs), coastal=coastal)
    return p


NO_REEF = shapely.STRtree([box(-80.0, 25.0, -79.9, 25.1)])


def test_reef_then_springs_then_the_most_water():
    reefy = park("Coral State Park", {"reef": 40, "coast": 5000})
    assert parks.classify(reefy, NO_REEF) == "reef"
    # A first-magnitude spring outranks acres of river swamp.
    big = park("River State Park", {"rivers": 800}, springs=[spring("a", -81.95, 29.05, mag=1)])
    assert parks.classify(big, NO_REEF) == "springs"
    # So does a spring run, but not a scrap of one.
    assert parks.classify(park("Run State Park", {"springs": 5, "rivers": 900}), NO_REEF) == "springs"
    assert parks.classify(park("Prairie Preserve State Park", {"springs": 1, "lakes": 900}), NO_REEF) == "lakes"
    # A small spring counts when the park is named for its springs.
    named = park("Troy Spring State Park", {"rivers": 20}, springs=[spring("b", -81.95, 29.05)])
    assert parks.classify(named, NO_REEF) == "springs"
    assert parks.classify(park("Bluff State Park", {"rivers": 60}, springs=[spring("c", -81.95, 29.05)]), NO_REEF) == "rivers"


def test_named_lakes_coastal_ties_and_dry_parks():
    # The lake itself is rarely park land.
    assert parks.classify(park("Lake Talquin State Park", {"rivers": 1}), NO_REEF) == "lakes"
    # On salt water, coast wins a near tie; inland, the most water wins.
    near_tie = {"lakes": 95, "coast": 77}
    assert parks.classify(park("Big Lagoon State Park", near_tie, coastal=True), NO_REEF) == "coast"
    assert parks.classify(park("Big Lagoon State Park", near_tie), NO_REEF) == "lakes"
    # Too little water, or too small a share of a big park, is land.
    assert parks.classify(park("Museum State Park", {"lakes": 3}), NO_REEF) == "land"
    assert parks.classify(park("Trail State Park", {"rivers": 20}, acres=5000), NO_REEF) == "land"


def test_live_reef_on_fwcs_map_makes_a_reef_park():
    reef = shapely.STRtree([box(-81.95, 29.05, -81.94, 29.06)])
    assert parks.classify(park("Key State Park", {"coast": 3000}), reef) == "reef"


def test_springs_near_a_park_edge_are_in_it():
    p = park("Springs State Park", {})
    inside = spring("in", -81.95, 29.05)
    # ~30 m past the east edge: FDEP's point in the channel beside the park.
    edge = spring("edge", -81.9 + 30 / 97_000, 29.05)
    far = spring("far", -81.9 + 300 / 97_000, 29.05)
    where = parks.spring_parks([inside, edge, far], [p])
    assert set(where) == {"in", "edge"}


def test_first_magnitude_vents_close_together_are_one_spring():
    vents = [spring(f"v{i}", -82.0 + i * 0.005, 29.0, mag=1) for i in range(4)]  # a chain ~500 m apart
    lone = spring("lone", -81.5, 29.0, mag=1)
    small = spring("small", -82.0, 29.001, mag=2)
    groups = parks.big_springs([*vents, lone, small])
    assert sorted(len(g) for g in groups) == [1, 4]


def test_county_lists_read_alike():
    assert parks.tidy_county("Martin,Palm Beach") == "Martin, Palm Beach"
    assert parks.tidy_county("Dade") == "Miami-Dade"
    assert parks.tidy_county(None) == ""


def test_every_water_community_has_a_known_class():
    assert {c for c, _ in parks.WATER.values()} <= set(parks.CLASSES)
