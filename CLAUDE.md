# Waterways

Two canvas-animated maps of north Florida hydrology (Vite + TypeScript, no framework), plus a Python pipeline that regenerates their data. See README.md for the layout and the data method.

## Commands
- `npm run dev`: dev server on **5180** (preview on 4180), pinned with `strictPort`. Don't move them to 5173/4173; other local projects use those.
- `npm test`: Vitest, which covers unit tests in `src/**` plus data-integrity checks in `tests/data.test.ts`.
- `npm run build`: runs `tsc`, then `vite build`.
- `cd pipeline && uv run waterways <streams|rivers|lakes|aquifer|snapshot|all>` writes to `public/data/`. Tests: `uv run --group dev pytest`.

## Things that aren't obvious from the code
- **Data contracts.** `src/shared/types.ts` defines every file in `public/data/`, and the pipeline writes to match it. If you change a shape, update both sides and `tests/data.test.ts`.
- **Packed coordinates.** Streams and lakes store coords as ints: `(lon + 83) * 1e4`, `(lat - 29.5) * 1e4`. The encoder is `pipeline/.../geo.py:pack`; the decoders are `src/rain/network.ts` and `src/shared/lakes.ts`.
- **Aquifer grids.** Base64 uint8 half-feet, row 0 south. They are gridded with the "two nearest distinct contour levels" method, which reproduces the original chat-built grids to a median of 0.0 ft. FGS contour features are statewide MultiLineStrings; never join their parts (`geo.line_parts`), or phantom lines cross the basin.
- **Fates follow NHDPlus routing** (`terminalpa`), not the chat version's hand rules. Rose Creek reaches the Gulf via an NHD underground conduit, so its swallet is listed in `streams.json` `swallets`.
- **Rendering.** `src/shared/streaks.ts` batches particle streaks per style group, one `stroke()` per group. It uses additive glow in dark mode only. Dense rivers saturate to white under additive blending, so they need low alpha. On the rain map, drops also merge (`MERGE_KEEP`) when they enter a bigger stream class.
- **Theme.** Colors are CSS custom properties in `src/shared/tokens.css`. The canvas reads them via `cssVar()` and re-reads them on color-scheme change. Keep them plain hex/rgba; `light-dark()` would break the canvas.
- **Live gauges.** They use `api.waterdata.usgs.gov/ogcapi/v1` (the legacy `waterservices.usgs.gov` is retired in early 2027). That API's default page size is 10, so always pass `limit`.
- **Deploy.** Pages builds via Actions; the six-hourly deploy refreshes `snapshot.json` in the build only, without committing.
- **Python.** The pipeline targets Python 3.14 (`pipeline/.python-version`); numpy and shapely ship wheels for it.
- **No PII in the repo.** Keep local paths, usernames, emails, and machine-specific setup out of committed files, including comments and CLAUDE.md. Data files hold only public geographic names from USGS/FDEP/FGS.
