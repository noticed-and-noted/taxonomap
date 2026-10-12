/**
 * Generates dist/sw.js with Workbox after the static build.
 *
 * @vite-pwa/astro does not support Astro 7 (its peer range stops at ^5), so
 * this small integration calls workbox-build directly.
 *
 * Strategies:
 *  - GBIF JSON:  StaleWhileRevalidate, 24 h max age, 300 entries
 *  - Map tiles:  CacheFirst, 7 days, 2000 entries
 *  - Images:     CacheFirst, 30 days, 300 entries (opaque responses allowed)
 *  - Basemaps:   CacheFirst, 30 days, 1500 entries (OpenFreeMap, EOX, OpenTopoMap)
 *  - Pages:      NetworkFirst (4 s timeout), 50 entries; offline fallback page
 *  - Baked data: StaleWhileRevalidate (/data/*.json, on demand)
 *  - App shell:  precached (main routes, offline/404 pages, JS/CSS, Latin font subsets)
 */
import type { AstroIntegration } from 'astro';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generateSW } from 'workbox-build';

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const trim = (s: string) => s.replace(/\/+$/, '');

export default function serviceWorker(): AstroIntegration {
  return {
    name: 'gbif-explorer:service-worker',
    hooks: {
      'astro:build:done': async ({ dir, logger }) => {
        const apiBase = trim(process.env['PUBLIC_GBIF_API_BASE'] || 'https://api.gbif.org');
        const tileBase = trim(process.env['PUBLIC_GBIF_TILE_BASE'] || apiBase);
        const fallback = trim(process.env['PUBLIC_GBIF_FALLBACK_BASE'] || 'https://api.gbif.org');
        // Requests go to the edge cache when configured, or GBIF directly when it is bypassed.
        const any = (...bases: string[]) => `(${[...new Set(bases)].map(escape).join('|')})`;
        const outDir = fileURLToPath(dir);

        const { count, size, warnings } = await generateSW({
          swDest: `${outDir}/sw.js`,
          globDirectory: outDir,
          // Routes and baked data appear in later phases; only glob what exists.
          globPatterns: [
            ...[
              'index.html',
              'tree/index.html',
              'near/index.html',
              'species/view/index.html',
              'offline/index.html',
              '404.html',
            ].filter((f) => existsSync(`${outDir}/${f}`)),
            '_astro/*.{js,css}',
            '_astro/*-latin-*-normal*.woff2',
            'favicon.svg',
            'manifest.webmanifest',
          ],
          globIgnores: ['_astro/*-latin-ext-*'],
          maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
          // Astro hashes everything in _astro/, so the URL is the revision.
          dontCacheBustURLsMatching: /\/_astro\//,
          // Serve page shells for "/tree", "/species/view?key=1" etc.: for pages the
          // query string is client-side state, and precached assets are hashed.
          templatedURLs: Object.fromEntries(
            ['tree', 'near', 'species/view', 'offline']
              .filter((p) => existsSync(`${outDir}/${p}/index.html`))
              .map((p) => [`/${p}`, [`${p}/index.html`]]),
          ),
          ignoreURLParametersMatching: [/.*/],
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          skipWaiting: true,
          sourcemap: false,
          runtimeCaching: [
            {
              // Baked snapshots: fetched on demand (not precached, to keep installs light).
              urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/data/'),
              handler: 'StaleWhileRevalidate',
              options: { cacheName: 'baked-data', expiration: { maxEntries: 20, maxAgeSeconds: 7 * 24 * 3600 } },
            },
            {
              // Pages: fresh when online, last copy (or the offline page) when not.
              urlPattern: ({ request }) => request.mode === 'navigate',
              handler: 'NetworkFirst',
              options: {
                cacheName: 'pages',
                networkTimeoutSeconds: 4,
                expiration: { maxEntries: 50, maxAgeSeconds: 7 * 24 * 3600 },
                precacheFallback: { fallbackURL: '/offline/index.html' },
              },
            },
            {
              urlPattern: new RegExp(`^${any(tileBase, fallback)}/v2/map/.*\\.(png|mvt)(\\?|$)`),
              handler: 'CacheFirst',
              options: {
                cacheName: 'gbif-tiles',
                expiration: { maxEntries: 2000, maxAgeSeconds: 7 * 24 * 3600, purgeOnQuotaError: true },
                cacheableResponse: { statuses: [200] },
              },
            },
            {
              urlPattern: new RegExp(`^${any(apiBase, fallback)}/v[12]/(?!image/)`),
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 'gbif-json',
                expiration: { maxEntries: 300, maxAgeSeconds: 24 * 3600, purgeOnQuotaError: true },
                cacheableResponse: { statuses: [200] },
              },
            },
            {
              // Basemap vector tiles, styles, sprites, glyphs and raster tiles.
              urlPattern: /^https:\/\/(tiles\.openfreemap\.org|tiles\.maps\.eox\.at|[a-c]?\.?tile\.opentopomap\.org)\//,
              handler: 'CacheFirst',
              options: {
                cacheName: 'basemap',
                expiration: { maxEntries: 1500, maxAgeSeconds: 30 * 24 * 3600, purgeOnQuotaError: true },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            {
              urlPattern: ({ request }) => request.destination === 'image',
              handler: 'CacheFirst',
              options: {
                cacheName: 'images',
                expiration: { maxEntries: 300, maxAgeSeconds: 30 * 24 * 3600, purgeOnQuotaError: true },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
          ],
        });

        for (const w of warnings) logger.warn(w);
        logger.info(`sw.js: precached ${count} files (${(size / 1024).toFixed(0)} KB)`);
      },
    },
  };
}
