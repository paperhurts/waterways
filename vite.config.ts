import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// Multi-page static site. `base: "./"` keeps every URL relative, so the same
// build works at waterways.paperhurts.dev, under `vite preview`, or
// from any other static host without reconfiguring.
export default defineConfig({
  base: "./",
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
        journal: resolve(import.meta.dirname, "journal.html"),
      },
    },
  },
  test: {
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
  },
});
