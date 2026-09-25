import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SITE_JOURNAL, SITE_MAPS, siteNavHtml } from "../src/shared/site";

const root = new URL("../", import.meta.url);
const read = (f: string) => readFileSync(new URL(f, root), "utf8");
const pages = readdirSync(root).filter((f) => f.endsWith(".html") && f !== "index.html");

describe("site nav", () => {
  it("lists every page, and every page has the nav", () => {
    expect([...SITE_MAPS.map((p) => p.href), SITE_JOURNAL.href].sort()).toEqual(pages.sort());
    for (const f of pages) expect(read(f).split("<!-- site-nav -->").length - 1, f).toBe(1);
  });

  it("keeps links to other pages out of the map controls", () => {
    // Chips change the view; only the nav leaves the page.
    for (const f of pages) {
      const html = read(f);
      const at = html.indexOf('<div class="tools">');
      if (at < 0) continue;
      expect(html.slice(at, html.indexOf("</div>", at)), f).not.toMatch(/<a\s/);
    }
  });

  it("marks only the current page, and shows the journal only there", () => {
    const rain = siteNavHtml("rain.html");
    expect(rain.match(/aria-current/g)).toHaveLength(1);
    expect(rain).toMatch(/<a href="rain.html" aria-current="page">/);
    expect(rain).toMatch(/<li class="journal" hidden>/);
    expect(siteNavHtml("journal.html")).toMatch(/<li class="journal"><a href="journal.html" aria-current="page">/);
  });

  it("orders the homepage like the nav", () => {
    const order = [...read("index.html").matchAll(/class="map" href="([^"]+)"/g)].map((m) => m[1]);
    expect(order).toEqual(SITE_MAPS.map((p) => p.href));
  });
});
