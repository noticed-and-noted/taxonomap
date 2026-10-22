import { BACKBONE_DATASET_KEY } from './config';
import { http } from './http';
import type { NameUsage, Paged, Rank, SuggestResult, VernacularName } from './types';

import { DAY, HOUR } from '~/lib/util/time';

/** A backbone taxon. @throws GbifNotFoundError when GBIF has no such taxon. */
export function getSpecies(key: number, signal?: AbortSignal): Promise<NameUsage> {
  return http().getJson(`/v1/species/${key}`, undefined, { ttlMs: DAY, ...(signal && { signal }) });
}

/** Scientific-name autocomplete. Does NOT match common names (verified). */
export function suggestSpecies(query: string, options: { limit?: number; rank?: Rank } = {}, signal?: AbortSignal) {
  return http().getJson<SuggestResult[]>(
    '/v1/species/suggest',
    { q: query.trim(), limit: options.limit ?? 8, rank: options.rank, datasetKey: BACKBONE_DATASET_KEY },
    { ttlMs: HOUR, ...(signal && { signal }) },
  );
}

/** Long-tail common-name search; ranking is poor, so callers re-rank. */
export function searchVernacular(query: string, options: { limit?: number } = {}, signal?: AbortSignal) {
  return http().getJson<Paged<NameUsage & { vernacularNames?: VernacularName[] }>>(
    '/v1/species/search',
    {
      q: query.trim(),
      qField: 'VERNACULAR',
      datasetKey: BACKBONE_DATASET_KEY,
      status: 'ACCEPTED',
      limit: options.limit ?? 10,
    },
    { ttlMs: HOUR, ...(signal && { signal }) },
  );
}

/** Bulk-list backbone taxa of one rank (for names without N+1 lookups). */
export function listByRank(rank: Rank, offset = 0, limit = 1000) {
  return http().getJson<Paged<NameUsage>>(
    '/v1/species/search',
    { rank, datasetKey: BACKBONE_DATASET_KEY, status: 'ACCEPTED', offset, limit },
    { ttlMs: DAY },
  );
}

/**
 * Enough to get every common name of even the most-named taxa, so every caller hands
 * `englishName()` the same full list and picks the same name.
 */
const VERNACULAR_NAME_LIMIT = 1000;

/** All common names of a taxon, in all languages. */
export function getVernacularNames(key: number, signal?: AbortSignal) {
  return http().getJson<Paged<VernacularName>>(
    `/v1/species/${key}/vernacularNames`,
    { limit: VERNACULAR_NAME_LIMIT },
    { ttlMs: DAY, ...(signal && { signal }) },
  );
}

/** Synonyms of a taxon, up to `limit`. */
export function getSynonyms(key: number, limit = 100) {
  return http().getJson<Paged<NameUsage>>(`/v1/species/${key}/synonyms`, { limit }, { ttlMs: DAY });
}

/** The accepted children of a taxon, one page at a time. */
export function getChildren(key: number, options: { limit?: number; offset?: number } = {}, signal?: AbortSignal) {
  return http().getJson<Paged<NameUsage>>(
    `/v1/species/${key}/children`,
    { limit: options.limit ?? 100, offset: options.offset },
    { ttlMs: DAY, ...(signal && { signal }) },
  );
}

/** A taxon's ancestors, from the kingdom down. */
export function getParents(key: number): Promise<NameUsage[]> {
  return http().getJson(`/v1/species/${key}/parents`, undefined, { ttlMs: DAY });
}

/**
 * Accepted species under each descendant of `key` (or under every taxon,
 * if no key), from one species-search facet on higherTaxonKey. Used as the
 * tree's "species" size metric without a request per node.
 */
export async function speciesCountsUnder(
  key?: number,
  facetLimit = 3000,
  signal?: AbortSignal,
): Promise<Map<number, number>> {
  const response = await http().getJson<{ facets?: { field: string; counts: { name: string; count: number }[] }[] }>(
    '/v1/species/search',
    {
      datasetKey: BACKBONE_DATASET_KEY,
      status: 'ACCEPTED',
      rank: 'SPECIES',
      highertaxonKey: key,
      facet: 'higherTaxonKey',
      facetLimit,
      limit: 0,
    },
    { ttlMs: DAY, ...(signal && { signal }) },
  );
  return new Map((response.facets?.[0]?.counts ?? []).map((facet) => [Number(facet.name), facet.count]));
}
