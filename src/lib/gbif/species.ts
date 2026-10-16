import { BACKBONE_DATASET_KEY } from './config';
import { http } from './http';
import type { MatchV1, MatchV2, NameUsage, Paged, Rank, SuggestResult, VernacularName } from './types';

import { DAY, HOUR } from '~/lib/util/time';

export function getSpecies(key: number, signal?: AbortSignal): Promise<NameUsage> {
  return http().getJson(`/v1/species/${key}`, undefined, { ttlMs: DAY, ...(signal && { signal }) });
}

/** Scientific-name autocomplete. Does NOT match common names (verified). */
export function suggestSpecies(q: string, opts: { limit?: number; rank?: Rank } = {}, signal?: AbortSignal) {
  return http().getJson<SuggestResult[]>(
    '/v1/species/suggest',
    { q: q.trim(), limit: opts.limit ?? 8, rank: opts.rank, datasetKey: BACKBONE_DATASET_KEY },
    { ttlMs: HOUR, ...(signal && { signal }) },
  );
}

/** Long-tail common-name search; ranking is poor, so callers re-rank. */
export function searchVernacular(q: string, opts: { limit?: number } = {}, signal?: AbortSignal) {
  return http().getJson<Paged<NameUsage & { vernacularNames?: VernacularName[] }>>(
    '/v1/species/search',
    {
      q: q.trim(),
      qField: 'VERNACULAR',
      datasetKey: BACKBONE_DATASET_KEY,
      status: 'ACCEPTED',
      limit: opts.limit ?? 10,
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

export function matchName(name: string): Promise<MatchV1> {
  return http().getJson('/v1/species/match', { name }, { ttlMs: DAY });
}

export function matchNameV2(scientificName: string): Promise<MatchV2> {
  return http().getJson('/v2/species/match', { scientificName }, { ttlMs: DAY });
}

export function getVernacularNames(key: number, limit = 300) {
  return http().getJson<Paged<VernacularName>>(`/v1/species/${key}/vernacularNames`, { limit }, { ttlMs: DAY });
}

export function getSynonyms(key: number, limit = 100) {
  return http().getJson<Paged<NameUsage>>(`/v1/species/${key}/synonyms`, { limit }, { ttlMs: DAY });
}

export function getChildren(key: number, opts: { limit?: number; offset?: number } = {}, signal?: AbortSignal) {
  return http().getJson<Paged<NameUsage>>(
    `/v1/species/${key}/children`,
    { limit: opts.limit ?? 100, offset: opts.offset },
    { ttlMs: DAY, ...(signal && { signal }) },
  );
}

export function getParents(key: number): Promise<NameUsage[]> {
  return http().getJson(`/v1/species/${key}/parents`, undefined, { ttlMs: DAY });
}

/** Prefer an English vernacular name, falling back to any. */
export function pickCommonName(names: readonly VernacularName[], langs = ['eng', 'en']): string | undefined {
  const inLang = names.filter((n) => n.language && langs.includes(n.language));
  return (inLang.find((n) => n.preferred) ?? inLang[0])?.vernacularName;
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
  const res = await http().getJson<{ facets?: { field: string; counts: { name: string; count: number }[] }[] }>(
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
  return new Map((res.facets?.[0]?.counts ?? []).map((c) => [Number(c.name), c.count]));
}
