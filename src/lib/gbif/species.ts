import pLimit from 'p-limit';
import { DAY, HOUR } from '~/lib/util/time';
import { BACKBONE_DATASET_KEY } from './config';
import { http } from './http';
import type { Distribution, NameUsage, Paged, Rank, SuggestResult, VernacularName } from './types';

/** A backbone taxon. @throws GbifNotFoundError when GBIF has no such taxon. */
export function getSpecies(key: number, signal?: AbortSignal): Promise<NameUsage> {
  return http().getJson(`/v1/species/${key}`, undefined, { ttlMs: DAY, ...(signal && { signal }) });
}

/** Scientific-name autocomplete. Does NOT match common names (verified). */
export function suggestSpecies(query: string, options: { limit?: number; rank?: Rank } = {}, signal?: AbortSignal) {
  return http().getJson<SuggestResult[]>(
    '/v1/species/suggest',
    {
      q: query.trim(),
      limit: options.limit ?? 8,
      rank: options.rank,
      datasetKey: BACKBONE_DATASET_KEY,
      // Doubtful names and homonyms of a real taxon would show as twins of it.
      status: 'ACCEPTED',
    },
    { ttlMs: HOUR, ...(signal && { signal }) },
  );
}

type NameSearch = Paged<NameUsage & { vernacularNames?: VernacularName[] }>;

/** The backbone's accepted names matching `query`, in `qField` (every name field when none). */
function searchBackbone(query: string, limit: number, qField: string | undefined, signal?: AbortSignal) {
  return http().getJson<NameSearch>(
    '/v1/species/search',
    { q: query.trim(), qField, datasetKey: BACKBONE_DATASET_KEY, status: 'ACCEPTED', limit },
    { ttlMs: HOUR, ...(signal && { signal }) },
  );
}

/** Long-tail common-name search; ranking is poor, so callers re-rank. */
export function searchVernacular(query: string, options: { limit?: number } = {}, signal?: AbortSignal) {
  return searchBackbone(query, options.limit ?? 10, 'VERNACULAR', signal);
}

/** Scientific and common names in one search, each result carrying its common names; callers re-rank. */
export function searchNames(query: string, options: { limit?: number } = {}, signal?: AbortSignal) {
  return searchBackbone(query, options.limit ?? 20, undefined, signal);
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

/** GBIF's page-size cap for species search (larger limits are silently cut to this). */
const SEARCH_PAGE = 1000;
/** Stops runaway paging; the largest families have about 6,000 accepted genera. */
const MAX_SEARCH_PAGES = 20;
// Bursts of parallel searches trip GBIF's rate limit.
const PAGE_CONCURRENCY = 2;

export type UsageWithNames = NameUsage & { vernacularNames?: VernacularName[] };

/**
 * Every accepted taxon of `rank` under `key` (its children, for the next rank down). Search
 * skips the synonyms that make up a third of the children endpoint, and its count lets the
 * pages after the first load in parallel.
 */
export async function getAllChildren(key: number, rank: Rank, signal?: AbortSignal): Promise<UsageWithNames[]> {
  const page = (offset: number) =>
    http().getJson<Paged<UsageWithNames>>(
      '/v1/species/search',
      { datasetKey: BACKBONE_DATASET_KEY, highertaxonKey: key, rank, status: 'ACCEPTED', limit: SEARCH_PAGE, offset },
      { ttlMs: DAY, ...(signal && { signal }) },
    );
  const first = await page(0);
  const pageCount = Math.min(Math.ceil((first.count ?? 0) / SEARCH_PAGE), MAX_SEARCH_PAGES);
  const limit = pLimit(PAGE_CONCURRENCY);
  const rest = await Promise.all(
    Array.from({ length: Math.max(pageCount - 1, 0) }, (_unused, index) =>
      limit(() => page((index + 1) * SEARCH_PAGE)),
    ),
  );
  return [first, ...rest].flatMap((response) => response.results);
}

/** A taxon's global IUCN Red List category; `code` is "NE" when it was never assessed. */
export function getRedListCategory(key: number) {
  return http().getJson<{ code?: string; iucnTaxonID?: string }>(`/v1/species/${key}/iucnRedListCategory`, undefined, {
    ttlMs: DAY,
  });
}

// Widespread species run to a few hundred rows; one page covers them.
const DISTRIBUTION_LIMIT = 1000;

/** Where checklists say a taxon occurs, and whether it is native or introduced there. */
export function getDistributions(key: number) {
  return http().getJson<Paged<Distribution>>(
    `/v1/species/${key}/distributions`,
    { limit: DISTRIBUTION_LIMIT },
    { ttlMs: DAY },
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
