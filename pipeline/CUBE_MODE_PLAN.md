# Plan: closed "cube mode" for the data-cube POC

Status: planned, not started (2026-11-04). Pick up from **Where things stand** below.

## The goal

Make the "Sample cube data" setting a closed demo mode for showing Jack. With it on, the app behaves as if the full bake existed, and only asks GBIF what a finished, fully baked version would still ask:

- **From GBIF, by key only:** names, photos, and one record's details. These can't sensibly be baked.
- **From the cubes:** every count, map (the world view too), chart, list and filter.
- **No silent fallback.** A filter the cubes can't answer is greyed out with a "Not in cube demo" label instead of quietly switching to GBIF.

The point is to remove the fuzzy line in today's version, where the source flips between cubes and GBIF depending on filters and zoom.

**How to explain it to Jack.** Instead of querying GBIF's API for every view and click, a monthly DuckDB job pre-counts GBIF's public snapshot into small Parquet cubes hosted free on Hugging Face. The browser fetches only the slices it needs (hyparquet, HTTP range requests) and filters and sums them itself, so the site stays static and hosting cost doesn't grow with users. DuckDB runs only in the bake, not in the browser. The demo uses a ~1% sample (100 of 10,346 parts): every number is an estimate scaled up from it, and record lists show only sampled records. A banner says so. Baking more parts makes the data denser, not more capable.

## Where things stand

- **Committed and pushed** (`1e5b2cb`): the map cube and the experimental setting, where the map's hexes come from the cubes for one taxon and/or whole years, zoomed in past the world view.
- **Done but NOT committed:** the hex panel from the cubes. This covers:
  - a cell cube and a records index in `bake_cubes.py`
  - `src/lib/cubes/{cell,cellBits,cellPanel,cellSummary,parquet,selected}.ts` and changes to `reader.ts`
  - the cube branch in `useHexSummary.ts` and `HexRecords.vue`
  - GBIF's lookup by key (`occurrencesByKeys`)
  - the hover tooltip skipping GBIF for cube hexes
  - footer lengths in the manifest
  - tests and the README

  Type check, lint and all 662 unit tests passed. **Commit this first** (`git status` lists it), then push from your own terminal.

- **Local sample:** `pipeline/cubes/` holds a 100-part bake _with_ the cell cube and records index (about 21 minutes to bake). The plan below needs one more re-bake for the new columns.
- **Servers for testing:** `node poc/serve.mjs` (cubes on port 4324), and the app started with `PUBLIC_CUBES_BASE=http://127.0.0.1:4324/pipeline/cubes/`. On PowerShell: `$env:PUBLIC_CUBES_BASE='…'; corepack pnpm dev --port 4322`.

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
