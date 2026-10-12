# GBIF Explorer

A static, visual explorer for [GBIF](https://www.gbif.org) occurrence data, built for birders, naturalists, recorders and educators. Pages are pre-rendered at build time, interactive parts hydrate as Vue islands, and the browser calls `api.gbif.org` directly. There is no application server.

**Stack:** Astro 7 (static) · Vue 3 islands · Nano Stores · MapLibre GL · D3 / Observable Plot · Tailwind CSS 4 · Workbox · Vitest / Playwright · Cloudflare Pages.

> Status: **Phase 2 (map explorer MVP)** is complete. Species pages, tree of life and near-me features arrive in phases 3 to 5.

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

## Pre-rendering (Phase 3)

The top `SPECIES_PRERENDER_COUNT` species are pre-rendered at `/species/[key]/[slug]`; every other species uses `/species/view?key=` (client-rendered, `noindex`). A cold build makes roughly 6 GBIF requests per species, which comes to about 15–25 minutes for 2000 species. Warm-cache builds are well under 10 minutes.

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

## Optional Worker

Phase 6 adds `/worker`: a Cloudflare Worker that caches GBIF JSON at the edge and adds a `User-Agent`. It is not deployed by default. To enable it, deploy the Worker and set `PUBLIC_GBIF_API_BASE` (and optionally `PUBLIC_GBIF_TILE_BASE`) to its URL.

## Data and attribution

Occurrence data comes from GBIF.org and its publishers. Every record and image shown in the app credits its dataset or publisher and its licence.
