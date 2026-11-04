# Data cube pipeline

Turns GBIF's monthly occurrence snapshot (about 1 TB of Parquet on AWS Open Data, 10,346 parts in the 2026-11-01 snapshot) into pre-counted "data cubes", hosted free on a Hugging Face dataset repo. The browser then reads only the slice it needs, with HTTP range requests, instead of scanning raw records or asking GBIF to search an area.

There are four: the **map** and **charts** cubes, sorted by taxon, for the hexes and charts; and the **cell** cube and **records index**, sorted by place, for the panel that opens when you click a hex (its count, months, classes, species and records list).

Nothing is downloaded to a laptop. A cheap spot instance in the bucket's own region streams the snapshot, counts it, uploads the result and switches itself off.

## Architecture

```
 GBIF snapshot (S3, us-east-1)                 Hugging Face dataset repo (free, CDN)          Browser
 occurrence/2026-11-01/occurrence.parquet/*    latest.json                                    1. latest.json, manifest.json
 ~1 TB, ~4 billion rows                        snapshots/2026-11-01/manifest.json             2. one file's footer (range request)
            │                                  snapshots/2026-11-01/map/res=*/rank=*/...      3. one or two row groups (range request)
            ▼                                  snapshots/2026-11-01/charts/rank=*/...         → counts by cell and year, in ms
 EC2 spot instance, same region ──── upload ──▶ snapshots/2026-11-01/cells/res=*/...           → a clicked hex's panel
 DuckDB: one scan to a slim local table,       snapshots/2026-11-01/records/...               → its records, by key
 then count, roll up and sort
```

1. **Scan once** (`extract_records`). DuckDB reads only the columns it needs from S3 and writes one slim local row per present record: its GBIF key, taxon path (kingdom to species), species key, year, month, basis of record and H3 cell (resolution 5, or none without usable coordinates).
2. **Count** (`bake_base`). From that table, record counts by full taxon path in two grouping sets: by species, year, month and cell for the map and cell cubes, and by year, month and basis of record for charts.
3. **Roll up** (`bake_map`, `bake_charts`, `bake_cells`). One table per rank (life, kingdom … species) and per H3 resolution (2 to 5) for the map, so any taxon at any zoom is one lookup; and one per resolution for the cell cube, which keeps the taxon path so the panel can filter by any taxon.
4. **Index the records** (`bake_records`). One row per mapped record, sorted by its resolution-5 cell, newest first. The descendants of any coarser cell are one contiguous run of cell numbers, so this one index pages a hex's records at any zoom.
5. **Lay out for range requests** (`write_sorted`). The map and chart cubes are sorted by taxon, then cell, in row groups of 50,000 rows; the cell cube and records index by cell, in smaller row groups (20,000 and 10,000) so a click downloads little beyond its own cell. Keys are dealt into buckets of contiguous values, one file per bucket. `manifest.json` lists each file's first and last key and its footer's length, so the browser opens the one file it needs and reads its footer in one request.
6. **Publish** (`upload_cubes.py`). The new snapshot folder goes up first, then `latest.json` is switched to it, then all but the last two snapshots are deleted. The app never sees a half-uploaded snapshot, and storage stays flat month to month.

### Cube schemas

| Cube          | Path                                     | Columns                                                                              |
| ------------- | ---------------------------------------- | ------------------------------------------------------------------------------------ |
| Map           | `map/res={2..5}/rank={rank}/bucket={n}/` | `kingdom`, `taxon`, `year`, `cell` (H3, UBIGINT), `records`                          |
| Charts        | `charts/rank={rank}/bucket={n}/`         | `kingdom`, `taxon`, `year`, `month`, `basisofrecord`, `records`                      |
| Cell          | `cells/res={2..5}/bucket={n}/`           | `cell`, taxon path (`kingdom` … `species`), `specieskey`, `year`, `month`, `records` |
| Records index | `records/bucket={n}/`                    | `cell` (resolution 5), `gbifid`, taxon path, `specieskey`, `year`                    |

`taxon` is the scientific name at that rank (`Life` for the whole-snapshot rank). `kingdom` tells apart the rare names used in two kingdoms. Map, cell and records counts follow GBIF's maps: present records with coordinates and no geospatial issue. Chart counts include records without coordinates. `specieskey` is GBIF's backbone species key (the snapshot's own column), which the app's species pages and names use.

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

### The cell cube and records index, on a 100-part sample

The 100-part sample (about 36 million mapped records) took about 21 minutes to bake on a laptop: 3½ minutes reading S3, 7½ for the cell cube and 6 for the records index, which are mostly sorting.

| Cube          | Rows                        | Size   | Full snapshot (projected) |
| ------------- | --------------------------- | ------ | ------------------------- |
| Map           |                             | 287 MB | 5–15 GB                   |
| Cell, res 2–5 | 12–25 million per res       | 416 MB | about 3 GB                |
| Records index | 36 million (one per record) | 345 MB | about 35 GB               |

- **The records index grows with the data**: about 10 bytes a record, so about 35 GB for the 3.6 billion mapped records in a full snapshot.
- **The cell cube grows much more slowly**, because the same species, cells and months repeat. On a tenth of the sample and then all of it, 10× the records gave 5× the rows at resolution 2 and 8× at resolution 5, and that growth slows as data fills in, so about 3 GB is an upper estimate.
- **File footers are 30–250 KB** (many small row groups). The manifest gives each footer's length, so the browser reads it in one request, once per file per visit.

## Running it

### A local test (any machine, a few minutes)

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

**Cost.** Hosting is free: the site stays static, the cubes (about 45–55 GB in all, with the records index) sit on Hugging Face, and each record's full detail still comes from GBIF's API, looked up by key. The bake is the only bill, a few hours of spot time; the records index needs a scratch disk big enough to sort every mapped record (the `r6id` instance's 1.9 TB NVMe is ample). Check the current spot price; at roughly $1–2 an hour, that is under $10 a run. Run it monthly, or less often: the counts barely move from one month to the next.

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

To try it on a sample (about 20 minutes to bake 100 parts on a laptop, no cloud; `--parts 5` takes a few minutes but is very thin):

```bash
python -m venv .venv && . .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r pipeline/requirements.txt
python pipeline/bake_cubes.py --out pipeline/cubes --work pipeline/work --region eu-central-1 --parts 100
node poc/serve.mjs                                 # serves pipeline/cubes/ with range requests and CORS
PUBLIC_CUBES_BASE=http://127.0.0.1:4324/pipeline/cubes/ pnpm dev
```

Then open the map, turn the setting on under Settings, and pick a taxon (or a year range) and zoom in. A note under the header says when the cubes are drawing. Click a hex to open its panel from the cubes too.

**What it draws from the cubes, and what stays on GBIF.** `src/lib/cubes/route.ts` decides per view, as the POC's router does. The cubes draw one taxon or all records, with or without a whole-years range, once zoomed in past the world view; with a years range, the world view too. Anything else stays on GBIF's tiles exactly as before: several taxa, "exact taxon", record type, photos or sound, months, publisher, IUCN, continent, uncertainty, date presets (they filter by date, not whole years), a subspecies (the cubes stop at species), and the plain world view, which GBIF's tile cache answers fastest.

**The hex panel.** A hex drawn from the cubes carries its H3 cell, and its panel reads the cubes as well, so a click asks GBIF to search nothing:

- **Count, months, classes and species** come from one read of the cell's rows in the cell cube (`src/lib/cubes/cellPanel.ts`, `cellSummary.ts`). The count and months show at once; the lists follow once named (the baked name index, as for GBIF's facets). Picking a class re-counts the same rows, with no request.
- **Records** page through the records index (`src/lib/cubes/cell.ts`): the cell's descendants at resolution 5 are one range, read a row group at a time until the page is full. The page's records then come from GBIF in one lookup by key (`occurrence/search?gbifId=…`), for their photos, dates and details, in the index's order (newest first per place).
- **The map's hover tooltip** shows a cube hex's own count and doesn't ask GBIF for an exact one.
- A hex from GBIF's tiles, a filter the cubes don't hold, or cubes that can't be read all fall back to GBIF's searches, as before.

What still reaches GBIF from the panel: the lookup by key above, the existing per-row name and photo lookups (the same as with the setting off), and the records tab's species search when you type a species outside the cell's top 200, which still counts it with a search on the cell.

Measured in the dev server against GBIF (cubes served locally, so without a CDN's round trip), clicking a hex in the middle of the view, two runs each:

| Hex                         | Count shown (cubes / GBIF) | Species list (cubes / GBIF) | Records tab (cubes / GBIF) | GBIF area searches per click (cubes / GBIF) |
| --------------------------- | -------------------------- | --------------------------- | -------------------------- | ------------------------------------------- |
| Birds, London               | 0.65–0.70 s / 0.84–1.09 s  | 0.66–0.71 s / 1.14–1.37 s   | 0.37–0.56 s / 0.35–0.73 s  | 0 / 3                                       |
| Everything 2000–2025, Paris | 0.73–0.79 s / 0.61–0.89 s  | 0.73–0.79 s / 1.07–1.43 s   | 0.40–0.60 s / 0.33–1.78 s  | 0 / 3                                       |
| Red fox, Britain            | 0.65–0.68 s / 0.62–0.69 s  | 0.65–0.68 s / 0.62–0.69 s   | 0.51–0.55 s / 0.34–0.70 s  | 0 / 3                                       |

- **Most of the 0.6–0.7 s is the panel itself**: the same three ~190 ms main-thread tasks run in both modes in the dev build. The cube reads underneath take about 10 ms once a file's footer is loaded.
- **The species list arrives with the count** from the cubes, against 0.3–0.5 s later from GBIF, and picking a class needs no request at all.
- **Hosted, each cube step adds one CDN round trip** (about 260 ms from Europe to Hugging Face's US CDN): the first click into a file reads its footer and then the cell's rows, later clicks only the rows. The records tab adds GBIF's lookup by key.
- **The counts differ** from GBIF's because the H3 cell isn't GBIF's hex (different shape and size at each level), and a sample's counts are scaled estimates.

**How it fits.** `src/lib/map/cubeLayer.ts` has the same interface as the GBIF layer (`occLayer.ts`): it reads the H3 resolution for the map's grid level and only the cells in view, and hands over the same hex features, so the legend, colours, hover and the hex panel work unchanged. `src/lib/map/hexSource.ts` swaps between the two layers as the filters, zoom and setting change; the cube code (`hyparquet`, `h3-js`) loads only the first time the setting is on. If the cubes can't be read, the map goes back to GBIF and says so.

**Sample counts.** A sample's counts are scaled by `partsTotal / partsRead` from the manifest (about 103× for 100 parts) and labelled as estimates. Everywhere is covered, but thinly: rare species can be missing or patchy, so the sample shows speed and feel, not real numbers.

**Hosting.** With `PUBLIC_CUBES_BASE` on localhost the app calls no new third-party host. Pointing it at a hosted copy (a Hugging Face dataset, say) does, so the privacy and terms pages need to name that host first (see CLAUDE.md, "External requests").

## Why a records index, not the raw records

The first idea was to also copy every raw record into a Hive-partitioned layout on Hugging Face. This plan bakes a slim records index instead:

- **Raw partitions don't fix the slow queries.** Partitioning only helps filters on the partition keys. A filter on anything else (a species within a year partition, a licence, a bounding box) still scans most of the terabyte, which is the "still pretty slow for queries with lots of records" problem.
- **Raw is over 1 TB.** Hugging Face hosts public datasets free on a best-effort basis. Tens of GB of cubes is ordinary use; a terabyte copy of data GBIF already hosts is the kind of upload they ask you to justify.
- **The index is what a click needs.** A hex's records list needs to know which records sit in the hex; the index answers that by place in one range read, at about 10 bytes a record. Everything else about a record (photos, people, dates, licence) comes from GBIF by key, a cheap, cacheable lookup rather than a search.

If raw partitions are still wanted later, the same scan can write them: `COPY (SELECT … FROM read_parquet($parts)) TO '…' (FORMAT parquet, PARTITION_BY (kingdom, year))`.

## Open questions before the app uses it

- **Taxon keys.** The app's taxon keys are GBIF backbone integers. The snapshot's own keys are new checklist IDs (`6G4MQ`), so the cubes key on names. The in-app version maps a key to its name and rank with the app's own `lookupTaxon` (the baked name index, then GBIF's species API). It doesn't use the kingdom yet, so a name used in two kingdoms would add both. Where the snapshot's taxonomy and the backbone disagree, counts will differ from GBIF's. Compare cube counts against the API for a sample of taxa before relying on them.
- **Filters the cubes don't cover.** Licence, publisher, photos or sound, coordinate uncertainty, IUCN status, continent, and month on the map. Each extra dimension multiplies the cube's size, so these should keep using GBIF's API and ad hoc tiles, as the app already does when `hasRefinements` is true.
- **Records filtered by a rare taxon in a big hex.** The records index is sorted by place, not taxon, so listing a rare species' records in a resolution-2 hex reads row groups until it finds 20. In a full bake that could mean many row groups for a species with few records there. Sorting by place then taxon, or capping how far a page reads, would bound it.
- **The records tab's species search** still counts a typed species outside the cell's top 200 with a GBIF search on the cell. The cell cube's rows could answer it instead.
- **H3 cell size.** The cube layer's H3 cells are about the size of GBIF's at each grid level, but not the same shape or exactly the same size, so switching source changes the grid slightly.
- **Shared IPs and rate limits.** Hugging Face limits anonymous `resolve` calls to 3,000 per 5 minutes per IP. That is ample for one person, but a school or a mobile carrier's shared IP pools many viewers. Each query costs a few calls (manifest, footer, row groups), so the app should cache the manifest and file footers.
- **New hosts.** The app would start calling `huggingface.co` and its CDN (`us.aws.cdn.hf.co`), sending each viewer's IP and the cube files they open, which reveals the taxa they look at. That needs the privacy and terms pages, and the service worker's cache rules, updated with it.
- **Citation.** GBIF's data use terms ask for the source to be cited. Registering the cubes as a GBIF derived dataset gives them a DOI that credits the snapshot.
