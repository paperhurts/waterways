// Live cams at springs, on the springs map's cards.
//
// Save the Manatee Club's above-water and underwater cams at Blue Spring, Homosassa
// Springs, and Silver Springs play in the card. The club is a nonprofit, its YouTube
// streams let other sites play them, and its own page plays them through
// youtube-nocookie, as the card does. They're live in manatee season, which "usually
// starts in November and continues until manatee sightings become intermittent, which
// is roughly around the middle of March", and play recorded highlights the rest of the
// year (https://savethemanatee.org/manatees/webcams/). The videos change with the season,
// so the deploy reads the club's current ones into snapshot.json (`cams`,
// pipeline/.../manatees.py); these are the fallback.
//
// Citrus County's river cams on Kings Bay and the Homosassa River are links only: the
// county publishes no terms for showing them elsewhere, as with the panther map's zoo cam.

export type CamView = "above" | "under";

export const VIEW_LABEL: Record<CamView, string> = { above: "Above water", under: "Underwater" };

export const MANATEE_PAGE = "https://savethemanatee.org/manatees/webcams/";

/** Each spring's videos by spring id, as the club's page had them on 2026-10-10. */
export const MANATEE_CAMS: Record<string, Record<CamView, string>> = {
  "volusia-blue-spring--volusia": { above: "ZpcQpPB3GKA", under: "Nkvi4BLL4Bw" },
  "homosassa-spring--citrus": { above: "R_L7_r0lXw4", under: "YGD4JppXDD8" },
  "silver-spring--marion": { above: "4a0vQYiZEPU", under: "P4n5TxnGIH4" },
};

export const RIVER_CAM_PAGE = "https://www.discovercrystalriverfl.com/live-river-cam/";

/** Springs beside one of Citrus County's river cams, and which. */
export const RIVER_CAMS: Record<string, string> = {
  "kings-bay-spring--citrus": "Live cam on Kings Bay",
  "three-sisters-spring--citrus": "Live cam on Kings Bay",
  "hunter-spring--citrus": "Live cam on Kings Bay",
  "crystal-spring-citrus--citrus": "Live cam on Kings Bay",
  "homosassa-spring--citrus": "Live cam on the Homosassa River",
};

/** YouTube's privacy-enhanced player, which sets no cookies until it plays. The tap that
 *  opens it starts it, muted, as browsers allow. */
export const youtubeEmbed = (id: string) => `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&mute=1&playsinline=1&rel=0`;
