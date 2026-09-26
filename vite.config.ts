import { basename, resolve } from "node:path";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";
import { siteNavHtml } from "./src/shared/site";

/** Writes the site nav into each page's <!-- site-nav -->, marking that page as current. */
const siteNav = (): Plugin => ({
  name: "site-nav",
  transformIndexHtml: (html, ctx) => html.replace("<!-- site-nav -->", siteNavHtml(basename(ctx.filename))),
});

// Multi-page static site. `base: "./"` keeps every URL relative, so the same
// build works at waterways.paperhurts.dev, under `vite preview`, or
// from any other static host without reconfiguring.
export default defineConfig({
  base: "./",
  plugins: [siteNav()],
  // 5173/4173 belong to another local project; stay off them.
  server: { port: 5180, strictPort: true },
  preview: { port: 4180, strictPort: true },
  build: {
    target: "es2022",
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, "index.html"),
        rain: resolve(import.meta.dirname, "rain.html"),
        santaFe: resolve(import.meta.dirname, "santa-fe.html"),
        rainbow: resolve(import.meta.dirname, "rainbow.html"),
        stLucie: resolve(import.meta.dirname, "st-lucie.html"),
        kissimmee: resolve(import.meta.dirname, "kissimmee.html"),
        lakeO: resolve(import.meta.dirname, "lake-o.html"),
        indianRiver: resolve(import.meta.dirname, "indian-river.html"),
        reefs: resolve(import.meta.dirname, "reefs.html"),
        springs: resolve(import.meta.dirname, "springs.html"),
        parks: resolve(import.meta.dirname, "parks.html"),
        journal: resolve(import.meta.dirname, "journal.html"),
      },
    },
  },
  test: {
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
  },
});
