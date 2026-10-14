// @ts-check
import { defineConfig } from 'astro/config';
import vue from '@astrojs/vue';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { loadEnv } from 'vite';
import serviceWorker from './integrations/service-worker.ts';

// Make .env values visible to build-time Node code (GBIF transport, SW
// integration) without overriding variables already set by CI.
for (const [k, v] of Object.entries(loadEnv(process.env.NODE_ENV ?? 'production', process.cwd(), ''))) {
  process.env[k] ??= v;
}

const site = process.env.PUBLIC_SITE_URL ?? 'https://gbif-explorer.pages.dev';

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
  ],
  prefetch: { prefetchAll: false, defaultStrategy: 'hover' },
  vite: {
    plugins: [tailwindcss()],
    // Native/WASM build-time renderers for Open Graph images stay external.
    ssr: { external: ['@resvg/resvg-js', 'satori'] },
    optimizeDeps: { exclude: ['@resvg/resvg-js'] },
  },
});
