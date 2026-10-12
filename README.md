# GBIF Explorer

A static, visual explorer for [GBIF](https://www.gbif.org) occurrence data, built for birders, naturalists, recorders and educators. Pages are pre-rendered at build time, interactive parts hydrate as Vue islands, and the browser calls `api.gbif.org` directly. There is no application server.

**Stack:** Astro 7 (static) · Vue 3 islands · Nano Stores · MapLibre GL · D3 / Observable Plot · Tailwind CSS 4 · Workbox · Vitest / Playwright · Cloudflare Pages.

> Status: **Phase 5 (what's near me)** is complete. Phase 6 (polish) follows.

## Local setup

Requirements: Node ≥ 22.12 (CI uses Node 24).

```bash
cp .env.example .env    # set GBIF_CONTACT_EMAIL at least
npm install
npm run dev             # http://localhost:4321
```

| Script                              | Purpose                                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------ |
| `npm run dev`                       | Dev server                                                                                 |
| `npm run build` / `npm run preview` | Static build to `dist/` (also generates `sw.js`) and serve it                              |
| `npm run lint` / `npm run format`   | ESLint / Prettier                                                                          |
| `npm run check`                     | `astro check` (TypeScript strictest)                                                       |
| `npm test`                          | Unit tests (Vitest)                                                                        |
| `npm run test:contract`             | **Live** GBIF contract tests. Hits each endpoint once. Not run in default CI.              |
| `npm run test:e2e`                  | Playwright journeys against `npm run preview` (run `npx playwright install chromium` once) |

## Environment variables

| Variable                                  | Default                           | Used for                                                               |
| ----------------------------------------- | --------------------------------- | ---------------------------------------------------------------------- |
| `PUBLIC_GBIF_API_BASE`                    | `https://api.gbif.org`            | JSON API base (browser and build)                                      |
| `PUBLIC_GBIF_TILE_BASE`                   | = API base                        | Map tile base                                                          |
| `PUBLIC_SITE_URL`                         | `https://gbif-explorer.pages.dev` | Canonical URLs, sitemap, Open Graph                                    |
| `GBIF_CONTACT_EMAIL`                      | none                              | Build-time `User-Agent: GBIFExplorer/<version> (contact: …)`           |
| `GBIF_CACHE_TTL_HOURS`                    | `168`                             | Build-time disk-cache freshness                                        |
| `GBIF_CACHE_REFRESH`                      | `0`                               | `1` ignores the disk cache for this build                              |
| `SPECIES_PRERENDER_COUNT`                 | `2000`                            | Number of pre-rendered species pages (Phase 3)                         |
| `NAME_INDEX_SIZE`                         | `6000` (dev: `300`)               | Species in the baked common-name index (`/data/names.json`)            |
| `PUBLIC_GEOCODER` / `PUBLIC_GEOCODER_URL` | `nominatim`                       | Place search provider (`nominatim` or `photon`); called on submit only |
| `PUBLIC_BASEMAP_*`                        | see `.env.example`                | Override the Plain (dark/light), Terrain and Satellite basemaps        |

`PUBLIC_*` values are inlined into the client bundle. Point the two bases at a caching proxy (see "Optional Worker") to change where requests go, with no code changes.

## Architecture notes

- **`src/lib/gbif/` is the only code that knows GBIF URLs.** An ESLint rule rejects `api.gbif.org` string literals anywhere else in `src/`. The same client runs in the browser (`~/lib/gbif`) and at build time (`~/lib/gbif/server`, which switches to the Node transport).
- **URL is the source of truth.** `src/stores/url-sync.ts` binds Nano Stores to query-string keys:
  - `taxon`, `years`, `basis`, `photo` and `country` are _global_: they are carried onto internal navigations.
  - `view` uses `replaceState`, throttled to 300 ms.
  - `hex` and `panel` push history entries, so the back button works.
- **The map survives navigation.** The map island lives in a `transition:persist="map"` slot inside `AppShell.astro`.
- **Islands talk only through stores.** `MapCanvas` (persisted, `client:only`), `ExplorerOverlay` (`client:only`) and `Omnibox` (`client:idle`) are separate Vue apps; camera requests use the ephemeral `$flyTo` store and the selected cell's geometry is published on `$hexGeometry`.

## Map explorer (Phase 2)

- **Density layer.** GBIF hex-binned **vector** tiles (`.mvt`), styled on the client so the legend matches exactly and cells can be queried on click. Because a cell covers more ground when zoomed out, the log-scale bins scale by 4^(6 − zoom) and the legend shows the bins for the current zoom (`src/lib/ramp.ts`). Viridis ramp, colour-blind safe.
- **"Has photo"** switches the layer from `density` to `adhoc` tiles (density ignores `mediaType`).
- **Basemaps.** Plain is an OpenFreeMap vector style (`dark` / `positron`, following the theme) with its labels drawn above the data and roads/rivers hidden below zoom 8. Terrain is OpenTopoMap and Satellite is EOX Sentinel-2 cloudless (CC BY-NC-SA). All are keyless; CARTO now returns "API key required" tiles.
- **Omnibox.** The baked common-name index answers instantly, ranked by record count. Live GBIF suggest (scientific names) and vernacular search are debounced by 250 ms. Place search runs only on Enter.
- **Time slider.** Its histogram comes from `/data/years.json` and goes live (one facet request) when other filters apply. It commits on release, so each change is one history step.
- **Hex panel.** One facet request (count, top 10 species, months), one image request for all 10 species (plus at most one follow-up), and names from the index. "Show individual records" loads up to 300 records as clustered points. Selecting a point shows the record with its dataset, publisher and licence.
- **Mobile.** Filters and basemap move into a bottom sheet with three snap points.
- **Photos** use GBIF's image cache (`/v1/image/cache/{size}/occurrence/{key}/media/{md5(identifier)}`), about 19 KB instead of a 145 KB original.

## Caching strategy

| Layer                         | What                | Policy                                                                                                                                                                                                                                |
| ----------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| In-memory (browser and build) | GBIF JSON           | Params normalised (sorted keys, bbox 2 dp, radius snapped to 1/2/5/10/25/50 km, geolocation 3 dp); one in-flight promise per URL; LRU (300 in browser, 5000 at build) with per-endpoint TTL                                           |
| Retry                         | 429 / 5xx / network | Up to 3 retries with exponential back-off plus jitter, honouring `Retry-After`. After that a stale cached copy is served with a quiet "data may be out of date" note; if there is none, a typed error the UI maps to a friendly state |
| Service Worker (`dist/sw.js`) | GBIF JSON           | Stale-while-revalidate, 24 h, 300 entries                                                                                                                                                                                             |
|                               | Map tiles           | Cache-first, 7 days, 2000 entries                                                                                                                                                                                                     |
|                               | Images              | Cache-first, 30 days, 300 entries                                                                                                                                                                                                     |
|                               | Basemaps            | Cache-first, 30 days, 1500 entries (OpenFreeMap tiles, styles, sprites and glyphs; EOX; OpenTopoMap)                                                                                                                                  |
|                               | App shell           | Precached (main routes, JS/CSS, Latin font subsets, baked data)                                                                                                                                                                       |
| Build disk cache              | `.cache/gbif/`      | Keyed by URL hash. Concurrency 5. CI persists it with `actions/cache`, so nightly builds are incremental                                                                                                                              |
| Cloudflare Pages              | `_astro/*`          | Immutable; see `public/_headers`                                                                                                                                                                                                      |

## Species pages (Phase 3)

- **Pre-rendered pages.** `/species/{key}/{slug}` is built for `SPECIES_PRERENDER_COUNT` species (default 2000; 12 in dev). They are chosen by record count, with a quota for each major class (birds, insects, flowering plants, mammals, fungi and so on), so the set isn't nearly all birds (`src/lib/bake/index.ts`).
- **Fallback page.** Every other species uses `/species/view?key=`. It is client-rendered with the same components and marked `noindex`; if the species does have a static page, it redirects there.
- **Linking.** The build writes `/data/species-manifest.json` (key → slug) so links can choose between the two routes.
- **Requests per species.** About 10, with no per-record loops (`src/lib/species/data.ts`): detail, vernacular names, synonyms, one facet request (years, months, countries, datasets), photos (iNaturalist research-grade first, topped up from other datasets), genus siblings (one facet request, the genus's children, one photo request), and dataset titles.
- **Build time.** A cold build of 2000 species makes about 20,000 cached GBIF requests: roughly 25 minutes at concurrency 5 (`build.concurrency: 8` renders routes in parallel). Warm builds reuse `.cache/gbif` and `.cache/og`.
- **JavaScript.** The page body is rendered at build time. Only the gallery (lightbox) and the mini-map hydrate (`client:visible`), so a page ships about 60 KB of gzipped JS.
- **Charts.** Records per year, seasonality, top countries and top datasets are small Vue/SVG components with `<details>` data tables, so they need no JavaScript. Observable Plot was dropped: tree-shaken, it is 86 KB gzipped on its own, which would nearly exhaust the 100 KB page budget.
- **Mini-map.** GBIF's own basemap tiles (`tile.gbif.org`) with the same hex density layer as PNG. There's no MapLibre on species pages.
- **Open Graph images.** Rendered at build per pre-rendered species with satori and resvg (`src/lib/og/species-card.ts`). Photos and rendered PNGs are cached in `.cache/`, so unchanged cards aren't re-rendered.
- **Sitemap.** `@astrojs/sitemap` covers the main routes and pre-rendered species. `/sitemap.xml` redirects to `/sitemap-index.xml` via `public/_redirects`.

## Tree of life (Phase 4)

- **Baked levels.** Kingdom → order (about 3,700 nodes, 68 KB gzipped) come from `/data/tree.json`. Records come from one occurrence facet request. Species counts come from one species-search facet on `higherTaxonKey` per kingdom, which counts accepted species under every taxon without a request per node. Orders with very few species can fall outside the facet limit; they get a floor of 1.
- **Live levels.** Below order, each expansion makes three requests (children for names, an occurrence facet for records, a species facet for counts), whatever the number of children.
- **Charts.** A zoomable sunburst, or an icicle (the default on narrow screens). Both are drawn from a `d3-hierarchy` partition, and zooming tweens a focus window. Hover tooltips use loaded data only; the selected node's photo is fetched on click.
- **URL state:** `focus`, `layout`, `metric` (records/species) and `scope`. Selecting a node sets the shared `taxon`, so the map follows. Species pages link in with `?focus=`.
- **"Only the map view."** Replaces record counts with counts inside the persisted map's current bounds (one facet request). Lazily loaded levels reload with the same geometry filter. Species counts stay global.
- **Accessibility.** The child list beside the chart is both the keyboard navigation and the data-table fallback.

## What's near me (Phase 5)

- **Choosing a place.** The persisted map switches to pin mode: click to drop a pin, or use your location after an explainer. The location is rounded to 3 dp (~100 m) before it's stored, put in the URL (`at=`) or sent anywhere. The radius snaps to 1/2/5/10/25/50 km and is drawn on the map.
- **Species by class.** One facet request gives the classes in the area. Each page of species is one facet request (`facetOffset` paging) plus one photo search for the whole page; names come from the index or the photo results. Further groups load as you scroll.
- **"Recorded in {month}".** Restricts to records from the current calendar month in any year.
- **Recent sightings.** Photographed records from the past year, newest first, each showing its dataset and photo licence. GBIF ignores sort parameters, so the feed filters by date range and sorts on the client.
- **Share card.** Drawn on a `<canvas>` using only CORS-enabled GBIF imagery (basemap and density tiles), so it can be exported. It's shared as an image with the Web Share API where supported, otherwise downloaded, or the link copied. It doesn't print coordinates. The per-group species tallies are fetched when the dialog opens.
- **Checklist.** "Seen" ticks are kept in `localStorage` only (every access wrapped in try/catch, with a notice when storage is blocked) and can be exported as CSV.

## GBIF API findings (verified 2026-10-12)

These are cases where the live API differs from the original brief:

1. **`/v1/species/suggest` matches scientific names only** ("robin" → _Robinsonia_). Common-name search instead uses a baked index plus live vernacular search, behind a swappable `NameSearchProvider`.
2. **Density tiles ignore `mediaType`.** The "has photo" filter switches the layer to `adhoc` tiles, which are about 8× heavier.
3. **`media[].license` is often free text** (for example "Copyright by the creator…"). A photo's own licence is used when it is a recognisable Creative Commons licence (CC0, CC-BY and CC-BY-NC are allowed; any other CC licence is rejected). Otherwise the record's licence decides.
4. `offset + limit` is capped at 100,001.
5. `@vite-pwa/astro` doesn't support Astro 7, so `integrations/service-worker.ts` calls `workbox-build` directly.
6. TypeScript is pinned to 6.0.x because `@astrojs/check` and `typescript-eslint` don't support TypeScript 7 yet.
7. Species detail (`/v1/species/{key}`) has no `vernacularName` at species rank (higher ranks do), and occurrence records carry only `publishingOrgKey`. Publisher names come from `/v1/organization/{key}`.
8. MapLibre 6 derives its worker URL from `import.meta.url`, which breaks once bundled. The worker is shipped as an asset (`?url`) and passed to `setWorkerUrl`. MapLibre is about 285 KB gzipped plus a 144 KB worker, which is the largest risk to the 3 s first-map target; it is tracked for Phase 6.

## Deployment

`.github/workflows/ci.yml` runs lint, format check, `astro check` and unit tests, then builds. It deploys to Cloudflare Pages on pushes to `main` and nightly at 03:00 UTC. Live contract tests run weekly or on manual dispatch.

Configure the repository with:

- **Secrets:** `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
- **Variables:** `CF_PAGES_PROJECT`, `GBIF_CONTACT_EMAIL`, `PUBLIC_SITE_URL`, and optionally `PUBLIC_GBIF_API_BASE`, `PUBLIC_GBIF_TILE_BASE`, `SPECIES_PRERENDER_COUNT`

## Edge cache Worker (optional)

`worker/` contains a Cloudflare Worker that caches GBIF responses at the edge for all visitors. The app falls back to `api.gbif.org` automatically whenever it is unavailable. Setup, requirements (a custom domain on Cloudflare) and local testing are in [worker/README.md](worker/README.md). Enable it by deploying the Worker and pointing `PUBLIC_GBIF_API_BASE` and `PUBLIC_GBIF_TILE_BASE` at it; `PUBLIC_GBIF_FALLBACK_BASE` (default `https://api.gbif.org`) is where requests go when it is down.

**Request meter.** In dev, or with `?debug=requests` on any build, a small panel counts the tile, JSON and image requests made this session and how many went via the edge. Use it to size the Worker quota.

## Data and attribution

Occurrence data comes from GBIF.org and its publishers. Every record and image shown in the app credits its dataset or publisher and its licence.
