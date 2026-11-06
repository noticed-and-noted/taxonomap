/**
 * Endpoint configuration. Base URLs come from PUBLIC_* env vars so a caching
 * proxy (see /worker) can be swapped in without code changes.
 */
import { env } from '~/lib/env';

function stripSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

export const GBIF_API_BASE = stripSlash(env['PUBLIC_GBIF_API_BASE'] || 'https://api.gbif.org');
export const GBIF_TILE_BASE = stripSlash(env['PUBLIC_GBIF_TILE_BASE'] || GBIF_API_BASE);
/** GBIF's GraphQL API (the one gbif.org runs on): facets that carry names, and records per taxon, in one request. */
export const GBIF_GRAPHQL_BASE = stripSlash(env['PUBLIC_GBIF_GRAPHQL_BASE'] || 'https://graphql.gbif.org');

/** GBIF's public status page, linked (never fetched) when GBIF stops answering. */
export const GBIF_STATUS_URL = 'https://status.gbif.org';

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
