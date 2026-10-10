import pytest

from waterways_pipeline.manatees import parse


def item(video: str, title: str) -> str:
    """One entry of the club's video gallery, as its page marks it up."""
    return (
        '<div class="pp-video-gallery-item" data-index="0"><div class="pp-video">'
        f'<iframe class="pp-video-iframe" allowfullscreen allow="autoplay" data-src="https://www.youtube-nocookie.com/embed/{video}?feature=oembed&amp;rel=0"></iframe>'
        f'</div><div class="pp-video-info"><div class="pp-video-title">{title}</div></div></div>'
    )


CAMS = [
    ("ZpcQpPB3GKA", "Above-Water Webcam at Blue Spring State Park"),
    ("R_L7_r0lXw4", "Above-Water Webcam at Ellie Schiller Homosassa Springs Wildlife State Park"),
    ("4a0vQYiZEPU", "Above-Water Webcam at Silver Springs State Park"),
    ("Nkvi4BLL4Bw", "Underwater Webcam at Blue Spring State Park"),
    ("YGD4JppXDD8", "Underwater Webcam at Ellie Schiller Homosassa Springs Wildlife State Park"),
    ("P4n5TxnGIH4", "Underwater Webcam at Silver Springs State Park"),
]


def test_parse_maps_each_cam_to_its_spring():
    page = "<main>" + "".join(item(v, t) for v, t in CAMS) + item("6i0Ndy4d2Zg", "Gator Makes a Summer Visit") + "</main>"
    assert parse(page) == {
        "volusia-blue-spring--volusia": {"above": "ZpcQpPB3GKA", "under": "Nkvi4BLL4Bw"},
        "homosassa-spring--citrus": {"above": "R_L7_r0lXw4", "under": "YGD4JppXDD8"},
        "silver-spring--marion": {"above": "4a0vQYiZEPU", "under": "P4n5TxnGIH4"},
    }


def test_a_title_without_a_player_takes_no_other_cams_video():
    page = item("", CAMS[0][1]).replace("embed/", "embed") + "".join(item(v, t) for v, t in CAMS[1:])
    with pytest.raises(ValueError, match="volusia-blue-spring--volusia above"):
        parse(page)


def test_a_page_that_changed_shape_fails():
    with pytest.raises(ValueError, match="no volusia-blue-spring--volusia above"):
        parse("<main>New design</main>")
