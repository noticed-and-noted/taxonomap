/**
 * Generates dist/sw.js with Workbox after the static build.
 *
 * @vite-pwa/astro does not support Astro 7 (its peer range stops at ^5), so
 * this small integration calls workbox-build directly.
 *
 * Strategies:
 *  - GBIF JSON:  CacheFirst, 24 h max age, 300 entries
 *  - Map tiles:  CacheFirst, 7 days, 2000 entries (empty 204 tiles too)
 *  - Images:     CacheFirst, 30 days, 300 entries (opaque responses allowed)
 *  - Basemaps:   CacheFirst, 30 days, 1500 entries (OpenFreeMap, EOX)
 *  - Pages:      NetworkFirst (4 s timeout), 50 entries; offline fallback page
 *  - Baked data: StaleWhileRevalidate (/data/*.json, on demand)
 *  - App shell:  precached (main routes, offline/404 pages, JS/CSS, Latin font subsets)
 */
import type { AstroIntegration } from 'astro';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generateSW } from 'workbox-build';

type RuntimeCaching = NonNullable<Parameters<typeof generateSW>[0]['runtimeCaching']>;

const SECONDS_PER_DAY = 24 * 3600;
const MAX_PRECACHED_FILE_BYTES = 3 * 1024 * 1024;
const PAGE_NETWORK_TIMEOUT_SECONDS = 4;
/** Pages that exist as static shells: the query string is client-side state, so one shell serves them all. */
const SHELL_PAGES = ['tree', 'near', 'species/view', 'offline'];
const SHELL_FILES = [
  'index.html',
  'tree/index.html',
  'near/index.html',
  'species/view/index.html',
  'offline/index.html',
  '404.html',
];

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const trimTrailingSlashes = (text: string) => text.replace(/\/+$/, '');

// An opaque copy (cached from a no-cors load) fails a crossorigin <img>; refetch so the CORS copy replaces it.
const noOpaqueForCors = {
  cachedResponseWillBeUsed: async ({ request, cachedResponse }: { request: Request; cachedResponse?: Response }) =>
    request.mode === 'cors' && cachedResponse?.type === 'opaque' ? null : cachedResponse,
};

/** What gets precached: the app shell, built JS/CSS and the Latin font subsets (only what the build produced). */
function precacheOptions(outDir: string) {
  const exists = (path: string) => existsSync(`${outDir}/${path}`);
  return {
    globDirectory: outDir,
    globPatterns: [
      ...SHELL_FILES.filter(exists),
      '_astro/*.{js,css}',
      '_astro/*-latin-*-normal*.woff2',
      'favicon.svg',
      'manifest.webmanifest',
    ],
    globIgnores: ['_astro/*-latin-ext-*'],
    maximumFileSizeToCacheInBytes: MAX_PRECACHED_FILE_BYTES,
    // Astro hashes everything in _astro/, so the URL is the revision.
    dontCacheBustURLsMatching: /\/_astro\//,
    // Serve page shells for "/tree", "/species/view" etc.: for pages the
    // query string is client-side state, and precached assets are hashed.
    templatedURLs: Object.fromEntries(
      SHELL_PAGES.filter((pageDir) => exists(`${pageDir}/index.html`)).map((pageDir) => [
        `/${pageDir}`,
        [`${pageDir}/index.html`],
      ]),
    ),
    ignoreURLParametersMatching: [/.*/],
  };
}

/** Baked snapshots and pages: the app's own content. */
function ownContentRules(): RuntimeCaching {
  return [
    {
      // The species manifest must match the deployed pages; a stale copy links to 404s.
      urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname === '/data/species-manifest.json',
      handler: 'NetworkFirst',
      options: { cacheName: 'baked-data', networkTimeoutSeconds: PAGE_NETWORK_TIMEOUT_SECONDS },
    },
    {
      // Baked snapshots: fetched on demand (not precached, to keep installs light).
      urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/data/'),
      handler: 'StaleWhileRevalidate',
      options: { cacheName: 'baked-data', expiration: { maxEntries: 20, maxAgeSeconds: 7 * SECONDS_PER_DAY } },
    },
    {
      // Pages: fresh when online, last copy (or the offline page) when not.
      urlPattern: ({ request }) => request.mode === 'navigate',
      handler: 'NetworkFirst',
      options: {
        cacheName: 'pages',
        networkTimeoutSeconds: PAGE_NETWORK_TIMEOUT_SECONDS,
        expiration: { maxEntries: 50, maxAgeSeconds: 7 * SECONDS_PER_DAY },
        precacheFallback: { fallbackURL: '/offline/index.html' },
      },
    },
  ];
}

/** GBIF map tiles and JSON. */
function gbifRules(apiBase: string, tileBase: string): RuntimeCaching {
  return [
    {
      urlPattern: new RegExp(`^${escapeRegExp(tileBase)}/v2/map/.*\\.(png|mvt)(\\?|$)`),
      handler: 'CacheFirst',
      options: {
        cacheName: 'gbif-tiles',
        expiration: { maxEntries: 2000, maxAgeSeconds: 7 * SECONDS_PER_DAY, purgeOnQuotaError: true },
        cacheableResponse: { statuses: [200, 204] },
      },
    },
    {
      // Cache first, not stale-while-revalidate: revalidating sent GBIF a request on every use.
      urlPattern: new RegExp(`^${escapeRegExp(apiBase)}/v[12]/(?!image/)`),
      handler: 'CacheFirst',
      options: {
        cacheName: 'gbif-json',
        expiration: { maxEntries: 300, maxAgeSeconds: SECONDS_PER_DAY, purgeOnQuotaError: true },
        cacheableResponse: { statuses: [200] },
      },
    },
  ];
}

/** Third-party basemaps and images, which may be opaque (no-cors) responses. */
function mediaRules(): RuntimeCaching {
  return [
    {
      // Basemap vector tiles, styles, sprites, glyphs and raster tiles.
      urlPattern: /^https:\/\/(tiles\.openfreemap\.org|tiles\.maps\.eox\.at)\//,
      handler: 'CacheFirst',
      options: {
        cacheName: 'basemap',
        expiration: { maxEntries: 1500, maxAgeSeconds: 30 * SECONDS_PER_DAY, purgeOnQuotaError: true },
        cacheableResponse: { statuses: [0, 200] },
        plugins: [noOpaqueForCors],
      },
    },
    {
      urlPattern: ({ request }) => request.destination === 'image',
      handler: 'CacheFirst',
      options: {
        cacheName: 'images',
        expiration: { maxEntries: 300, maxAgeSeconds: 30 * SECONDS_PER_DAY, purgeOnQuotaError: true },
        cacheableResponse: { statuses: [0, 200] },
        plugins: [noOpaqueForCors],
      },
    },
  ];
}

/** Caching rules for data fetched at runtime, in the order Workbox tries them. */
function runtimeCaching(apiBase: string, tileBase: string): RuntimeCaching {
  return [...ownContentRules(), ...gbifRules(apiBase, tileBase), ...mediaRules()];
}

/** Astro integration that writes dist/sw.js once the static build is done. */
export default function serviceWorker(): AstroIntegration {
  return {
    name: 'taxonomap:service-worker',
    hooks: {
      'astro:build:done': async ({ dir, logger }) => {
        const apiBase = trimTrailingSlashes(process.env['PUBLIC_GBIF_API_BASE'] || 'https://api.gbif.org');
        const tileBase = trimTrailingSlashes(process.env['PUBLIC_GBIF_TILE_BASE'] || apiBase);
        const outDir = fileURLToPath(dir);

        const { count, size, warnings } = await generateSW({
          swDest: `${outDir}/sw.js`,
          ...precacheOptions(outDir),
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          skipWaiting: true,
          sourcemap: false,
          runtimeCaching: runtimeCaching(apiBase, tileBase),
        });

        for (const warning of warnings) logger.warn(warning);
        logger.info(`sw.js: precached ${count} files (${(size / 1024).toFixed(0)} KB)`);
      },
    },
  };
}
