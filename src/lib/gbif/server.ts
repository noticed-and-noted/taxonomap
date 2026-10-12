/**
 * Build-time entry point. Importing this module switches the shared client to
 * the Node transport (User-Agent, concurrency cap, disk cache). Use it from
 * Astro frontmatter, getStaticPaths, endpoints and scripts — never islands.
 */
import { GBIF_FALLBACK_BASE } from './config';
import { configureHttp } from './http';
import { createNodeTransport } from './node-transport';

// Build time talks to GBIF directly, never through the edge cache: it has its
// own disk cache and User-Agent, and must not spend the Worker's quota.
configureHttp({
  base: GBIF_FALLBACK_BASE,
  transport: createNodeTransport(),
  defaultTtlMs: 24 * 3_600_000,
  cacheSize: 5000,
});

export * from './index';
