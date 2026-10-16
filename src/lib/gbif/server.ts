/**
 * Build-time entry point. Importing this module switches the shared client to
 * the Node transport (User-Agent, concurrency cap, disk cache). Use it from
 * Astro frontmatter, getStaticPaths, endpoints and scripts — never islands.
 */
import { DAY } from '~/lib/util/time';
import { configureHttp } from './http';
import { createNodeTransport } from './node-transport';

configureHttp({
  transport: createNodeTransport(),
  defaultTtlMs: DAY,
  cacheSize: 5000,
});

export * from './index';
