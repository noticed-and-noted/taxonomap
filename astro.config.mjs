// @ts-check
import { defineConfig } from 'astro/config';
import vue from '@astrojs/vue';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { loadEnv } from 'vite';
import fileBudget from './integrations/file-budget.ts';
import serviceWorker from './integrations/service-worker.ts';

// Make .env values visible to build-time Node code (GBIF transport, SW
// integration) without overriding variables already set by CI.
for (const [k, v] of Object.entries(loadEnv(process.env.NODE_ENV ?? 'production', process.cwd(), ''))) {
  process.env[k] ??= v;
}

// public/_redirects rewrites /species/view/{key} to the view page on Pages; do the same in dev
// (`astro preview` drops Vite plugins, so it 404s there).
const rewriteSpeciesView = (/** @type {{ middlewares: import('vite').Connect.Server }} */ server) => {
  server.middlewares.use((req, _res, next) => {
    req.url = req.url?.replace(/^\/species\/view\/\d+\/?(?=\?|$)/, '/species/view/');
    next();
  });
};
const speciesViewRewrite = { name: 'species-view-rewrite', configureServer: rewriteSpeciesView };

const site = process.env.PUBLIC_SITE_URL || 'https://app.taxonomap.com';

export default defineConfig({
  site,
  output: 'static',
  trailingSlash: 'ignore',
  // Species pages wait on GBIF; render several at once (requests are still
  // capped at 5 concurrent by the build transport).
  build: { concurrency: 8 },
  integrations: [
    vue(),
    sitemap({
      // The /species/view fallback is noindex; keep it out of the sitemap.
      filter: (page) => !/\/(species\/view|offline|near|404)/.test(page),
    }),
    serviceWorker(),
    fileBudget(),
  ],
  prefetch: { prefetchAll: false, defaultStrategy: 'hover' },
  vite: {
    plugins: [tailwindcss(), speciesViewRewrite],
    // Only the e2e build ships sourcemaps, for the journeys' coverage.
    build: { sourcemap: process.env.E2E_SOURCEMAP === '1' },
    // Native/WASM build-time renderers for Open Graph images stay external.
    ssr: { external: ['@resvg/resvg-js', 'satori'] },
    optimizeDeps: { exclude: ['@resvg/resvg-js'] },
  },
});
