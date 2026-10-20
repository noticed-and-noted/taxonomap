# Features

How each part of the app works. See [architecture](architecture.md) for the code layout.

## Map explorer

- **Density layer.** GBIF hex-binned **vector** tiles (`.mvt`), styled on the client so the legend matches exactly and cells can be queried on click. Because a cell covers more ground when zoomed out, the log-scale bins scale by 4^(6 − zoom) and the legend shows the bins for the current zoom (`src/lib/ramp.ts`). Viridis ramp, colour-blind safe.
- **Filter rail.** A vertical rail on the map's left edge groups the filters: What (up to 10 species or groups of any rank, records of any shown; IUCN Red List category), When (years, months), Where (continent, maximum coordinate uncertainty), How recorded (record type, has photo, has sound) and Source (licence). Each icon opens its group in a flyout that stays open beside the cell panel; badges count the active filters per group. On the map, the omnibox adds to the What list rather than replacing it; on the tree and species pages, which follow one taxon, it replaces it. More than one taxon needs `adhoc` tiles (density rejects a repeated `taxonKey`).
- **Density vs adhoc tiles.** Density tiles honour only taxon, year and record type. Any other filter (`refinementParams` in `src/lib/gbif/occurrence.ts`) switches the layer to `adhoc` tiles.
- **Basemaps.** Plain is an OpenFreeMap vector style (`dark` / `positron`, following the theme) with its labels drawn above the data and roads/rivers hidden below zoom 8. Satellite is EOX Sentinel-2 cloudless (CC BY-NC-SA). All are keyless; CARTO now returns "API key required" tiles.
- **Omnibox.** The baked common-name index answers instantly, ranked by record count. Live GBIF suggest (scientific names) and vernacular search are debounced by 250 ms. Place search runs only on Enter.
- **Time slider.** Its histogram comes from `/data/years.json` and goes live (one facet request) when other filters apply. It commits on release, so each change is one history step.
- **Hex panel.** One facet request (count, classes, months), then one species facet per class for the 8 most-recorded classes (top 25 each, 2 at a time, since the baked data has no species → class mapping), and names from the index plus one batched record search. Photos (each species' lead photo, the same one its species page leads with) and any names still missing are looked up only as rows scroll into view (all rows once you sort by name or search). Sorting and filtering the table make no requests; selecting another cell aborts the previous load. "Show individual records" loads up to 300 records as clustered points. Selecting a point shows the record with its dataset, publisher and licence.
- **Mobile.** The rail is hidden; every filter group and the basemap stack in a bottom sheet with three snap points.
- **Photos** are looked up in the browser, never at build (`src/lib/photos/`). A taxon's photo list, best first and up to 20, takes from these sources in turn, skipping duplicates and photos without an open licence:
  1. iNaturalist's curated photos for the taxon (the ones its own taxon page shows),
  2. iNaturalist's most-voted research-grade observations,
  3. GBIF photos: the iNaturalist dataset first, then every dataset.

  The **lead photo** shown on every card, preview and panel is that list's first photo, found with the same requests, so a preview always matches the first photo on the taxon's page. GBIF taxa are matched to iNaturalist in this order: an ID already known (baked into the name index for its species, or remembered by this browser in `localStorage` under `inat-ids`), then the iNaturalist taxon ID on GBIF's copies of iNaturalist records (species five to a search, then one by one for those the batch left out, since a species with many records crowds the rest out of a bigger page), climbing to the ancestor at the taxon's rank when a record is of a subspecies, or of a species for a genus. A species GBIF holds no record of is searched for by scientific name on iNaturalist (one request each, in the throttle below), when its name is known; taxa with no match use the GBIF photos. The name index only helps once it has loaded, so a species page, which doesn't load it, finds the same taxon through the records. Cards ask for iNaturalist taxa 30 to a request. iNaturalist requests are throttled to short bursts then about one a second, as iNaturalist asks.

- **Photo sizes.** GBIF photos use GBIF's image cache (`/v1/image/cache/{size}/occurrence/{key}/media/{md5(identifier)}`), about 19 KB instead of a 145 KB original; iNaturalist photos use iNaturalist's own sizes (small, medium, large).

## Caching strategy

| Layer                         | What                | Policy                                                                                                                                                                                                                                |
| ----------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| In-memory (browser and build) | GBIF JSON           | Params normalised (sorted keys, bbox 2 dp, radius snapped to 1/2/5/10/25/50 km, geolocation 3 dp); one in-flight promise per URL; LRU (300 in browser, 5000 at build) with per-endpoint TTL                                           |
| Retry                         | 429 / 5xx / network | Up to 3 retries with exponential back-off plus jitter, honouring `Retry-After`. After that a stale cached copy is served with a quiet "data may be out of date" note; if there is none, a typed error the UI maps to a friendly state |
| Service Worker (`dist/sw.js`) | GBIF JSON           | Cache-first, 24 h, 300 entries                                                                                                                                                                                                        |
|                               | Map tiles           | Cache-first, 7 days, 2000 entries                                                                                                                                                                                                     |
|                               | Images              | Cache-first, 30 days, 300 entries                                                                                                                                                                                                     |
|                               | Basemaps            | Cache-first, 30 days, 1500 entries (OpenFreeMap tiles, styles, sprites and glyphs; EOX)                                                                                                                                               |
|                               | App shell           | Precached (main routes, JS/CSS, Latin font subsets, baked data)                                                                                                                                                                       |
| Build disk cache              | `.cache/gbif/`      | Keyed by URL hash. Concurrency 5. CI persists it with `actions/cache`, so nightly builds are incremental                                                                                                                              |
| Cloudflare Pages              | `_astro/*`          | Immutable; see `public/_headers`                                                                                                                                                                                                      |

## Species pages

- **Pre-rendered pages.** `/species/{key}/{slug}` is built for `SPECIES_PRERENDER_COUNT` species (default 2000; 12 in dev). They are chosen by record count, with a quota for each major class (birds, insects, flowering plants, mammals, fungi and so on), so the set isn't nearly all birds (`src/lib/bake/species-list.ts`).
- **Fallback page.** Every other species uses `/species/view/{key}`. It is client-rendered with the same components and marked `noindex`; if the species does have a static page, it redirects there.
- **Linking.** The build writes `/data/species-manifest.json` (key → slug) so links can choose between the two routes.
- **Requests per species.** About 10, with no per-record loops (`src/lib/species/data.ts`): detail, vernacular names, synonyms, one facet request (years, months, countries, datasets), genus siblings (one facet request and the genus's children), and dataset titles. Photos are fetched in the browser (see Photos above).
- **Build time.** A cold build of 2000 species makes about 20,000 cached GBIF requests: roughly 25 minutes at concurrency 5 (`build.concurrency: 8` renders routes in parallel). Warm builds reuse `.cache/gbif` and `.cache/og`.
- **JavaScript.** The page body is rendered at build time. The gallery (which fetches the photos and opens the lightbox) hydrates on load; the similar species cards (which fetch their photos), the mini-map and the three Plot charts hydrate as they scroll into view (`client:visible`). A page ships about 64 KB of gzipped JS up front, plus Observable Plot (about 74 KB) once a chart scrolls into view: about 140 KB in total, within the species-page budget of 160 KB (raised from the brief's 100 KB to fit Plot).
- **Charts.** Records per year, top countries and top datasets use Observable Plot (`src/components/vue/PlotChart.vue`), with tooltips and dataset links. Plot is imported by name through `src/lib/plot.ts`, so it tree-shakes to about 74 KB. Each chart's data table renders at build time, so the figures are there without JavaScript. Seasonality is a D3 radial chart rendered at build time.
- **Mini-map.** GBIF's own basemap tiles (`tile.gbif.org`) with the same hex density layer as PNG. There's no MapLibre on species pages.
- **Open Graph images.** Rendered at build per pre-rendered species with satori and resvg (`src/lib/og/species-card.ts`), without a photo: photos are only fetched in the browser, so a build-time one could differ from the page's lead photo. Rendered PNGs are cached in `.cache/`, so unchanged cards aren't re-rendered.
- **Sitemap.** `@astrojs/sitemap` covers the main routes and pre-rendered species. `/sitemap.xml` redirects to `/sitemap-index.xml` via `public/_redirects`.

## Tree of life

- **Baked levels.** Kingdom → order (about 3,700 nodes, 68 KB gzipped) come from `/data/tree.json`. Records come from one occurrence facet request. Species counts come from one species-search facet on `higherTaxonKey` per kingdom, which counts accepted species under every taxon without a request per node. Orders with very few species can fall outside the facet limit; they get a floor of 1.
- **Live levels.** Below order, each expansion makes three requests (children for names, an occurrence facet for records, a species facet for counts), whatever the number of children.
- **Charts.** A zoomable sunburst, or an icicle (the default on narrow screens). Both are drawn from a `d3-hierarchy` partition, and zooming tweens a focus window. Hover tooltips use loaded data only; the selected node's lead photo is fetched on click.
- **URL state:** `focus`, `layout`, `metric` (records/species) and `scope`. Selecting a node sets the shared `taxon`, so the map follows. Species pages link in with `?focus=`.
- **"Only the map view."** Replaces record counts with counts inside the persisted map's current bounds (one facet request). Lazily loaded levels reload with the same geometry filter. Species counts stay global.
- **Accessibility.** The child list beside the chart is both the keyboard navigation and the data-table fallback.

## What's near me

- **A mode of the map page** (`/?near=1`), toggled by the Near me button in the map's top bar; it replaces the filters, timeline and hex panel. Leaving it drops its params from the URL. The old `/near` route redirects, keeping its query.
- **Choosing a place.** The map switches to pin mode: click to drop a pin, or use your location after an explainer. The location is rounded to 3 dp (~100 m) before it's stored, put in the URL (`at=`) or sent anywhere. The radius snaps to 1/2/5/10/25/50 km and is drawn on the map.
- **Species table.** One facet request gives the classes in the area, then one species facet per class for the 10 most-recorded classes (top 40 each, 2 at a time), and photos and names as for the hex panel. Sorting and filtering make no requests; moving the pin or changing the radius aborts the previous load.
- **"Recorded in {month}".** Restricts to records from the current calendar month in any year.
- **Recent sightings.** Photographed records from the past year, newest first, each showing its dataset and photo licence. GBIF ignores sort parameters, so the feed filters by date range and sorts on the client.
