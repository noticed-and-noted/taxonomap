# Plan: closed "cube mode" for the data-cube POC

Status: built (2026-11-06). Cube mode is in the app as planned; see `pipeline/README.md`, "In the app: cube mode". What's left is under **Next** at the end.

## The goal

Make the "Sample cube data" setting a closed demo mode for showing Jack. With it on, the app behaves as if the full bake existed, and only asks GBIF what a finished, fully baked version would still ask:

- **From GBIF, by key only:** names, photos, and one record's details. These can't sensibly be baked.
- **From the cubes:** every count, map (the world view too), chart, list and filter.
- **No silent fallback.** A filter the cubes can't answer is greyed out with a "Not in cube demo" label instead of quietly switching to GBIF.

The point is to remove the fuzzy line in today's version, where the source flips between cubes and GBIF depending on filters and zoom.

**How to explain it to Jack.** Instead of querying GBIF's API for every view and click, a monthly DuckDB job pre-counts GBIF's public snapshot into small Parquet cubes hosted free on Hugging Face. The browser fetches only the slices it needs (hyparquet, HTTP range requests) and filters and sums them itself, so the site stays static and hosting cost doesn't grow with users. DuckDB runs only in the bake, not in the browser. The demo uses a ~1% sample (100 of 10,346 parts): every number is an estimate scaled up from it, and record lists show only sampled records. A banner says so. Baking more parts makes the data denser, not more capable.

## Decisions made while building

- **One map cube, not two.** Adding month and record type grew the map cube 1.4 to 3 times per rank and resolution on the sample (measured on the slim records table before baking), under the 5× threshold, so it gained the columns. Baked, it went from 287 MB to 560 MB.
- **Unsupported filters are cleared** on entering cube mode (and if a link sets one while it's on), and the banner names them. Their controls stay visible but greyed out with a "Not in cube demo" tag.
- **Tree of life and species pages count from the cubes too** (added after a first version left them out): the tree's record counts at every level, and a species page's count, years, months, mini-map and similar species. Taxonomy (a node's children, species counts under it) still comes from GBIF's species API, like names. Top countries and datasets are greyed out. Pre-built species pages hand over to `/species/view` in cube mode.
- **A lean map cube** (taxon, year, place) for views with no month, record type or media filter, a preloaded `latest.json`, the first view read as the map starts, a quick taxon lookup, and cell footers fetched ahead of a click. Cube mode is now quicker or level everywhere except world-view first visits (about 0.5 s behind GBIF's cached tiles).
- **First-visit speed-ups**: neighbouring row groups in one request, the manifest inside `latest.json`, and the cubes opened as the map component mounts. Zoomed first visits are now quicker than GBIF's tiles; cached world views are still quicker from GBIF (see the README's A/B).
- **Near me uses resolution-5 hexes** (about 8 km) whose centres fall in the circle, plus the pin's own; the cubes hold nothing finer.
- **Nested taxa** (birds and blackbird) count twice on the map, which reads each taxon separately; noted as an open question.

## What works in cube mode (target)

| Surface                                                                                    | Today with the setting on                    | Target                                                                                                                |
| ------------------------------------------------------------------------------------------ | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Map, zoomed in, one taxon, years                                                           | Cubes                                        | Cubes                                                                                                                 |
| Map, world view                                                                            | GBIF tiles                                   | Cubes (map cube res 2; measured about 0.25 s earlier)                                                                 |
| Map, several taxa                                                                          | GBIF                                         | Cubes: one map-cube read per taxon, summed per cell                                                                   |
| Record type, has photo / sound, months                                                     | GBIF ad hoc tiles                            | Cubes: new columns (see the bake section)                                                                             |
| Hex panel (count, months, classes, species, groups, records)                               | Cubes for cube hexes                         | Cubes always                                                                                                          |
| Records tab species search (species outside the top 200)                                   | GBIF search on the cell                      | The cell cube's rows                                                                                                  |
| "When" year chart (`useYearHistogram`)                                                     | GBIF facet                                   | Charts cube (taxon × year, with month, basis and media)                                                               |
| Search preview counts (`TaxonPreview.vue`)                                                 | GBIF facet per hit                           | Charts cube total for the hit's taxon                                                                                 |
| Near me (`lib/near/data.ts`)                                                               | GBIF facets on a circle                      | Cell cube: the res-5 cells whose centres fall in the circle (`gridDisk`), summed like the panel                       |
| Tree of life (`lib/tree/model.ts`)                                                         | Baked tree; live facets within an area       | Decide: baked counts are fine (not live requests); grey out "within this area" in cube mode, or use the cell cube     |
| Species page (`lib/species/data.ts`)                                                       | Pre-rendered at build, plus some live facets | Leave as is (build-time data); check `SpeciesView.vue` for live calls and route them to the charts cube or label them |
| Publisher, IUCN, coordinate uncertainty, exact taxon, subspecies, day-precise date presets | GBIF                                         | Greyed out: "Not in cube demo"                                                                                        |

Allowed GBIF calls in cube mode: name search and suggest, the baked name index, species and taxon lookups by key (`lookupTaxon`), photo lookups (iNaturalist and GBIF media), `occurrencesByKeys`, and `getOccurrence`. Anything else counts as a leak.

## The bake (`pipeline/bake_cubes.py`)

1. **`extract_records`:** also read `mediatype` (VARCHAR[]) and write `media` as a TINYINT bit mask: 1 = has `StillImage`, 2 = has `Sound`. `basisofrecord` and `month` are already there.
2. **`bake_base`:** add `basisofrecord` and `media` to the map grouping set: `({path}, specieskey, year, month, basisofrecord, media, cell)`. The charts set gets `media` too. One grouping set may now be enough; check whether `is_map` can become `cell IS NOT NULL`.
3. **Map cube:** add `month`, `basisofrecord` and `media` columns. Keep the sort as taxon, kingdom, cell, year. **Measure the size first** on the sample, using `records.parquet` as in `growth.py`: count distinct rows with and without the new columns for res 2 and res 4. If the map cube grows more than about 5×, split it into the current lean cube (used when no extra filter is set) plus a filtered cube with the extra columns (used only when record type, media or months are set). Decide from the numbers.
4. **Cell cube:** add `basisofrecord` and `media`.
5. **Records index:** add `month`, `basisofrecord` and `media`, so pages can filter on them.
6. **Charts cube:** add `media`.
7. **Re-bake** the 100-part sample and record the timings and sizes in the README. I guess 30–40 minutes; measure it. Update the full-snapshot size projections (currently map 5–15 GB, cell about 3 GB, records about 35 GB).

## The app

### A cube-mode switch everyone can read

- `src/stores/cubes.ts`: add a derived `$cubeMode` (setting on and `CUBES_BASE` set). It already has `$cubesOn` and `$openCubes`.
- `src/lib/cubes/filters.ts` (new): one source of truth for which filters cube mode supports.
  - `cubeFilterSupport(field)` returns `'cubes' | 'not-in-demo'`.
  - `stripUnsupported(filter)` drops unsupported fields defensively.
  - Supported: `taxonKey`, `taxonKeys` (several), `year`, `months`/`month`, `basisOfRecord`, `hasImage`, `hasSound`, `classKey` and `speciesKeys` (panel internals), `geometry` (only as a cube cell or near circle).
  - Not supported: `publishers`, `iucn`, `maxUncertaintyM`, `exactTaxon`, `continents`, `eventDate`, `country`, `datasetKey`, and subspecies (a taxon at a rank below species).
- When cube mode turns on with unsupported filters set, clear them, or keep them in the URL but show them greyed and ignored. Clearing with a short notice is simplest.

### Routing (`src/lib/cubes/route.ts`, `src/lib/map/hexSource.ts`)

- `cubesCanServe` becomes "always" in cube mode. Remove `WORLD_MAX_ZOOM` routing to GBIF, and keep the whole-world read (null ranges) at zoom < 2.5.
- `CubeQuery` gains `taxa: {rank, taxon}[]` (several), `months`, `basis` and `media`. `cubeQueryFor` looks up every key. A subspecies is unsupported (greyed out), so it never reaches routing.
- `hexSource`: in cube mode, never create the GBIF layer. If the cubes can't be read, show an error state ("Cube data unavailable: is `node poc/serve.mjs` running?") instead of falling back. Outside cube mode, unchanged.
- `reader.mapRows`: one read per taxon, filtered by months, basis and media, summed in `cubeLayer.sumCells`. Rows now carry `month`, `basisofrecord` and `media`.

### Filtering shared by all cube consumers

- Extend `matchesQuery` (`cellSummary.ts`) to cover several taxa, months, basis and media. The map, cell panel, records and Near me all use it.

### Panel leftovers

- `useCellNameSearch.ts` `countInArea`: in cube mode, count the candidates from the cell's cube rows (`speciesCounts` restricted to their keys) instead of a GBIF facet.
- `useHexSummary` / `HexRecords`: in cube mode, no GBIF fallback; a failure shows the error.

### Year chart, previews, Near me

- `useYearHistogram.ts`: in cube mode, read the charts cube for the taxon (or taxa) and sum by year with the month, basis and media filters. This needs a `chartRows(query)` reader method (the charts cube is taxon-sorted like the map cube, so reuse `groupsFor` and `filesFor`).
- `TaxonPreview.vue`: total from the charts cube (sum of a taxon's rows) instead of `occurrenceFacets`.
- `lib/near/data.ts`: in cube mode:
  - The cells in the circle come from h3-js (`gridDisk` around the pin's res-5 cell, keeping cells whose centre lies within the radius). Load lazily, as `MapCanvas.loadCubes` does.
  - Read their cell-cube rows (`cellRows` per cell, or a range read).
  - Feed `summariseCell` and `speciesCounts`; classes and species are named through `namedClasses` and `topSpecies` as in `cellPanel.ts`.
  - Near me's records list is `HexRecords` with a `filter` prop. In cube mode, give it the circle's cells and page the records index over several ranges. `recordPage` needs to take a list of ranges.

### UI

- **Banner** (replaces the current `role="status"` note in `MapCanvas.vue`): "Cube demo: 1% sample of GBIF's 2026-11-01 snapshot, counts are estimates." Take the share and snapshot date from `CubeSet`. Use design tokens, both themes.
- **Greyed filters:** in the filter rail flyouts (`src/components/organisms/filters/*`) and the phone filters sheet, disable unsupported controls in cube mode with a small "Not in cube demo" label. Never hide them, so the gap is visible. Follow `docs/design-system.md`: tokens, sentence case, and colour is never the only cue.
- The settings checkbox label could become "Cube demo (sample data)".

## Tests

- New cases for:
  - `filters.ts`
  - routing in cube mode (always cubes, no GBIF layer, an error state on failure)
  - several taxa and the new columns in `matchesQuery`, `sumCells` and `reader`
  - `chartRows`
  - the year chart, preview and Near me cube branches
  - the cell name search
- Keep `src/lib/**` and `src/stores/**` new files at 100% coverage. The folder-wide thresholds already failed before this work on untouched files.
- **A "no leaks" browser check.** A Playwright script (see the scratch `panel-click.cjs` from the last session for the pattern) runs with cube mode on. It visits the world view, several taxa, record type, photos, months, a hex click with its records, Near me, the year chart and a search preview. It fails if any request goes to GBIF outside the allowed list (map tiles `/v2/map`, `occurrence/search` with `geometry=`, GraphQL with a polygon or facets, and so on).
- Then run `corepack pnpm check`, `corepack pnpm lint` and `corepack pnpm test` (see the Windows notes in memory: Node 22.16, corepack pnpm).

## Then

- **Request-only A/B tables** (the user asked for these). Time only the data each mode fetches for a click and a view (GBIF facet and search versus cube footer, rows and the lookup by key), locally and with `LATENCY_MS=260`. Add them to the README beside the existing tables. Use Resource Timing or time the requests directly, so panel drawing isn't counted.
- Update `pipeline/README.md`: the closed-mode rule, the supported and greyed lists, new sizes and timings.
- A message to Jack: re-bake (the command is unchanged), turn on the setting, and the rule above.

## Open decisions

- Split the map cube in two or not: decide from the size measurement (bake step 3).
- Tree of life "within an area": grey it out, or use the cell cube.
- Turning cube mode on with unsupported filters set: clear them with a notice (simplest), or keep them shown as ignored.

## Next

- Request-only A/B tables: done (README, "A/B: cube mode against the app as it is").
- Shrink the full bake: the ideas below, measured on the 100-part sample before adopting any.

## Shrinking the bake

Ideas for the same data in fewer bytes, safest first. The savings are estimates, not measurements.

| Idea                          | What it means                                                                                                                  | Rough saving                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| Numbers instead of names      | Rows repeat the full taxon path as text; store the species key and look the path up in the taxonomy file the app already ships | 30–50% on the cell cube and records index, and much smaller footers |
| Narrower number types         | Counts fit in 32 bits, years in 16, a resolution-5 cell in 32 as an index                                                      | 10–30%                                                              |
| Delta encoding                | Sorted cell IDs and record keys stored as small differences (Parquet v2 in DuckDB)                                             | 10–30% on sorted columns                                            |
| Maximum compression           | zstd level 19 instead of 3: a slower bake, the same read speed                                                                 | 5–15%                                                               |
| Cap the records index         | Keep the newest ~1,000 records per hex (or per hex and species); the panel shows the true total from the cell cube             | ~35 GB to a few GB                                                  |
| Coarser old data              | Decades instead of years before 1950                                                                                           | Fewer rows where data is sparse                                     |
| Colour bands on the map       | The map needs only a colour band (one byte), with exact counts in the cell cube                                                | Up to 8× on the map cube's counts                                   |
| Pack a record into one number | Cell, species, year, month and flags in one 64-bit integer, sorted and delta-encoded                                           | 3–4 bytes a record instead of about 10                              |
| Upload only what changed      | Most counts barely move month to month                                                                                         | Less upload time and old-snapshot storage                           |

Start with numbers instead of names, narrower types with delta encoding, and capping the records index: together perhaps 50–70 GB down to 15–25 GB for a full bake, with the same app behaviour.
