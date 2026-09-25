# Where Florida's water goes

Animated maps of Florida's rivers, springs, and sinks, from the north Florida springs belt to the St. Lucie: **[waterways.paperhurts.dev](https://waterways.paperhurts.dev/)**

- **Where does the rain go?** (`rain.html`) shows every mapped creek in the springs belt, from the middle Suwannee (Troy, Royal, Peacock, Lafayette Blue) and the Santa Fe, south through Manatee Springs, Rainbow River, and Dunnellon to Crystal River and Homosassa, and east along the Ocklawaha from the Harris Chain past Silver Springs to the St. Johns at Lake George. Each creek is colored by where its water ends up: the Gulf (down the Suwannee or the Nature Coast's own rivers), the Atlantic via the St. Johns, a sink into the aquifer, or nowhere on the map. The St. Johns is followed past the mapped creeks to the Atlantic, so a traced drop ends at the sea. Spring boils are sized by FDEP magnitude. Rain falls on every creek and flows downstream, faster on bigger rivers. Tap a creek to send a drop down its whole path. Tap a swallet to see where a creek goes underground and where it rises again.
- **The Santa Fe breathes groundwater** (`santa-fe.html`) animates river and spring flow from live USGS gauges. It shows the river vanishing at River Sink and returning at River Rise, dye traces from Gainesville's sinks, and an aquifer time slider that runs from before development to the present.
- **Rainbow River starts full grown** (`rainbow.html`) shows a river that rises out of the ground at full size. Clear water from about 20 spring vents and tannic Withlacoochee water from upstream meet at Dunnellon, spread through Lake Rousseau, and leave for the Gulf down the old river or the barge canal, all driven by six live USGS gauges. Groundwater drifts across Rainbow's springshed toward the head springs, and a panel charts sixty years of flow: the spring barely changes while the river swings.
- **The St. Lucie was plumbed to a lake** (`st-lucie.html`) follows the St. Lucie Canal (C-44), dug from 1916 to 1924, from Lake Okeechobee at Port Mayaca to the St. Lucie Lock, then down the South Fork and through the estuary to the St. Lucie Inlet. Lake water and the canal's own runoff move at the rates two live USGS gauges report. When the lake is lower than the canal, the canal runs backward, and the map shows its runoff dividing between the lake and the lock. Seawater comes in through the inlet and reaches up the estuary as far as the live salinity at Speedy Point and Steele Point says it does. A panel charts the lake's releases since 1931.

- **Lake Okeechobee used to drain south** (`lake-o.html`) shows where Florida's biggest lake sends its water now that canals and a dike have replaced its spill south into the Everglades: west down the Caloosahatchee, east down the St. Lucie Canal, and south into four farm canals. Each gauged outlet runs at its live USGS rate, and lake water drifts toward whichever gates are open. Fisheating Creek flows in at its live rate. A panel charts the water-year flow each way since 1932, including the years the south canals pumped farm runoff back into the lake.

- **Florida's springs** (`springs.html`) maps every spring on FDEP's statewide list (the journal's list, 889 after merging vents), sized by magnitude, with the first- and second-magnitude springs boiling. The areas FDEP's 13 springs cleanup plans (BMAPs) cover, and their priority focus areas, are shaded. Search by name, zoom to a region, or show only the biggest springs; cards link to the rain map or the Rainbow page where a spring appears there.

- **Spring journal** (`journal.html`) is a private, shared log of Florida spring visits. It covers all 889 springs in FDEP's statewide list. Each visit records a date, a 1–5 rating, notes, photos, and wildlife sightings. A sighting can be pinned by the phone's GPS when you tap it. The journal map shows visits and sightings over USGS satellite or topo imagery, with a layer per animal group that you can switch on and off. Signed-in members also see their visits and sightings on the public maps.

## Layout

```
index.html, rain.html, santa-fe.html, rainbow.html, st-lucie.html, lake-o.html, springs.html   page shells (Vite entry points)
src/shared/     projection, pan/zoom viewport, streak renderer, lakes, flow-history chart, theme tokens, data types
src/rain/       the rain map and its creek-network logic
src/santa-fe/   the Santa Fe map: flow model, aquifer grids, authored content
src/rainbow/    the Rainbow River map: flow model, authored content
src/st-lucie/   the St. Lucie map: canal and salinity model, authored content
src/lake-o/     the Lake Okeechobee map: outlet model, authored content
src/springs/    the statewide springs map
src/journal/    the spring journal: Supabase client, visit form, sightings map (Leaflet)
supabase/       database migrations for the journal (tables, row-level security, photo bucket)
public/data/    generated datasets the pages fetch at runtime
config/         hand-maintained inputs: gauges.json, salinity.json, sinks.json
pipeline/       Python (uv) pipeline that regenerates public/data from the sources
tests/          data-integrity checks on public/data
```

## Develop

```bash
npm install
npm run dev
```

The dev server runs at http://localhost:5180 (preview at 4180). Both ports are pinned with `strictPort`, so Vite fails loudly instead of drifting onto another project's port.

```bash
npm test          # unit tests + data-integrity checks
npm run build     # typecheck + production build into dist/
```

## Regenerate the data

The pipeline needs [uv](https://docs.astral.sh/uv/). Downloads are cached in `pipeline/cache/`, so reruns are fast. Pass `--refresh` to refetch everything.

```bash
cd pipeline
uv run waterways all              # or: streams | rivers | lakes | aquifer | snapshot
uv run --group dev pytest
```

Then run `npm test` from the repo root to check the output before committing it.

| Output | Built from | Method |
|---|---|---|
| `streams.json` | NHDPlus HR network flowlines, NHD points, FGS swallets, FDEP springs, `config/sinks.json` | The study area is a union of boxes over the springs belt (`STREAMS_AREAS`). Flowlines are linked by `hydroseq`; NHD's coastline flowlines are dropped, but mark where coastal rivers reach the sea. A creek's fate follows NHDPlus routing (terminal path = Suwannee → Gulf, St. Johns → Atlantic). A network end within 600 m of a mapped sink is a sink; one that drains into the coastline, or ends right at it, reaches that sea; any other end is "inland". `acc` is the km of creek upstream. Multi-vent springs (Silver Spring #1–#12) merge into one spring, named from GNIS where NHD has a name. Each spring's magnitude is its own FDEP rating, never the group's. Below the study area, the St. Johns main stem is followed to its mouth as `route` segments (the Suwannee's mouth is inside the map): they carry the map's water to the sea, but get no rain and don't count toward the fate shares. |
| `rivers.json` | NHDPlus HR | The main level path of each named river, trimmed to the map. Underground conduits (FType 420) are flagged per vertex. |
| `lakes.json` | NHDPlus HR waterbodies; Census cartographic state outlines (1:500,000) | Lakes ≥ 0.2 km² and wetlands ≥ 1.5 km², simplified; wetland islands and scraps under 0.5 km² are dropped. The sea is everything in a box around both river mouths that isn't land in the Census's shoreline-clipped state outlines. |
| `aquifer.json`, `contours.json` | FDEP/FGS Upper Floridan potentiometric surface layer; USGS daily discharge | Each surface is gridded at 0.01° by distance-weighting the two nearest contours of different elevation. Flows are monthly means. A gauge with no record that month is estimated from Fort White by its median same-month ratio (shown as "est."). |
| `rainbow.json` | NHDPlus HR; FDEP springs; SWFWMD springsheds; FDEP Springs Priority Focus Areas; FGS potentiometric surface; USGS daily discharge | Main stems of the Rainbow, the Withlacoochee from above Holder to the Gulf, and the barge canal. FDEP vents on the upper Rainbow, with duplicates within 15 m merged. SWFWMD's Rainbow Springs Group springshed (interpreted from USGS's 1994 potentiometric maps) and FDEP's Rainbow priority focus area, geometry only. The latest FGS contours around them. Water-year mean flows for the Rainbow at Dunnellon and the Withlacoochee near Holder, finished years only. |
| `st-lucie.json` | NHDPlus HR flowlines, waterbodies, and areas; Census cartographic state outlines (1:500,000); USGS daily discharge | Main stems of the St. Lucie Canal, both forks, the estuary, C-23, and the Indian River Lagoon. The Census outlines count the estuary and the lagoon as land, so NHD's areas for them (StreamRiver and BayInlet) are added to the sea. Water-year mean flows at S-308 (Port Mayaca), which USGS reports as negative when the canal runs back into the lake, and at S-80 (the St. Lucie Lock), joined from the old gauge at the lock (1953–2003) and the new one above it (2017 on). Years missing more than about a month of days are left out. |
| `lake-o.json` | NHDPlus HR flowlines, waterbodies, and areas; Census cartographic state outlines (1:500,000); USGS daily discharge | Main stems of the Kissimmee, Fisheating Creek, the Caloosahatchee, the St. Lucie Canal, and the Miami, North New River, Hillsboro, and West Palm Beach canals. NHD carries some across the lake on artificial paths, so each is cut at the shore: an inflow keeps what's above the lake, an outlet what's below it. Water-year mean flow out of the lake east (S-308), west (S-77, joined from the old and new Moore Haven gauges), and south (S-351 into two canals plus S-354, in years all three report). |
| `statewide.json` | Census cartographic state outlines (1:500,000); FDEP Statewide BMAP layers | Florida and its neighbors' outlines, the springs cleanup plan (BMAP) areas, and the Springs Priority Focus Areas, geometry and names only (FDEP's records also carry staff contacts). Plans get short display names in `statewide.PLAN_NAMES`, and the build fails if FDEP adds one without a name. The springs themselves come from `springs.json`. |
| `snapshot.json` | USGS Water Data API, latest values and series metadata | Fallback readings for when a visitor's browser can't reach USGS. Covers every map's gauges (`page` in `config/gauges.json`) and the estuary's salinity stations (`config/salinity.json`), surface and bottom sensors separately. |

## Spring journal

The journal runs on a free Supabase project. `config/supabase.json` holds its URL and publishable key. Both are public by design: every table and the photo bucket use row-level security, and all access requires a signed-in email on the `members` list. Members can read everything. Each person can edit or delete only their own entries. Photos are resized and re-encoded in the browser before upload, which strips their EXIF GPS tags.

- **Sign in:** members get an emailed link. In Supabase → Authentication → URL Configuration, set the Site URL to `https://waterways.paperhurts.dev/journal.html` and add `http://localhost:5180/journal.html` as a redirect URL.
- **Invite people:** add them under People in the journal; they sign in from the journal page with that email. Sign-in links go out through a custom SMTP sender (Resend), because Supabase's built-in email only reaches its own team. A "Before User Created" auth hook refuses accounts for anyone not on the list, so the form can't email strangers.
- **Schema:** SQL lives in `supabase/migrations/`. The first member is seeded by hand, so no personal email is committed.
- **Staying awake:** Supabase pauses free projects after a week without activity. The six-hourly deploy calls a no-op `ping()` to prevent that. If the journal ever says it can't load, restore the project from the Supabase dashboard.
- **Developing without an account:** `http://localhost:5180/journal.html?demo` shows sample data and saves nothing. It's dev-only and stripped from production builds.

## Deploy

`.github/workflows/deploy.yml` builds and publishes to GitHub Pages on every push to `main` and every six hours. Each run fetches fresh gauge readings into the deployed snapshot, and nothing is committed. GitHub pauses scheduled workflows in public repos after 60 days without commits. If the snapshot goes stale, re-enable the workflow from the Actions tab.

Pages must be set to deploy from **GitHub Actions** (Settings → Pages → Source). The custom domain `waterways.paperhurts.dev` is set in the Pages settings. DNS is a CNAME record, `waterways` → `paperhurts.github.io`, at the domain's registrar. The old `paperhurts.github.io/waterways` address redirects to it. The repo carries the GitHub topic `paperhurts-dev`, which puts a card for it on the [paperhurts.dev](https://paperhurts.dev) homepage. The card copy lives in `projects.config.json` in `paperhurts/paperhurts.github.io`.

## Data sources
- Streams, rivers, lakes, and sink/spring points: USGS NHDPlus High Resolution, [hydro.nationalmap.gov](https://hydro.nationalmap.gov/)
- Coastline: US Census Bureau cartographic boundary states (1:500,000), via [TIGERweb](https://tigerweb.geo.census.gov/)
- Journal basemaps: USGS The National Map (imagery, topo, hydrography)
- River and spring discharge, and estuary salinity: [USGS Water Data API](https://api.waterdata.usgs.gov/) (instantaneous and daily values)
- Springs: FDEP Florida Springs layer
- Springsheds: Southwest Florida Water Management District (Major Springsheds); springs cleanup plan (BMAP) and priority focus areas: FDEP Statewide BMAP layers
- Swallets: Florida Geological Survey swallet survey
- Aquifer: FDEP / FGS Upper Floridan Aquifer potentiometric surface, including the USGS pre-development and historic surfaces
- Dye traces: Karst Environmental Services, Mill Creek and Lee Sinks Dye Trace (2005), for Alachua County EPD

## Known limits
- Individual springs are mostly ungauged. Spring dots split each reach's measured gain evenly.
- Some historic flows are scaled from the Fort White gauge and marked "est.".
- Aquifer maps come from different agencies and methods at 10-ft contour intervals. Compare shapes between years, not single feet. The grid is less certain near its edges, which the map fades out.
- "Ends inland" can mean a sink, a closed wetland, a lake with no outlet, or a gap in the map.
- NHD routes Rose Creek and the Santa Fe through underground conduits, so their water counts toward the Gulf. The map labels the swallets where they go underground.
- On the St. Lucie map, only the canal's two structures are gauged live. The North Fork and its canals (C-23, C-24) are metered by the South Florida Water Management District, whose data service requires credentials it issues, so the map draws them without animating their flow. The tide isn't gauged either: seawater drops show how far the salt reaches, from the two salinity stations, interpolated between them.
- On the Lake Okeechobee map, the Kissimmee (USGS stopped gauging it at the lake in 2004) and the West Palm Beach Canal (2008) are drawn without animated flow, and the lake's own level isn't in USGS's live data. Lake water drifting to the gates shows which way it's leaving, not its path.
- On the rain map, drops merge as streams join, so big rivers show fewer but heavier drops. The totals in the legend are measured by creek length, not by drop count.
