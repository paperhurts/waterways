# Where north Florida's water goes

Animated maps of the rivers, springs, and sinks between the Suwannee River and Gainesville: **[paperhurts.github.io/waterways](https://paperhurts.github.io/waterways/)**

- **Where does the rain go?** (`rain.html`) shows every mapped creek, colored by where its water ends up: the Gulf, the Atlantic via the St. Johns, a sink into the aquifer, or nowhere on the map. It also follows the Atlantic-bound water east past Orange Lake and Silver Springs, down the Ocklawaha, to the St. Johns at Lake George. Spring boils are sized by FDEP magnitude. Rain falls on every creek and flows downstream, faster on bigger rivers. Tap a creek to send a drop down its whole path. Tap a swallet to see where a creek goes underground and where it rises again.
- **The Santa Fe breathes groundwater** (`santa-fe.html`) animates river and spring flow from live USGS gauges. It shows the river vanishing at River Sink and returning at River Rise, dye traces from Gainesville's sinks, and an aquifer time slider that runs from before development to the present.

## Layout

```
index.html, rain.html, santa-fe.html   page shells (Vite entry points)
src/shared/     projection, pan/zoom viewport, streak renderer, lakes, theme tokens, data types
src/rain/       the rain map and its creek-network logic
src/santa-fe/   the Santa Fe map: flow model, aquifer grids, live gauges, authored content
public/data/    generated datasets the pages fetch at runtime
config/         hand-maintained inputs: gauges.json, sinks.json
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
| `streams.json` | NHDPlus HR network flowlines, NHD points, FGS swallets, FDEP springs, `config/sinks.json` | The study area is two boxes: the Suwannee–Gainesville basin, plus a corridor along the Atlantic route to Lake George. Flowlines are linked by `hydroseq`. A creek's fate follows NHDPlus routing (terminal path = Suwannee → Gulf, St. Johns → Atlantic). A network end within 600 m of a mapped sink is a sink; any other end is "inland". `acc` is the km of creek upstream. Multi-vent springs (Silver Spring #1–#12) merge into one spring, named from GNIS where NHD has a name. Each spring's magnitude is its own FDEP rating, never the group's. |
| `rivers.json` | NHDPlus HR | The main level path of each named river, trimmed to the map. Underground conduits (FType 420) are flagged per vertex. |
| `lakes.json` | NHDPlus HR waterbodies | Lakes ≥ 0.2 km² and wetlands ≥ 1.5 km², simplified. |
| `aquifer.json`, `contours.json` | FDEP/FGS Upper Floridan potentiometric surface layer; USGS daily discharge | Each surface is gridded at 0.01° by distance-weighting the two nearest contours of different elevation. Flows are monthly means. A gauge with no record that month is estimated from Fort White by its median same-month ratio (shown as "est."). |
| `snapshot.json` | USGS Water Data API, latest values | Fallback readings for when a visitor's browser can't reach USGS. |

## Deploy

`.github/workflows/deploy.yml` builds and publishes to GitHub Pages on every push to `main` and every six hours. Each run fetches fresh gauge readings into the deployed snapshot, and nothing is committed. GitHub pauses scheduled workflows in public repos after 60 days without commits. If the snapshot goes stale, re-enable the workflow from the Actions tab.

Pages must be set to deploy from **GitHub Actions** (Settings → Pages → Source).

## Data sources
- Streams, rivers, lakes, and sink/spring points: USGS NHDPlus High Resolution, [hydro.nationalmap.gov](https://hydro.nationalmap.gov/)
- River and spring discharge: [USGS Water Data API](https://api.waterdata.usgs.gov/) (instantaneous and daily values)
- Springs: FDEP Florida Springs layer
- Swallets: Florida Geological Survey swallet survey
- Aquifer: FDEP / FGS Upper Floridan Aquifer potentiometric surface, including the USGS pre-development and historic surfaces
- Dye traces: Karst Environmental Services, Mill Creek and Lee Sinks Dye Trace (2005), for Alachua County EPD

## Known limits
- Individual springs are mostly ungauged. Spring dots split each reach's measured gain evenly.
- Some historic flows are scaled from the Fort White gauge and marked "est.".
- Aquifer maps come from different agencies and methods at 10-ft contour intervals. Compare shapes between years, not single feet. The grid is less certain near its edges, which the map fades out.
- "Ends inland" can mean a sink, a closed wetland, a lake with no outlet, or a gap in the map.
- NHD routes Rose Creek and the Santa Fe through underground conduits, so their water counts toward the Gulf. The map labels the swallets where they go underground.
- On the rain map, drops merge as streams join, so big rivers show fewer but heavier drops. The totals in the legend are measured by creek length, not by drop count.
