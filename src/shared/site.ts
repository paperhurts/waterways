// The site nav: every page, in one order and under one name, written into each
// page's <!-- site-nav --> at build time (the siteNav plugin in vite.config.ts), so
// the pages can't drift apart. src/shared/nav.ts adds its behavior. Kept free of
// DOM code, since vite.config.ts imports it.

export interface SitePage {
  href: string;
  /** Its name in the nav, and wherever else a page names it. */
  name: string;
  /** A line under the name in the phone menu: the page's headline. */
  title: string;
}

/** The maps: the three statewide ones, then the stories north to south. The homepage lists them in this order too. */
export const SITE_MAPS: SitePage[] = [
  { href: "rain.html", name: "Rain", title: "Where does the rain go?" },
  { href: "springs.html", name: "Springs", title: "Every spring, and places to snorkel" },
  { href: "parks.html", name: "State Parks", title: "Florida's state parks keep its water" },
  { href: "apalachicola.html", name: "Apalachicola", title: "The Apalachicola starts at a dam" },
  { href: "stjohns.html", name: "St. Johns", title: "The St. Johns runs north, barely downhill" },
  { href: "santa-fe.html", name: "Santa Fe", title: "The Santa Fe breathes groundwater" },
  { href: "ocklawaha.html", name: "Ocklawaha", title: "The Ocklawaha is still dammed for an unfinished canal" },
  { href: "rainbow.html", name: "Rainbow River", title: "Rainbow River starts full grown" },
  { href: "indian-river.html", name: "Indian River Lagoon", title: "The Indian River Lagoon barely trades with the sea" },
  { href: "peace.html", name: "Peace River", title: "The Peace River lost its spring" },
  { href: "kissimmee.html", name: "Kissimmee", title: "The Kissimmee got its bends back" },
  { href: "lake-o.html", name: "Lake Okeechobee", title: "Lake Okeechobee used to drain south" },
  { href: "st-lucie.html", name: "St. Lucie", title: "The St. Lucie was plumbed to a lake" },
  { href: "panthers.html", name: "Panthers", title: "The Florida panther came back with help from Texas" },
  { href: "reefs.html", name: "Coral Reef", title: "Florida's Coral Reef lost its builders" },
];

/** Members only: hidden until nav.ts finds a stored session, except on the journal itself. */
export const SITE_JOURNAL: SitePage = { href: "journal.html", name: "Journal", title: "Our visits and wildlife" };

/** What a page is called on a home screen: its map's short name, so each map added there opens itself. */
export function appTitle(current: string): string {
  return [...SITE_MAPS, SITE_JOURNAL].find((p) => p.href === current)?.name ?? "Waterways";
}

/** Home screen and installed-app icons, for every page's head. The manifest has no start_url,
 *  so an installed page opens on itself rather than the homepage. */
export function appHeadHtml(current: string): string {
  return [
    '<link rel="apple-touch-icon" href="/apple-touch-icon.png">',
    '<link rel="manifest" href="/manifest.webmanifest">',
    `<meta name="apple-mobile-web-app-title" content="${appTitle(current)}">`,
  ].join("\n");
}

export function siteNavHtml(current: string): string {
  const item = (p: SitePage, attrs = "") =>
    `<li${attrs}><a href="${p.href}"${p.href === current ? ' aria-current="page"' : ""}>${p.name}<small>${p.title}</small></a></li>`;
  const journal = ` class="journal"${current === SITE_JOURNAL.href ? "" : " hidden"}`;
  return [
    '<nav class="site" aria-label="Waterways">',
    '<a class="home" href="./">Waterways</a>',
    '<button class="menu" type="button" aria-expanded="false" aria-controls="siteMaps">All maps</button>',
    `<ul id="siteMaps">${SITE_MAPS.map((p) => item(p)).join("")}${item(SITE_JOURNAL, journal)}</ul>`,
    "</nav>",
  ].join("");
}
