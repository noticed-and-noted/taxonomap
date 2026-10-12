/**
 * Endpoint configuration. Base URLs come from PUBLIC_* env vars so a caching
 * proxy (see /worker) can be swapped in without code changes.
 */

type EnvBag = Record<string, string | undefined>;

function readEnv(): EnvBag {
  // Vite (Astro build, dev, browser) exposes import.meta.env; plain Node
  // scripts and tests fall back to process.env.
  const viteEnv = (import.meta as unknown as { env?: EnvBag }).env ?? {};
  const nodeEnv: EnvBag = typeof process !== 'undefined' && typeof process.env === 'object' ? process.env : {};
  return { ...nodeEnv, ...viteEnv };
}

function stripSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

const env = readEnv();

export const GBIF_API_BASE = stripSlash(env['PUBLIC_GBIF_API_BASE'] || 'https://api.gbif.org');
export const GBIF_TILE_BASE = stripSlash(env['PUBLIC_GBIF_TILE_BASE'] || GBIF_API_BASE);
/** Where requests go when the edge cache (if configured) is unavailable. */
export const GBIF_FALLBACK_BASE = stripSlash(env['PUBLIC_GBIF_FALLBACK_BASE'] || 'https://api.gbif.org');

/** iNaturalist Research-grade Observations: well-framed photos with per-photo CC licences. */
export const INATURALIST_DATASET_KEY = '50c9509d-22c7-4a22-a47d-8c48425ef4a7';

/** GBIF Backbone Taxonomy dataset key. */
export const BACKBONE_DATASET_KEY = 'd7dddbf4-2cf0-4f39-9b2a-bb099caae36c';

/** Hard API limits verified against the live service. */
export const LIMITS = {
  maxPageSize: 300,
  /** offset + limit must not exceed this. */
  maxOffsetPlusLimit: 100_001,
} as const;
