# Architecture

- **`src/lib/gbif/` is the only code that knows GBIF URLs.** An ESLint rule rejects `api.gbif.org` string literals anywhere else in `src/`. The same client runs in the browser (`~/lib/gbif`) and at build time (`~/lib/gbif/server`, which switches to the Node transport).
- **URL is the source of truth.** `src/stores/url-sync.ts` binds Nano Stores to query-string keys:
  - `taxon` (a comma-separated list; a single key from older links still works), `years` and the filters (`basis`, `photo`, `sound`, `months`, `continent`, `uncert`, `licence`, `iucn`) are _global_: they are carried onto internal navigations.
  - `view` uses `replaceState`, throttled to 300 ms.
  - `hex` and `panel` push history entries, so the back button works.
- **The map survives navigation.** The map island lives in a `transition:persist="map"` slot inside `AppShell.astro`.
- **Islands talk only through stores.** `MapCanvas` (persisted, `client:only`), `ExplorerOverlay` (`client:only`) and `Omnibox` (`client:idle`) are separate Vue apps; camera requests use the ephemeral `$flyTo` store and the selected cell's geometry is published on `$hexGeometry`.
