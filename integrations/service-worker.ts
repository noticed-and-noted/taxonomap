/**
 * Generates dist/sw.js with Workbox after the static build.
 *
 * @vite-pwa/astro does not support Astro 7 (its peer range stops at ^5), so
 * this small integration calls workbox-build directly.
 *
 * Strategies:
 *  - GBIF JSON:  CacheFirst, 24 h max age, 300 entries (REST, and GraphQL answers without errors)
 *  - Map tiles:  CacheFirst, 7 days, 2000 entries (empty 204 tiles too)
 *  - Images:     CacheFirst, 30 days, 300 entries (opaque responses allowed)
 *  - Basemaps:   CacheFirst, 30 days, 1500 entries (OpenFreeMap, EOX)
 *  - Pages:      NetworkOnly; the offline page whenever the network fails
 *  - Baked data: StaleWhileRevalidate (/data/*.json, on demand)
 *  - Name search: StaleWhileRevalidate (/search-data/*, on demand, in a cache of its own)
 *  - Precached:  the offline page and what it needs (JS/CSS, Latin font subsets)
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { AstroIntegration } from 'astro';
import { generateSW, type ManifestTransform } from 'workbox-build';

type RuntimeCaching = NonNullable<Parameters<typeof generateSW>[0]['runtimeCaching']>;

const SECONDS_PER_DAY = 24 * 3600;
const MAX_PRECACHED_FILE_BYTES = 3 * 1024 * 1024;
const NETWORK_TIMEOUT_SECONDS = 4;
const OFFLINE_PAGE = 'offline/index.html';

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
/** The URL Cloudflare Pages serves a built file at, so precaching doesn't follow a redirect. */
const servedUrl = (path: string) => `/${path.replace(/(^|\/)index\.html$/, '$1').replace(/\.html$/, '')}`;
const toServedUrls: ManifestTransform = async (entries) => ({
  manifest: entries.map((entry) => ({ ...entry, url: servedUrl(entry.url) })),
  warnings: [],
});
const trimTrailingSlashes = (text: string) => text.replace(/\/+$/, '');

// An opaque copy (cached from a no-cors load) fails a crossorigin <img>; refetch so the CORS copy replaces it.
const noOpaqueForCors = {
  cachedResponseWillBeUsed: async ({ request, cachedResponse }: { request: Request; cachedResponse?: Response }) =>
    request.mode === 'cors' && cachedResponse?.type === 'opaque' ? null : cachedResponse,
};

// GraphQL errors come as a 200; a cached one would answer every retry with the same failure.
const noGraphqlErrors = {
  cacheWillUpdate: async ({ response }: { response: Response }) => {
    const body = (await response
      .clone()
      .json()
      .catch(() => null)) as { errors?: unknown } | null;
    return body && body.errors === undefined ? response : null;
  },
};

/** What gets precached: the offline page, built JS/CSS and the Latin font subsets (only what the build produced). */
function precacheOptions(outDir: string) {
  return {
    globDirectory: outDir,
    globPatterns: [
      ...(existsSync(`${outDir}/${OFFLINE_PAGE}`) ? [OFFLINE_PAGE] : []),
      '_astro/*.{js,css}',
      '_astro/*-latin-*-normal*.woff2',
      'favicon.svg',
      'manifest.webmanifest',
    ],
    globIgnores: ['_astro/*-latin-ext-*'],
    maximumFileSizeToCacheInBytes: MAX_PRECACHED_FILE_BYTES,
    // Astro hashes everything in _astro/, so the URL is the revision and the HTTP cache copy can be reused.
    // Manifest URLs have no leading slash.
    dontCacheBustURLsMatching: /^_astro\//,
    // Precache the offline page under the URL Pages serves it at ("offline/"), not the 308 from "offline/index.html".
    manifestTransforms: [toServedUrls],
  };
}

/** Baked snapshots and pages: the app's own content. */
function ownContentRules(): RuntimeCaching {
  return [
    {
      // The species manifest must match the deployed pages; a stale copy links to 404s.
      urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname === '/data/species-manifest.json',
      handler: 'NetworkFirst',
      options: { cacheName: 'baked-data', networkTimeoutSeconds: NETWORK_TIMEOUT_SECONDS },
    },
    {
      // Baked snapshots: fetched on demand (not precached, to keep installs light).
      urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/data/'),
      handler: 'StaleWhileRevalidate',
      options: { cacheName: 'baked-data', expiration: { maxEntries: 20, maxAgeSeconds: 7 * SECONDS_PER_DAY } },
    },
    {
      // Thousands of small files, so never precached and kept apart from the snapshots they'd evict.
      urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/search-data/'),
      handler: 'StaleWhileRevalidate',
      options: {
        cacheName: 'name-search',
        expiration: { maxEntries: 300, maxAgeSeconds: 7 * SECONDS_PER_DAY, purgeOnQuotaError: true },
      },
    },
    {
      // Pages: never a saved copy; offline, every page is the offline page.
      urlPattern: ({ request }) => request.mode === 'navigate',
      handler: 'NetworkOnly',
      options: { precacheFallback: { fallbackURL: '/offline/' } },
    },
  ];
}

/** GBIF map tiles and JSON. */
function gbifRules(apiBase: string, tileBase: string, graphqlBase: string): RuntimeCaching {
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
    {
      urlPattern: new RegExp(`^${escapeRegExp(graphqlBase)}/graphql\\?`),
      handler: 'CacheFirst',
      options: {
        cacheName: 'gbif-graphql',
        expiration: { maxEntries: 300, maxAgeSeconds: SECONDS_PER_DAY, purgeOnQuotaError: true },
        cacheableResponse: { statuses: [200] },
        plugins: [noGraphqlErrors],
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
function runtimeCaching(apiBase: string, tileBase: string, graphqlBase: string): RuntimeCaching {
  return [...ownContentRules(), ...gbifRules(apiBase, tileBase, graphqlBase), ...mediaRules()];
}

/** Astro integration that writes dist/sw.js once the static build is done. */
export default function serviceWorker(): AstroIntegration {
  return {
    name: 'taxonomap:service-worker',
    hooks: {
      'astro:build:done': async ({ dir, logger }) => {
        const apiBase = trimTrailingSlashes(process.env['PUBLIC_GBIF_API_BASE'] || 'https://api.gbif.org');
        const tileBase = trimTrailingSlashes(process.env['PUBLIC_GBIF_TILE_BASE'] || apiBase);
        const graphqlBase = trimTrailingSlashes(process.env['PUBLIC_GBIF_GRAPHQL_BASE'] || 'https://graphql.gbif.org');
        const outDir = fileURLToPath(dir);

        const { count, size, warnings } = await generateSW({
          swDest: `${outDir}/sw.js`,
          ...precacheOptions(outDir),
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          // A new deploy waits for the reader to choose "Reload" (BaseLayout) rather than reloading under them.
          skipWaiting: false,
          sourcemap: false,
          runtimeCaching: runtimeCaching(apiBase, tileBase, graphqlBase),
        });

        for (const warning of warnings) logger.warn(warning);
        logger.info(`sw.js: precached ${count} files (${(size / 1024).toFixed(0)} KB)`);
      },
    },
  };
}
