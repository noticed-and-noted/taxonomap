# GBIF API findings (verified 2026-10-12)

These are cases where the live API differs from the original brief:

1. **`/v1/species/suggest` matches scientific names only** ("robin" → _Robinsonia_). Common-name search instead uses a baked index plus live vernacular search, behind a swappable `NameSearchProvider`.
2. **Density tiles ignore `mediaType`, `month` and the other refinements.** Those filters switch the layer to `adhoc` tiles, which are about 8× heavier.
3. **`media[].license` is often free text** (for example "Copyright by the creator…"). A photo's own licence is used when it is a recognisable Creative Commons licence (CC0 and every CC-BY variant are allowed, including ShareAlike and NoDerivatives, even though cards crop photos and link previews composite them). Otherwise the record's licence decides.
4. `offset + limit` is capped at 100,001.
5. `@vite-pwa/astro` doesn't support Astro 7, so `integrations/service-worker.ts` calls `workbox-build` directly.
6. TypeScript is pinned to 6.0.x because `@astrojs/check` and `typescript-eslint` don't support TypeScript 7 yet.
7. Species detail (`/v1/species/{key}`) has no `vernacularName` at species rank (higher ranks do), and occurrence records carry only `publishingOrgKey`. Publisher names come from `/v1/organization/{key}`.
8. MapLibre 6 derives its worker URL from `import.meta.url`, which breaks once bundled. The worker is shipped as an asset (`?url`) and passed to `setWorkerUrl`. MapLibre is about 285 KB gzipped plus a 144 KB worker, which is the largest risk to the 3 s first-map target; it has not been measured yet.
