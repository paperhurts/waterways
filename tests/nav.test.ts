import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { appHeadHtml, appTitle, SITE_JOURNAL, SITE_MAPS, siteNavHtml } from "../src/shared/site";

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

/** A PNG's width and height, from its header. */
const pngSize = (f: string) => {
  const b = readFileSync(new URL(f, root));
  return `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`;
};

describe("home screen icons", () => {
  it("names each installed page after its map", () => {
    expect(appTitle("springs.html")).toBe("Springs");
    expect(appTitle("journal.html")).toBe("Journal");
    expect(appTitle("index.html")).toBe("Waterways");
    expect(appHeadHtml("rain.html")).toMatch(/<meta name="apple-mobile-web-app-title" content="Rain">/);
  });

  it("has every icon the manifest lists, at its size, and opens a page on itself", () => {
    const manifest = JSON.parse(read("public/manifest.webmanifest"));
    expect(manifest.start_url).toBeUndefined();
    for (const icon of manifest.icons) expect(pngSize(`public/${icon.src}`), icon.src).toBe(icon.sizes);
    expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === "maskable")).toBe(true);
    expect(pngSize("public/apple-touch-icon.png")).toBe("180x180");
  });
});
