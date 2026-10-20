# Development

## Setup

Requirements: Node 22.22.3+, 24.16+ or 26.3+ (CI uses Node 24). Odd-numbered releases such as 25 are not supported by the ESLint Astro plugins. `.nvmrc` pins 24.

```bash
cp .env.example .env    # set GBIF_CONTACT_EMAIL at least
pnpm install
pnpm dev             # http://localhost:4321
```

## Scripts

| Script                             | Purpose                                                                                                                                                                                   |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                         | Dev server                                                                                                                                                                                |
| `pnpm bake`                        | Fetch the data the build bakes (years, name index, tree, species list) from GBIF into `.cache/baked/`. Builds use it instead of fetching; delete it to go back to fetching on every build |
| `pnpm build` / `pnpm preview`      | Static build to `dist/` (also generates `sw.js`) and serve it                                                                                                                             |
| `pnpm lint` / `pnpm format`        | ESLint / Prettier                                                                                                                                                                         |
| `pnpm check`                       | `astro check` (TypeScript strictest)                                                                                                                                                      |
| `pnpm test`                        | Unit tests (Vitest)                                                                                                                                                                       |
| `pnpm test:contract`               | **Live** GBIF contract tests. Hits each endpoint once. Not run in default CI.                                                                                                             |
| `pnpm build:e2e` / `pnpm test:e2e` | Build against the fake GBIF in `tests/e2e/fake`, then run the Playwright journeys on it (run `pnpm exec playwright install chromium` once)                                                |

## Environment variables

| Variable                                  | Default                     | Used for                                                                                                                    |
| ----------------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `PUBLIC_GBIF_API_BASE`                    | `https://api.gbif.org`      | JSON API base (browser and build)                                                                                           |
| `PUBLIC_GBIF_TILE_BASE`                   | = API base                  | Map tile base                                                                                                               |
| `PUBLIC_SITE_URL`                         | `https://app.taxonomap.com` | Canonical URLs, sitemap, Open Graph                                                                                         |
| `GBIF_CONTACT_EMAIL`                      | none                        | Build-time `User-Agent: Taxonomap/<version> (contact: …)`                                                                   |
| `GBIF_CACHE_TTL_HOURS`                    | `168`                       | Build-time disk-cache freshness                                                                                             |
| `GBIF_CACHE_REFRESH`                      | `0`                         | `1` ignores the disk cache for this build                                                                                   |
| `SPECIES_PRERENDER_COUNT`                 | `2000`                      | Number of pre-rendered species pages                                                                                        |
| `NAME_INDEX_SIZE`                         | `6000` (dev: `300`)         | Species in the baked common-name index (`/data/names.json`), each with its iNaturalist taxon ID when the bake can match one |
| `PUBLIC_GEOCODER` / `PUBLIC_GEOCODER_URL` | `nominatim`                 | Place search provider (`nominatim` or `photon`); called on submit only                                                      |
| `PUBLIC_BASEMAP_*`                        | see `.env.example`          | Override the Plain (dark/light), Terrain and Satellite basemaps                                                             |

`PUBLIC_*` values are inlined into the client bundle. Point the two bases at a caching proxy to change where requests go, with no code changes.

## Polish: animation, offline, performance, tests

- **Decade animation.** The play button on the time slider steps through 1900s → 2020s. While it plays, URL writes use `replaceState` (`withHistoryMode`), so Back isn't flooded.
- **Offline.**
  - Pages are network-first, falling back to the last copy, or to `/offline` for pages never visited.
  - Page shells (`/tree`, `/species/view/{key}`) are served from the precache whatever the query string.
  - A notice shows while offline. `/data/*.json` is cached on demand rather than precached, to keep the service worker install light.
  - There's a 404 page.
- **Performance.** The two Latin variable fonts are preloaded, and the basemap host is preconnected. `lighthouserc.json` sets the budget: accessibility ≥ 95 on every audited page; on species pages, performance ≥ 90 and ≤ 160 KB of script. Map pages only warn below 90, because MapLibre alone is about 430 KB gzipped. Run it with `pnpm dlx @lhci/cli autorun` after a build. **Not yet measured locally.**
- **Unit tests** (`tests/unit/`). `src/lib`, `src/stores`, `src/pages` endpoints and `functions/` are held at 100% line, branch, function and statement coverage (`pnpm test:coverage` fails below it); Vue components are covered by the journeys instead.
- **Playwright journeys** (`tests/e2e/`). Cover the map, omnibox and place search, filters, hex panel, species pages and fallback, 404, tree, near me (species table, recent sightings, and that geolocation is rounded before any request), the decade animation and offline. They never touch the network: `pnpm build:e2e` builds the site against a small fake GBIF (`tests/e2e/fake/world.ts`: six species, served by a local server during the build), and in the browser every request off the site is answered by the same fake or fails the journey. Phones run only the journeys tagged `@mobile`, whose layout differs there. `PW_CHANNEL=chrome` uses an installed Chrome, or `PW_CHROMIUM` a Chromium binary, instead of Playwright's download.
