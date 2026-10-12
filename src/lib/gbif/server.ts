/**
 * Build-time entry point. Importing this module switches the shared client to
 * the Node transport (User-Agent, concurrency cap, disk cache). Use it from
 * Astro frontmatter, getStaticPaths, endpoints and scripts — never islands.
 */
import { configureHttp } from './http';
import { createNodeTransport } from './node-transport';

configureHttp({ transport: createNodeTransport(), defaultTtlMs: 24 * 3_600_000, cacheSize: 5000 });

export * from './index';
