# Taxonomap architecture

How the code fits together, and where to make the common changes. Read this before adding a feature. `docs/design-system.md` covers how things look; `CLAUDE.md` covers the code standards.

The code is the source of truth. If this file and the code disagree, fix this file.

## The shape of the app

Taxonomap is a static site. Astro pre-renders every page at build, Vue islands handle the interactive parts, and the browser calls GBIF and the other services directly. There is no application server.

The build itself makes no external requests. `pnpm bake` fetches the data the build needs once and saves it to `.cache/baked`; `pnpm build` reads those files. CI bakes daily.

| Folder            | Holds                                                                                  |
| ----------------- | -------------------------------------------------------------------------------------- |
| `src/pages`       | Routes: pages (`.astro`) and build-time endpoints (`.json.ts`, `.png.ts`)              |
| `src/layouts`     | Page frames: `BaseLayout`, `AppShell` (map routes), `PageShell` (content pages)        |
| `src/components`  | Vue and Astro components, by atomic level (see [Components](#components))              |
| `src/stores`      | Shared state as Nano Stores atoms, most of them synced to the URL or `localStorage`    |
| `src/composables` | Vue composables (`use*.ts`) shared by several components                               |
| `src/lib`         | Framework-free logic, one folder per concern: `gbif`, `inat`, `map`, `photos`, `bake`… |
| `src/styles`      | Design tokens and global CSS                                                           |
| `integrations`    | Astro integrations (the service worker)                                                |
| `scripts`         | Command-line scripts (`pnpm bake`, `pnpm ioc-names`)                                   |
| `tests/unit`      | Vitest tests for everything in `src/**/*.ts`                                           |
| `tests/e2e`       | Playwright journeys against a fake GBIF (`tests/e2e/fake`)                             |
| `tests/contract`  | Live checks that GBIF still answers the way the client expects (weekly in CI)          |

## Pages and islands

| Route                   | Page                         | What it is                                                        |
| ----------------------- | ---------------------------- | ----------------------------------------------------------------- |
| `/`                     | `index.astro`                | The map explorer: `AppShell` plus the `ExplorerOverlay` view      |
| `/tree`                 | `tree.astro`                 | Tree of Life: `AppShell` with the map hidden, plus `TreeExplorer` |
| `/near`                 | `near.astro`                 | What's near you                                                   |
| `/species/{key}/{slug}` | `species/[key]/[slug].astro` | Pre-rendered species page (the top `SPECIES_PRERENDER_COUNT`)     |
| `/species/view?key=…`   | `species/view.astro`         | Client-rendered fallback for every other species; not indexed     |
| `/data/*.json`          | `data/[snapshot].json.ts`, … | Baked snapshots the browser loads                                 |
| `/og/species/{key}.png` | `og/species/[key].png.ts`    | Open Graph cards, drawn with satori at build                      |
| `/icons/*.png`          | `icons/[name].png.ts`        | App icon cuts, drawn from `docs/brand/app-icon.svg`               |

The site uses Astro's `ClientRouter`, so moving between pages swaps the page without a reload. `AppShell` puts the map island (`MapCanvas.vue`) in a `transition:persist` slot: the map, its WebGL context and its loaded tiles survive the move from `/` to `/tree` and back.

Islands don't import each other. They talk through stores.

The map island is the wiring between those stores and MapLibre. What it does with the map lives in `src/lib/map` as functions that take the map (`camera.ts` for flights, `screen.ts` for what's in view, `recordZoom.ts`, `attribution.ts` and so on), so each is unit-tested with a stand-in map. Put new map behaviour there too, and keep `MapCanvas.vue` to listening and calling.

## State

All shared state lives in Nano Stores atoms under `src/stores`. Components read them with `useStore` from `@nanostores/vue`.

There are three kinds:

1. **URL state** (`urlAtom` in `src/stores/url-sync.ts`). Each atom is bound to one query-string key through a codec (`codecs.int`, `codecs.setOf`, `codecs.intSet` and so on), which parses and serialises it. The URL is the source of truth, so any view can be shared as a link and the back button works.
   - `history: 'push'` (the default) makes each change a back-button step. `'replace'` (the map view) is throttled and adds none.
   - `scope: 'map'` keys belong to `/`. Other pages leave them out of their URL but keep them, and put them back on the way to the map.
   - Defaults are left out of the URL.
2. **Viewer preferences** (`ramp.ts`, `reading.ts`, `onboarding.ts`, `fit-search.ts`). Saved in `localStorage`; wrap every read and write in `try`/`catch`, as the existing stores do.
3. **Messages between islands** (`map-messages.ts`). Plain atoms one island publishes and another listens to: the selected hex's geometry, the map bounds, one-shot requests such as `$flyTo`.

The explorer's URL state is in `src/stores/explorer.ts`, and the filter list built on it in `src/stores/filters.ts`.

The map page has three modes: Explore, Near me and Analyse (`src/stores/mode.ts`). Near me keeps its `?near=1` key so old links work, and Analyse adds `?analyse=1`; `$mode` reads the two as one. Switch with `setMapMode`, which resets the mode being left in the same history step. Entering Analyse clears every filter; Analyse then offers only the How group and Where's location accuracy (`ANALYSE_FILTER_GROUPS`, read by the rail and the phone Filters sheet through `$visibleFilterGroups`), and its migration and spread queries are built from `$occurrenceFilter` like everything else, so those filters narrow them too. Whether Near me's and Analyse's panels are showing (`$nearPanelOpen`, `$analysePanelOpen`) and Near me's record total (`$nearTotal`) are plain atoms, so the phone's bottom button can reopen a panel and show its count.

Analyse's own choices live in `src/stores/analyse.ts`: the species (`?ak=`), the view (`?av=migration|spread`) and its year range (`?ayr=2010-2020`, apart from the When filter; left out when it covers every year from `ANALYSE_FIRST_YEAR`). `setMapMode` drops them when Analyse is left. The picker opens with a hand-picked list (`src/lib/analyse/starting-species.ts`, keys matched once with `species/match`); typing narrows that list and searches every species through `useNameSearch` as it does, the GBIF hits listed below the picks. `src/data/migration/migration.json` is the static migration lookup: `src/lib/analyse/migration.ts` loads it on first use, as its own small file, to tag species found by searching (Migrates, or Partly migrates), and the results credit EOL's sources. Migration's month is `?am=` (1 to 12). The map draws `$mapFilter` (`src/stores/map-filter.ts`), not `$occurrenceFilter`: in Analyse with a species it is that species in Analyse's years under the kept filters (`$analyseFilter`), plus the month in Migration, which the density tiles can't apply, so those tiles come from the adhoc endpoint. A click on a cell in Analyse shows its count rather than opening a cell panel. Playback (`usePlayback`) steps at most once a second and never before the map has drawn the last step; `wrapStep` in `src/lib/analyse/timeline.ts` loops the steps. Spread (`src/lib/analyse/spread.ts`) can't come from the map's own tiles, which hold one total per cell with no years: it asks for one whole-world tile per year (`worldTileUrl`, cells about 200 km across) plus one for every year before the range, and a cell's first year is when its running total reaches `MIN_RECORDS` (2); countries work the same way from per-year `country` facets. That is about 28 tile and 28 search requests per species and range. `useSpreadCells`, run by `AnalysePanel` so the map keeps the spread while the phone sheet is closed, puts the cells in `$spreadCells`; `$spreadMap` (`src/stores/spread.ts`) is what the map's `spread` source draws for Spread's year (`?ay=`), and while it is set the occurrence hexes and their legend are hidden.

## Filters

Every filter is one entry in `FILTERS` in `src/stores/filters.ts`. From that list the store derives:

- `$occurrenceFilter`: every set filter as one `OccurrenceFilter`, which the map, panels and charts all query with
- `$filterPills`: the removable pills for set filters
- `$groupCounts`: the badge on each rail group
- `clearFilters()`: "clear all"

The helpers `list`, `flag` and `nullable` cover the common shapes (a set of values, an on/off switch, an optional single value).

An `OccurrenceFilter` becomes GBIF query parameters in one place, `filterToParams` in `src/lib/gbif/occurrence.ts`. The GraphQL queries are built from those same parameters (`toPredicate` in `graphql.ts`), and the map tiles use `tileParams` in `maps.ts`, so the three can't drift apart.

GBIF's cheap density tiles understand only a few parameters (taxon, year, basis of record, country). Anything in `Refinements` switches the map to the slower adhoc tiles (`needsAdhoc` in `maps.ts`); that is automatic.

## The GBIF client

`src/lib/gbif` is the only code that knows GBIF addresses; a lint rule enforces it.

- Browser code imports `~/lib/gbif`. Build-time code (Astro frontmatter, endpoints, `getStaticPaths`, scripts) imports `~/lib/gbif/server`, which switches the shared client to the Node transport: User-Agent with `GBIF_CONTACT_EMAIL`, a concurrency cap and a disk cache. Never import `server` from an island.
- `http.ts` does every request: retries with backoff, an in-memory cache, and `$gbifStale` when GBIF is struggling (which shows the "GBIF is busy" notice). Requests are counted in `metrics.ts` for the request meter.
- Errors are typed (`errors.ts`): `GbifNotFoundError`, `GbifRequestError`, `GbifUnavailableError`.
- Each area of the API has its own file: `species.ts`, `occurrence.ts`, `graphql.ts`, `maps.ts`, `images.ts`, `datasets.ts`, `names.ts`.

## Other services

| Service             | Code                           | Used for                       |
| ------------------- | ------------------------------ | ------------------------------ |
| iNaturalist         | `src/lib/inat/client.ts`       | Photos, sounds, common names   |
| Geocoder (Photon)   | `src/lib/geocode.ts`           | Place search                   |
| Basemaps            | `src/lib/basemaps.ts`          | OpenFreeMap, EOX Sentinel-2    |
| Wikipedia, Wikidata | `src/lib/species/wikipedia.ts` | Species descriptions and links |
| Wiktionary          | `src/lib/species/etymology.ts` | What a scientific name means   |

Like the GBIF client, iNaturalist's has a build-time entry point, `~/lib/inat/server`, which puts the disk cache in front of it; the bakers import that, islands never do.

Every base address can be overridden in `.env` (see `.env.example`). Adding a host, or sending user input to a new endpoint, needs the privacy and terms pages on taxonomap.com updated and, if cached, the service worker too; see `CLAUDE.md`.

## Baked data

`pnpm bake` (`scripts/bake.ts` → `bakeToDisk` in `src/lib/bake/index.ts`) runs each bake step and saves its result to `.cache/baked/{name}.json`:

| Snapshot        | Used by                                                          |
| --------------- | ---------------------------------------------------------------- |
| `years`         | The time slider's records-per-year histogram                     |
| `species-list`  | Which species get a pre-rendered page                            |
| `names`         | The search's common-name index                                   |
| `tree`          | The Tree of Life from kingdom to order (deeper levels load live) |
| `species-pages` | The data each pre-rendered species page is built from            |

`years`, `names` and `tree` are also served to the browser as `/data/{name}.json` (`src/pages/data/[snapshot].json.ts`). The browser loads them with `loadSnapshot` in `src/lib/data/load.ts`, which resolves `null` when a snapshot is missing so the caller can ask GBIF live instead. A build with nothing baked still works, just slower.

## Offline and caching

`integrations/service-worker.ts` writes `dist/sw.js` with Workbox after the build. Its comment lists the strategy for each kind of request (GBIF JSON, tiles, images, basemaps, pages, baked data). A new host that should work offline needs a rule there.

## Components

Components sit in folders by atomic level. The level depends on how a component is built and used, not on its size:

| Level        | Folder                 | Contains other components? | Knows the domain or app state?                              |
| ------------ | ---------------------- | -------------------------- | ----------------------------------------------------------- |
| **Atom**     | `atoms/`               | No                         | No: props in, events out                                    |
| **Molecule** | `molecules/`           | Yes                        | No; reusable anywhere                                       |
| **Organism** | `organisms/{feature}/` | Yes                        | Yes; tied to one feature                                    |
| **View**     | `views/`               | Yes                        | Yes; the top-level island a page mounts, and owns its state |

- Atoms and molecules never fetch or read app stores. Pass them plain props. A molecule that needs search results takes a function as a prop (see `SuggestPicker.vue`).
- "Knows the domain" means fetching, reading app state, or belonging to one feature. Knowing GBIF's data shapes or the site's own links is fine: `ThumbImage` (a GBIF photo, with its retries) and `LicenceBadge` are atoms, and `SpeciesCard`, which holds them, is a molecule.
- A component that reads a store is an organism even when it holds no other components: the settings controls (`organisms/settings/`) and the GBIF and update notices (`organisms/site/`).
- An organism's sub-components and helpers sit beside it in its feature folder (`organisms/cell/useOpenRecord.ts`).
- Script that depends on the screen width uses the queries in `src/lib/breakpoints.ts`, which match the Tailwind breakpoints CSS uses (`sm`, `md` and `rail`). Don't write a width into a component.
- Logic that isn't markup belongs in `src/lib` (framework-free, unit-tested) or a composable. Vue files aren't counted in unit coverage, so logic left in a component is tested only by the e2e journeys.

## Testing

| Suite                   | Command              | What it covers                                                          |
| ----------------------- | -------------------- | ----------------------------------------------------------------------- |
| Unit (Vitest)           | `pnpm test`          | Every `.ts` file in `src` and `integrations`; CI requires 100% coverage |
| End to end (Playwright) | `pnpm test:e2e`      | Journeys through the built site, against the fake world                 |
| Contract                | `pnpm test:contract` | Live GBIF answers still match the client's expectations                 |

The e2e build (`pnpm build:e2e`) bakes from `tests/e2e/fake/world.ts`, a small fixed stand-in for GBIF, iNaturalist, the basemaps and the geocoder. The browser gets its answers from the same file, so baked and live data agree. A new request the app makes needs an answer there, or the journeys will fail. `tests/unit/helpers` has fakes for the network, storage and tiles.

## Recipes

### Add a filter

1. **Store**: in `src/stores/explorer.ts`, add a `urlAtom` with a new, short URL key and `scope: 'map'`.
2. **Register it**: add an entry to `FILTERS` in `src/stores/filters.ts` with its rail group and pill label.
3. **Query**: add the field to `OccurrenceFilter` (or `Refinements`, if density tiles ignore it) in `src/lib/gbif/occurrence.ts`, and map it to GBIF's parameter in `refinementParams` or `filterToParams`.
4. **Control**: add a `fieldset` to that group's section in `src/components/organisms/filters/FilterGroup.vue`.
5. **Tests**: unit-test the parameter in `tests/unit/filters.test.ts` or `params.test.ts`, and teach `tests/e2e/fake/world.ts` the parameter if a journey uses it.

The pills, badge count, "clear all", map tiles, panels and GraphQL queries follow from steps 2 and 3.

### Add a page

1. Add `src/pages/{name}.astro`, wrapped in `BaseLayout` and either `AppShell` (it needs the map) or `PageShell` (content).
2. Put its interactive part in a view under `src/components/views`, mounted with a `client:` directive.
3. If it's a content page that shouldn't be indexed, pass `noindex` and leave it out of the sitemap filter in `astro.config.mjs`.
4. If it's in the header nav, add it to `SiteHeader.astro`.
5. Add a journey in `tests/e2e`.

### Call a new GBIF endpoint

1. Add a typed function to the right file in `src/lib/gbif` (or a new file, exported from `index.ts`), using `http`.
2. Add its answer to `tests/e2e/fake/world.ts` and a unit test with the network fake.
3. If the response shape matters, add a case to `tests/contract/gbif.contract.test.ts`.

### Use a new outside service

1. Put its client in `src/lib`, with its base address from `.env` (`env` in `src/lib/env.ts`) and an entry in `.env.example`.
2. Update the privacy and terms pages on taxonomap.com, and add a service-worker rule if it should be cached.
3. Teach `tests/e2e/fake/world.ts` to answer it.

### Bake new data

1. Add a bake step under `src/lib/bake` and a step in `bakeToDisk`'s list in `src/lib/bake/index.ts`.
2. If the browser needs it, add it to `SNAPSHOTS` in `src/pages/data/[snapshot].json.ts` and its type to `Snapshots` in `src/lib/data/load.ts`, and make the caller cope with `null`.
