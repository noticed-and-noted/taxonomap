# Data cube pipeline

Turns GBIF's monthly occurrence snapshot (about 1 TB of Parquet on AWS Open Data, 10,346 parts in the 2026-11-01 snapshot) into pre-counted "data cubes" of a few GB, hosted free on a Hugging Face dataset repo. The browser then reads only the slice it needs, with HTTP range requests, instead of scanning raw records.

Nothing is downloaded to a laptop. A cheap spot instance in the bucket's own region streams the snapshot, counts it, uploads the result and switches itself off.

## Architecture

```
 GBIF snapshot (S3, us-east-1)                 Hugging Face dataset repo (free, CDN)          Browser
 occurrence/2026-11-01/occurrence.parquet/*    latest.json                                    1. latest.json, manifest.json
 ~1 TB, ~4 billion rows                        snapshots/2026-11-01/manifest.json             2. one file's footer (range request)
            │                                  snapshots/2026-11-01/map/res=*/rank=*/...      3. one or two row groups (range request)
            ▼                                  snapshots/2026-11-01/charts/rank=*/...         → counts by cell and year, in ms
 EC2 spot instance, same region ──── upload ──▶
 DuckDB: one scan, two GROUPING SETS,
 then roll up per rank and H3 resolution
```

1. **Scan once** (`bake_base`). DuckDB reads only the 14 columns it needs from S3 and counts records by full taxon path (kingdom to species) in two grouping sets: by year and H3 cell (resolution 5) for the map, and by year, month and basis of record for charts. The output is a local file of a few tens of GB.
2. **Roll up** (`bake_map`, `bake_charts`). From that file, one table per rank (life, kingdom … species) and per H3 resolution (2 to 5), so any taxon at any zoom is one lookup, never a sum over millions of rows in the browser.
3. **Lay out for range requests** (`write_sorted`). Rows are sorted by taxon, then cell, then year, in row groups of 50,000 rows. Taxa are dealt into buckets of contiguous names, one file per bucket (about 4M rows each). `manifest.json` lists each file's first and last taxon, so the browser knows which single file to open.
4. **Publish** (`upload_cubes.py`). The new snapshot folder goes up first, then `latest.json` is switched to it, then all but the last two snapshots are deleted. The app never sees a half-uploaded snapshot, and storage stays flat month to month.

### Cube schemas

| Cube   | Path                                     | Columns                                                         |
| ------ | ---------------------------------------- | --------------------------------------------------------------- |
| Map    | `map/res={2..5}/rank={rank}/bucket={n}/` | `kingdom`, `taxon`, `year`, `cell` (H3, UBIGINT), `records`     |
| Charts | `charts/rank={rank}/bucket={n}/`         | `kingdom`, `taxon`, `year`, `month`, `basisofrecord`, `records` |

`taxon` is the scientific name at that rank (`Life` for the whole-snapshot rank). `kingdom` tells apart the rare names used in two kingdoms. Map counts follow GBIF's maps: present records with coordinates and no geospatial issue. Chart counts include records without coordinates.

## What a sample run showed

Run against 2 and then 20 evenly spaced parts of the real 2026-11-01 snapshot (8.3 million records):

- **Counts are exact.** Every record is counted in both cubes; the map leaves out only those with no usable coordinates.
- **Output grows more slowly than input.** 8.5× the records gave 4.9× the cube bytes, because the same species, cells and years repeat. Projected to the whole snapshot, that is roughly **5 to 15 GB** of cubes (a pilot run will give the real figure).
- **Each query fetches very little.** Bytes read per query, after the manifest and file footer:

| Query                                 | Row groups | Fetched |
| ------------------------------------- | ---------- | ------- |
| One species, resolution 4 (blackbird) | 1          | 61 KB   |
| One species, resolution 5 (red fox)   | 1          | 141 KB  |
| A class, resolution 2 (birds)         | 2          | 182 KB  |
| A class, resolution 4 (birds)         | 9          | 659 KB  |
| Everything, resolution 2              | 2          | 126 KB  |
| Birds' year, month and basis chart    | 1          | 89 KB   |

At full scale the big taxa grow (all birds at resolution 4 could be a few MB), which is why the app should pick a coarser resolution when zoomed out, and filter by cell range when zoomed in. Within a taxon, rows are sorted by H3 cell, and the children of one cell are a contiguous number range, so a zoomed-in view can ask for `cell BETWEEN` a few ranges and skip the rest of the row groups.

- **Hugging Face serves range requests to browsers.** `huggingface.co/.../resolve/main/…` redirects to its CDN (`us.aws.cdn.hf.co`), which answers `206 Partial Content` with `Access-Control-Allow-Origin: *`.

## Running it

### A local test (any machine, a minute or two)

```bash
python -m venv .venv && . .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r pipeline/requirements.txt
python pipeline/bake_cubes.py --out pipeline/cubes --work pipeline/work --region eu-central-1 --parts 5
```

Pick the bucket region nearest you (`us-east-1`, `eu-central-1`, `sa-east-1`, `af-south-1`, `ap-southeast-2`).

### The full bake (EC2 spot, us-east-1)

1. Make a Hugging Face account, a public dataset repo (`your-org/taxonomap-cubes`) and a write token.
2. Launch a **spot** instance in **us-east-1** (the same region as the bucket, so reading 1 TB is fast and free): Ubuntu 24.04, an instance type with local NVMe and plenty of memory such as `r6id.8xlarge` (32 vCPU, 256 GB, 1.9 TB NVMe), and **Shutdown behavior: Terminate** under Advanced details.
3. Connect, clone this repo, and run a pilot first:

```bash
git clone https://github.com/jack-sandeman/taxonomap.git && cd taxonomap
tmux                                                   # survives a dropped connection
PARTS=200 POWER_OFF=0 HF_TOKEN=hf_... HF_REPO=your-org/taxonomap-cubes ./pipeline/run-on-ec2.sh
```

4. Check the pilot's timings and sizes, then run the whole snapshot (no `PARTS`). The instance terminates itself when the upload finishes.

**Cost.** Hosting is free: the site stays static, the cubes sit on Hugging Face, and record-level detail still comes from GBIF's API. The bake is the only bill, a few hours of spot time. Check the current spot price; at roughly $1–2 an hour, that is under $10 a run. Run it monthly, or less often: the counts barely move from one month to the next.

## Using it from the browser

`poc/cubes.html` is a pannable, zoomable map that routes each view to the cubes or to GBIF. It uses `hyparquet` (with `hyparquet-compressors` for zstd) and `h3-js` instead of DuckDB WASM: 148 KB of libraries rather than several MB.

```bash
node poc/serve.mjs                  # http://127.0.0.1:4324/poc/cubes.html, serving pipeline/cubes/
LATENCY_MS=260 node poc/serve.mjs   # the same, with Hugging Face's round trip added to every response
```

`serve.mjs` is a static server with range requests (Python's `http.server` has none). Point the page's "Cubes address" at a Hugging Face `resolve/main/` URL to test the real CDN.

The code is split so the app could take the reader and router as they are:

| Module                     | Job                                                                                                   |
| -------------------------- | ----------------------------------------------------------------------------------------------------- |
| `poc/cubes/router.js`      | Picks the source for the map and the charts                                                           |
| `poc/cubes/cube-reader.js` | `latest.json`, the manifest, one footer per file, then only the row groups for the taxon and the view |
| `poc/cubes/h3-ranges.js`   | Turns a view into ranges of H3 cell numbers, so row groups outside it are skipped                     |
| `poc/cubes/gbif.js`        | GBIF's tiles (parameters as in `src/lib/gbif/maps.ts`), name-to-key matching, and chart facets        |
| `poc/cubes/map-view.js`    | The plain longitude-latitude map: pan, zoom, H3 resolution by zoom, drawing cells or tiles            |
| `poc/cubes/charts.js`      | Chart sums and bars                                                                                   |
| `poc/cubes/main.js`        | Wiring, timings and the benchmark                                                                     |

**Routing.** The map goes to GBIF's ad hoc tiles for months or photos, and to its density tiles for record type (the map cube has neither), as the app already switches between density and ad hoc tiles. With no such filter, the world view without a year range also stays on GBIF's density tiles, which its tile cache usually answers; everything else comes from the cubes. Charts come from the charts cube unless photos are on, when GBIF's search facets (`facetMultiselect`) answer instead. "Source" on the page can force cubes or GBIF for an A/B.

**Only the cells in view.** Inside a taxon the cubes are sorted by H3 cell, and an H3 cell's children are a contiguous run of numbers. The page covers the view with cells two resolutions coarser plus a ring, turns each into its children's number range, and skips any row group (of a single taxon) whose cell statistics miss every range. In the 100-part sample that reads 4 of 8 row groups for birds over Europe at resolution 4, 6 of 21 for birds over Britain at resolution 5, and 10 of 18 for everything over Europe. With the full snapshot, big taxa have several times as many row groups, each spanning fewer cells, so the share skipped grows; smaller row groups for big taxa would sharpen it further.

`cell` is an H3 index as a 64-bit integer (a `BigInt` in JavaScript); `h3-js` takes it as hex, `cell.toString(16)`.

### Browser timings on a 100-part sample

Headless Chromium, served from localhost, 100 parts (42 million records, 305 MB of cubes). "First visit" starts from an empty cache; "years changed" then sets 2010–2019 on the same view.

| View                                    | First visit | Downloaded | Years changed |
| --------------------------------------- | ----------- | ---------- | ------------- |
| Everything, resolution 2                | 244 ms      | 275 KB     | 68 ms         |
| Birds, resolution 3                     | 457 ms      | 686 KB     | 162 ms        |
| Birds since 2020, resolution 4          | 933 ms      | 1.5 MB     | 515 ms        |
| Flowering plants (dicots), resolution 3 | 279 ms      | 670 KB     | 68 ms         |
| Blackbird, resolution 4                 | 173 ms      | 523 KB     | 30 ms         |
| Red fox, resolution 5                   | 189 ms      | 623 KB     | 22 ms         |

- **Network time here is localhost.** From Hugging Face's CDN, add a round trip per step (manifest once, then footer, then row groups): roughly 100–300 ms more on a first visit.
- **Most of the "local work" is drawing.** The page draws every cell on a canvas with `h3-js` outlines; summing is a few ms. In the app, MapLibre would draw on the GPU.
- **Footers are about a third of each download** (30–55 KB a file). Caching them, or fewer and larger row groups, would cut that.
- **Big taxa at fine detail are the slow case.** All birds at resolution 4 is 52,000 cells. The app should drop a resolution when zoomed out, and fetch only the cells in view when zoomed in.

### A/B against the live app

A is app.taxonomap.com today, which draws GBIF's map tiles (`api.gbif.org/v2/map/occurrence`), measured from the first tile request to the last, in a fresh browser each time. Run 1 hit GBIF's tile cache cold; runs 2 and 3 found the world views cached. B is `poc/cubes.html` served with `LATENCY_MS=260`, the measured warm round trip to Hugging Face (redirect plus CDN), from a 100-part sample.

| View                     | A first visit (3 runs)   | B first visit | A years changed        | B years changed |
| ------------------------ | ------------------------ | ------------- | ---------------------- | --------------- |
| Everything               | 4,044 / 210 / 198 ms     | ~690 ms       | 1,381 / 102 / 124 ms   | 43 ms           |
| Birds                    | 2,507 / 260 / 357 ms     | ~980 ms       | 592 / 103 / 97 ms      | 99 ms           |
| Birds since 2020, zoomed | 3,557 / 2,195 / 3,035 ms | ~1,440 ms     | 1,358 / 761 / 1,535 ms | ~360 ms         |
| Blackbird, zoomed        | 3,035 / 3,445 / 1,388 ms | ~920 ms       | 602 / 1,079 / 1,018 ms | 21 ms           |
| Red fox, zoomed          | 2,635 / 2,693 / 1,581 ms | ~920 ms       | 818 / 1,427 / 1,320 ms | 13 ms           |

- A downloads less (27–160 KB) because it fetches only the tiles in view; B fetched the whole world for the taxon (see the routed version below).
- B is a 1% sample. At full scale, rows per view grow 3–100× (about 1.6–2.5 bytes a row), so most views stay around 1 MB, but birds at resolution 4 grow to 3–5 MB. Fetching only the cells in view is what keeps that case fast.
- Range requests must use `fetch(…, { cache: 'no-store' })`: through the HTTP cache, Chromium lets one request per URL through at a time, which made parallel row-group reads take 4.6 s instead of 1.4 s.

### Routed, with only the cells in view

The same page after routing and viewport reads, two runs with `LATENCY_MS=260` (GBIF requests go over the real network; run 2 found GBIF's tiles warm from run 1). "Panned" moves half a view east after the year change.

| View                      | Source             | First visit    | Downloaded | Years changed                    | Panned      |
| ------------------------- | ------------------ | -------------- | ---------- | -------------------------------- | ----------- |
| Everything, world         | GBIF density tiles | 2,609 / 582 ms | 280 KB     | 648 / 644 ms (switches to cubes) | –           |
| Birds, world              | GBIF density tiles | 1,204 / 589 ms | 366 KB     | 624 / 615 ms (switches to cubes) | –           |
| Birds since 2020, Europe  | Cubes              | 993 / 1,009 ms | 1.1 MB     | 52 / 55 ms                       | 56 / 48 ms  |
| Blackbird, Europe         | Cubes              | 918 / 918 ms   | 523 KB     | 17 / 17 ms                       | 15 / 15 ms  |
| Red fox, Britain          | Cubes              | 920 / 842 ms   | 623 KB     | 8 / 8 ms                         | 9 / 8 ms    |
| Birds with photos, Europe | GBIF ad hoc tiles  | 649 / 201 ms   | 167 KB     | 430 / 84 ms                      | 273 / 65 ms |

- Panning within loaded ground costs no requests: neighbouring cells sit in row groups already read.
- The blackbird and fox download the same as before: in a 1% sample each fits in one row group, so there's nothing to skip. About half of each download is file footers (30–55 KB a file) and the charts cube.
- The page draws GBIF's PNG tiles; the app uses its smaller vector tiles, so its GBIF downloads are lower than these.

## In the app (experimental setting)

The app can draw its map hexes from the cubes, behind **Settings → "Sample cube data (experimental)"**. The setting only appears when the build has a cubes address (`PUBLIC_CUBES_BASE`), and is off until turned on, so nothing changes for anyone else.

To try it on a sample (about 5 minutes to bake, no cloud):

```bash
python -m venv .venv && . .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r pipeline/requirements.txt
python pipeline/bake_cubes.py --out pipeline/cubes --work pipeline/work --region eu-central-1 --parts 100
node poc/serve.mjs                                 # serves pipeline/cubes/ with range requests and CORS
PUBLIC_CUBES_BASE=http://127.0.0.1:4324/pipeline/cubes/ pnpm dev
```

Then open the map, turn the setting on under Settings, and pick a taxon (or a year range) and zoom in. A note under the header says when the cubes are drawing.

**What it draws from the cubes, and what stays on GBIF.** `src/lib/cubes/route.ts` decides per view, as the POC's router does. The cubes draw one taxon or all records, with or without a whole-years range, once zoomed in past the world view; with a years range, the world view too. Anything else stays on GBIF's tiles exactly as before: several taxa, "exact taxon", record type, photos or sound, months, publisher, IUCN, continent, uncertainty, date presets (they filter by date, not whole years), a subspecies (the cubes stop at species), and the plain world view, which GBIF's tile cache answers fastest. The hex panel's records and species lists still come from GBIF for whichever cell you click.

**How it fits.** `src/lib/map/cubeLayer.ts` has the same interface as the GBIF layer (`occLayer.ts`): it reads the H3 resolution for the map's grid level and only the cells in view, and hands over the same hex features, so the legend, colours, hover and the hex panel work unchanged. `src/lib/map/hexSource.ts` swaps between the two layers as the filters, zoom and setting change; the cube code (`hyparquet`, `h3-js`) loads only the first time the setting is on. If the cubes can't be read, the map goes back to GBIF and says so.

**Sample counts.** A sample's counts are scaled by `partsTotal / partsRead` from the manifest (about 103× for 100 parts) and labelled as estimates. Everywhere is covered, but thinly: rare species can be missing or patchy, so the sample shows speed and feel, not real numbers.

**Hosting.** With `PUBLIC_CUBES_BASE` on localhost the app calls no new third-party host. Pointing it at a hosted copy (a Hugging Face dataset, say) does, so the privacy and terms pages need to name that host first (see CLAUDE.md, "External requests").

## Why not re-bake the raw records too

The first idea was to also copy every raw record into a Hive-partitioned layout on Hugging Face. This plan leaves that out:

- **It doesn't fix the slow queries.** Partitioning only helps filters on the partition keys. A filter on anything else (a species within a year partition, a licence, a bounding box) still scans most of the terabyte, which is the "still pretty slow for queries with lots of records" problem.
- **It's over 1 TB.** Hugging Face hosts public datasets free on a best-effort basis. A few GB of cubes is ordinary use; a terabyte copy of data GBIF already hosts is the kind of upload they ask you to justify.
- **The app doesn't need it.** Record-level views (records in a hex, a record's page) list a page of records at a time, which GBIF's API already serves well. Cubes cover aggregates; the API covers individual records.

If raw partitions are still wanted later, the same scan can write them: `COPY (SELECT … FROM read_parquet($parts)) TO '…' (FORMAT parquet, PARTITION_BY (kingdom, year))`.

## Open questions before the app uses it

- **Taxon keys.** The app's taxon keys are GBIF backbone integers. The snapshot's own keys are new checklist IDs (`6G4MQ`), so the cubes key on names. The in-app version maps a key to its name and rank with the app's own `lookupTaxon` (the baked name index, then GBIF's species API). It doesn't use the kingdom yet, so a name used in two kingdoms would add both. Where the snapshot's taxonomy and the backbone disagree, counts will differ from GBIF's. Compare cube counts against the API for a sample of taxa before relying on them.
- **Filters the cubes don't cover.** Licence, publisher, photos or sound, coordinate uncertainty, IUCN status, continent, and month on the map. Each extra dimension multiplies the cube's size, so these should keep using GBIF's API and ad hoc tiles, as the app already does when `hasRefinements` is true.
- **H3 cell size.** The cube layer's H3 cells are about the size of GBIF's at each grid level, but not the same shape or exactly the same size, so switching source changes the grid slightly.
- **Shared IPs and rate limits.** Hugging Face limits anonymous `resolve` calls to 3,000 per 5 minutes per IP. That is ample for one person, but a school or a mobile carrier's shared IP pools many viewers. Each query costs a few calls (manifest, footer, row groups), so the app should cache the manifest and file footers.
- **New hosts.** The app would start calling `huggingface.co` and its CDN (`us.aws.cdn.hf.co`), sending each viewer's IP and the cube files they open, which reveals the taxa they look at. That needs the privacy and terms pages, and the service worker's cache rules, updated with it.
- **Citation.** GBIF's data use terms ask for the source to be cited. Registering the cubes as a GBIF derived dataset gives them a DOI that credits the snapshot.
