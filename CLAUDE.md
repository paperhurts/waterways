# Waterways

Two canvas-animated maps of north Florida hydrology (Vite + TypeScript, no framework), plus a Python pipeline that regenerates their data. See README.md for the layout and the data method.

## Commands
- `npm run dev`: dev server on **5180** (preview on 4180), pinned with `strictPort`. Don't move them to 5173/4173; other local projects use those.
- `npm test`: Vitest, which covers unit tests in `src/**` plus data-integrity checks in `tests/data.test.ts`.
- `npm run build`: runs `tsc`, then `vite build`.
- `cd pipeline && uv run waterways <springs|streams|rivers|lakes|aquifer|snapshot|all>` writes to `public/data/`. Tests: `uv run --group dev pytest`.

## Things that aren't obvious from the code
- **Data contracts.** `src/shared/types.ts` defines every file in `public/data/`, and the pipeline writes to match it. If you change a shape, update both sides and `tests/data.test.ts`.
- **Packed coordinates.** Streams and lakes store coords as ints: `(lon + 83) * 1e4`, `(lat - 29.5) * 1e4`. The encoder is `pipeline/.../geo.py:pack`; the decoders are `src/rain/network.ts` and `src/shared/lakes.ts`.
- **Aquifer grids.** Base64 uint8 half-feet, row 0 south. They are gridded with the "two nearest distinct contour levels" method, which reproduces the original chat-built grids to a median of 0.0 ft. FGS contour features are statewide MultiLineStrings; never join their parts (`geo.line_parts`), or phantom lines cross the basin.
- **The rain map's study area is a union of boxes** (`STREAMS_AREAS` in `pipeline/.../config.py`, echoed in `streams.json` `meta.areas`): the basin, plus the Atlantic corridor to Lake George. Query sources through `streams.area_query` so overlaps dedupe.
- **Springs.** FDEP lists vents separately. Same-base-name vents within 600 m merge, and magnitude uses `MAGNITUDE`/`HIST_MAG` only (`GROUP_MAG` would make every Silver River vent first-magnitude). NHD "artificial paths" are also the centerlines of wide rivers, so only fade the ones inside lakes (`lakes.inLake`).
- **Fates follow NHDPlus routing** (`terminalpa`), not the chat version's hand rules. Rose Creek reaches the Gulf via an NHD underground conduit, so its swallet is listed in `streams.json` `swallets`.
- **Rendering.** `src/shared/streaks.ts` batches particle streaks per style group, one `stroke()` per group. It uses additive glow in dark mode only. Dense rivers saturate to white under additive blending, so they need low alpha. On the rain map, drops also merge (`MERGE_KEEP`) when they enter a bigger stream class.
- **Theme.** Colors are CSS custom properties in `src/shared/tokens.css`. The canvas reads them via `cssVar()` and re-reads them on color-scheme change. Keep them plain hex/rgba; `light-dark()` would break the canvas.
- **Live gauges.** They use `api.waterdata.usgs.gov/ogcapi/v1` (the legacy `waterservices.usgs.gov` is retired in early 2027). That API's default page size is 10, so always pass `limit`.
- **Deploy.** Pages builds via Actions; the six-hourly deploy refreshes `snapshot.json` in the build only, without committing, and pings the journal database so it stays awake.
  - A daily watcher in the private `paperhurts/admin` repo backs this up. It pings the journal too, and emails if this deploy is disabled or the repo goes 50 days without a push (GitHub pauses scheduled workflows in public repos at 60).
  - The watcher reads `url` and `publishableKey` from `config/supabase.json` on main, so keep that file's path and shape stable.
- **Hosting.** The site lives at `waterways.paperhurts.dev`: a Pages custom domain, backed by a CNAME record `waterways` → `paperhurts.github.io` at Namecheap. The Supabase Site URL points at `https://waterways.paperhurts.dev/journal.html`. The `paperhurts-dev` repo topic adds this project to the paperhurts.dev homepage. Log cross-project follow-ups in the private `paperhurts/admin` repo (`C:/dev/admin`).
- **Spring journal.**
  - It runs on Supabase project `pbswebsavanetmieodsf`; the schema is in `supabase/migrations/`. Apply new migrations with the Supabase MCP `apply_migration`, commit the SQL too, and run `get_advisors` afterward.
  - Access is enforced by RLS through `private.is_member()`, which checks the JWT email against `public.members`. The helper deliberately lives outside the API schema.
  - Sign-up is members-only too: the "Before User Created" auth hook (`private.hook_members_only`, enabled in the dashboard) refuses to create accounts, and so to send sign-in emails, for addresses not in `public.members`.
  - Sign-in emails go out through custom SMTP, because the built-in sender only reaches the Supabase team. That's Resend (connected with its Supabase integration), sending as `journal@paperhurts.dev`. Its DKIM, `send`/`rsend` CNAME, and DMARC records are at Namecheap alongside the domain's email forwarding. The templates are in `supabase/templates/`; paste any changes into Authentication > Emails.
  - Spring ids come from `springs.py` (name + county slug) and are stored in visits, so never change the id scheme without migrating `visits.spring_id`.
  - The maps load journal code only when `hasStoredSession()` is true (`src/journal/session.ts`), which keeps supabase-js out of public map bundles.
  - Test UI changes with `journal.html?demo` on the dev server.
  - Wildlife group ids must match the DB check constraint (`tests/journal.test.ts`). Their colors are the dataviz reference categorical palette in fixed slot order, so don't reorder them without re-running its validator.
- **Python.** The pipeline targets Python 3.14 (`pipeline/.python-version`); numpy and shapely ship wheels for it.
- **No PII in the repo.** Keep local paths, usernames, emails, and machine-specific setup out of committed files, including comments and CLAUDE.md. Data files hold only public geographic names from USGS/FDEP/FGS.
