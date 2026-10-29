# Architecture

- **`src/lib/gbif/` is the only code that knows GBIF URLs.** An ESLint rule rejects `api.gbif.org` string literals anywhere else in `src/`. The same client runs in the browser (`~/lib/gbif`) and at build time (`~/lib/gbif/server`, which switches to the Node transport).
- **URL is the source of truth.** `src/stores/url-sync.ts` binds Nano Stores to query-string keys:
  - `taxon` (a comma-separated list; a single key from older links still works), `years` and the filters (`basis`, `photo`, `sound`, `months`, `continent`, `uncert`, `licence`, `iucn`) are _global_: they are carried onto internal navigations.
  - `view` uses `replaceState`, throttled to 300 ms.
  - `hex` and `panel` push history entries, so the back button works.
- **The map survives navigation.** The map island lives in a `transition:persist="map"` slot inside `AppShell.astro`.
- **Islands talk only through stores.** `MapCanvas` (persisted, `client:only`), `ExplorerOverlay` (`client:only`) and `Omnibox` (`client:idle`) are separate Vue apps; camera requests use the ephemeral `$flyTo` store and the selected cell's geometry is published on `$hexGeometry`.

## Code layout

Components follow atomic design. Each level may use the levels above it in this list, never the ones below.

| Folder                        | Level    | What belongs there                                                                                                              |
| ----------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `src/components/atoms/`       | Atom     | One element or control with no child components, stores or fetching: props in, events out (`UiIcon`, `SkeletonBlock`, `Notice`) |
| `src/components/molecules/`   | Molecule | A small composite, or a control bound to one store, reused in more than one place (`SearchInput`, `ChartFrame`, `ThemePicker`)  |
| `src/components/organisms/*/` | Organism | A named region of one feature, grouped by feature: `site`, `map`, `filters`, `cell`, `near`, `onboarding`, `species`, `tree`    |
| `src/components/views/`       | View     | An island root that an Astro page mounts and that owns its page's layout and state (`ExplorerOverlay`, `TreeExplorer`)          |
| `src/layouts/`                | Layout   | Astro page frames: `BaseLayout`, `AppShell` (map routes), `PageShell` (content routes), `LegalPage`                             |
| `src/composables/`            |          | `use*` composables shared by components                                                                                         |
| `src/stores/`                 |          | Nano Stores, the only channel between islands                                                                                   |
| `src/lib/`                    |          | Framework-free logic: the GBIF client, map helpers, formatting, data loading                                                    |

- An organism's helpers live beside it in its feature folder. Move a component up to `molecules/` once a second feature uses it.
- Data flows down as props and up as events inside an island; between islands it goes through stores.
- The views folder is not called `pages/` so it isn't mistaken for Astro's file-based routes in `src/pages/`.
