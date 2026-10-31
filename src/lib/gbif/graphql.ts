/**
 * GBIF's GraphQL API, for what the REST API needs many requests for: facets
 * that carry each taxon's name or dataset's title, the first records of each
 * of many taxa, and many taxa's common names. Queries go as GET, so the HTTP cache, request sharing,
 * retries and the build's disk cache all apply, and the browser may cache
 * them (GBIF sends max-age).
 */
import { HOUR } from '~/lib/util/time';
import { GBIF_GRAPHQL_BASE } from './config';
import { http } from './http';
import { filterToParams, type FacetField, type OccurrenceFilter } from './occurrence';
import type { Params } from './params';
import type { FacetCount, Occurrence, Rank, VernacularName } from './types';

export type Predicate =
  | { type: 'and' | 'or'; predicates: Predicate[] }
  | { type: 'equals'; key: string; value: string }
  | { type: 'in'; key: string; values: string[] }
  | { type: 'within'; geometry: string };

/** A facet value with its taxon's scientific name or dataset's title, when GBIF has one. */
export interface NamedFacetCount extends FacetCount {
  label?: string;
}

/** A taxon's first matching records, and GBIF's scientific name for it. */
export interface TaxonRecords {
  name?: string;
  records: Occurrence[];
}

/** The envelope of every GraphQL answer: data, errors, or (when part of it failed) both. */
interface GraphqlResponse<T> {
  data?: T | null;
  errors?: { message: string }[];
}

/** One facet value as GraphQL sends it, with the label its selection asked for. */
interface FacetBucket {
  key: string | number;
  count: number;
  taxon?: { scientificName?: string } | null;
  dataset?: { title?: string } | null;
}

/** One taxon facet value with its first records (firstRecordsByTaxon). */
interface RecordsBucket {
  key: string;
  taxon?: { scientificName?: string } | null;
  occurrences: { documents: { results: GraphqlRecord[] } };
}

/** A record as GraphQL sends it, with nulls for missing values. */
type GraphqlRecord = { [Field in keyof Occurrence]?: Occurrence[Field] | null };

/** REST facet names GraphQL spells differently. */
const GRAPHQL_FACET: Partial<Record<FacetField, string>> = { country: 'countryCode' };

/** The facet that buckets records by their taxon at each rank. */
const RANK_FACET: Partial<Record<Rank, FacetField>> = {
  KINGDOM: 'kingdomKey',
  PHYLUM: 'phylumKey',
  CLASS: 'classKey',
  ORDER: 'orderKey',
  FAMILY: 'familyKey',
  GENUS: 'genusKey',
  SPECIES: 'speciesKey',
};

const DEFAULT_FACET_LIMIT = 200;

/** The record fields batched lookups read: enough for an iNaturalist match and for usableImages. */
const RECORD_FIELDS =
  'key datasetKey taxonID license rightsHolder publisher ' +
  'media { type identifier license creator rightsHolder publisher references }';

/**
 * GBIF's search predicate for REST query parameters. A range ("1990,2000",
 * "2020-01-01,*") stays one `equals` string, which GBIF reads exactly as REST
 * does; its `range` predicate counts dates differently.
 */
export function toPredicate(params: Params): { type: 'and'; predicates: Predicate[] } {
  const predicates: Predicate[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (key === 'geometry') predicates.push(geometryPredicate(value));
    else if (Array.isArray(value)) predicates.push({ type: 'in', key, values: value.map(String) });
    else predicates.push({ type: 'equals', key, value: String(value) });
  }
  return { type: 'and', predicates };
}

/** One polygon, or several OR'd (as REST ORs repeated geometry params). */
function geometryPredicate(value: Params[string]): Predicate {
  const polygons = (Array.isArray(value) ? value : [value]).map(String);
  const withins = polygons.map((geometry): Predicate => ({ type: 'within', geometry }));
  return withins.length === 1 ? withins[0]! : { type: 'or', predicates: withins };
}

/** True when GBIF answered with data; a body of only errors is a failure to retry, never to cache. */
function hasData(body: unknown): boolean {
  return !!(body as GraphqlResponse<unknown> | null)?.data;
}

/** True when every top-level field came back: GBIF answers a field it failed on (a 400 or 5xx upstream) with null. */
function isFullyAnswered(body: unknown): boolean {
  const data = (body as GraphqlResponse<Record<string, unknown>> | null)?.data;
  return !!data && Object.values(data).every((field) => field !== null);
}

/**
 * Runs one GraphQL query.
 * @param options.isComplete Whether a 200 body is a real answer; anything else is retried and never cached.
 * @throws GbifUnavailableError when GBIF keeps answering with errors, and the HTTP client's errors.
 */
async function runQuery<T>(
  query: string,
  variables: object,
  options: { signal?: AbortSignal | undefined; isComplete?: (body: unknown) => boolean } = {},
): Promise<T> {
  const { signal, isComplete = isFullyAnswered } = options;
  const response = await http().getJson<GraphqlResponse<T>>(
    `${GBIF_GRAPHQL_BASE}/graphql`,
    { query, variables: JSON.stringify(variables) },
    { ttlMs: HOUR, isComplete, ...(signal && { signal }) },
  );
  return response.data as T;
}

/** What GBIF can attach to a facet's values: the taxon's name, or the dataset's title. */
function labelSelection(field: FacetField): string {
  if (Object.values(RANK_FACET).includes(field)) return ' taxon { scientificName }';
  return field === 'datasetKey' ? ' dataset { title }' : '';
}

/** One facet's selection: counts, plus the name or title GBIF can attach. */
function facetSelection(field: FacetField, size: number): string {
  return `${GRAPHQL_FACET[field] ?? field}(size: ${size}) { key count${labelSelection(field)} }`;
}

/** A facet bucket as the REST API's facet count, with its label. */
function toNamedCount(bucket: FacetBucket): NamedFacetCount {
  const label = bucket.taxon?.scientificName ?? bucket.dataset?.title;
  // Year and month keys come back as numbers; REST (and every caller) has strings.
  return { name: String(bucket.key), count: bucket.count, ...(label && { label }) };
}

/**
 * Like occurrenceFacets, but each taxon facet value carries its scientific
 * name and each dataset its title, so callers need no lookup per value.
 * Facets come back under their REST names.
 */
export async function namedOccurrenceFacets(
  filter: OccurrenceFilter,
  facets: readonly FacetField[],
  options: { facetLimit?: number; limits?: Partial<Record<FacetField, number>>; signal?: AbortSignal } = {},
): Promise<{ count: number; facets: Record<string, NamedFacetCount[]> }> {
  const sizeOf = (field: FacetField) => options.limits?.[field] ?? options.facetLimit ?? DEFAULT_FACET_LIMIT;
  const selections = facets.map((field) => facetSelection(field, sizeOf(field))).join(' ');
  const query = `
    query Facets($predicate: Predicate) {
      occurrenceSearch(predicate: $predicate) {
        documents(size: 0) { total }
        facet { ${selections} }
      }
    }`;

  const data = await runQuery<{
    occurrenceSearch: { documents: { total: number }; facet: Record<string, FacetBucket[] | null> };
  }>(query, { predicate: toPredicate(filterToParams(filter)) }, { signal: options.signal });

  const { documents, facet } = data.occurrenceSearch;
  const byField = facets.map((field) => [field, (facet[GRAPHQL_FACET[field] ?? field] ?? []).map(toNamedCount)]);
  return { count: documents.total, facets: Object.fromEntries(byField) };
}

/** Whether firstRecordsByTaxon can batch taxa of this rank. */
export function canBatchRank(rank: Rank): boolean {
  return rank in RANK_FACET;
}

/**
 * The first few records of each taxon (all of one rank) that match a filter,
 * in the order a REST search for that taxon alone returns them, from one
 * request however many taxa: a common taxon can't crowd the rest out.
 * Taxa with no matching record are left out.
 * @param filter Extra conditions; its taxa are replaced by `keys`.
 * @throws Error when GBIF can't batch `rank` (see canBatchRank).
 */
export async function firstRecordsByTaxon(
  keys: readonly number[],
  rank: Rank,
  filter: OccurrenceFilter & { license?: readonly string[] },
  options: { perTaxon: number; signal?: AbortSignal },
): Promise<Map<number, TaxonRecords>> {
  const facet = RANK_FACET[rank];
  if (!facet) throw new Error(`GBIF can't batch records of rank ${rank}`);

  const { license, ...occurrenceFilter } = filter;
  const params = { ...filterToParams({ ...occurrenceFilter, taxonKeys: keys }), license };
  const records = `occurrences { documents(size: ${options.perTaxon}) { results { ${RECORD_FIELDS} } } }`;
  const query = `
    query FirstRecords($predicate: Predicate) {
      occurrenceSearch(predicate: $predicate) {
        facet { ${facet}(size: ${keys.length}) { key taxon { scientificName } ${records} } }
      }
    }`;

  const data = await runQuery<{ occurrenceSearch: { facet: Record<string, RecordsBucket[]> } }>(
    query,
    { predicate: toPredicate(params) },
    { signal: options.signal },
  );

  const buckets = data.occurrenceSearch.facet[facet] ?? [];
  return new Map(buckets.map((bucket) => [Number(bucket.key), toTaxonRecords(bucket, rank)]));
}

/** A bucket's records, each given the bucket's species key, and the taxon's name. */
function toTaxonRecords(bucket: RecordsBucket, rank: Rank): TaxonRecords {
  // GraphQL records leave their taxon keys null, but the bucket says whose they are.
  const speciesKey = rank === 'SPECIES' ? Number(bucket.key) : undefined;
  const records = bucket.occurrences.documents.results.map((record) => toOccurrence(record, speciesKey));
  const name = bucket.taxon?.scientificName;
  return { records, ...(name && { name }) };
}

/** A GraphQL record as the REST API's occurrence: nulls left out, and the species key filled in when known. */
function toOccurrence(record: GraphqlRecord, speciesKey: number | undefined): Occurrence {
  const present = Object.entries(record).filter(([, value]) => value !== null);
  const occurrence = Object.fromEntries(present) as unknown as Occurrence;
  return speciesKey === undefined ? occurrence : { ...occurrence, speciesKey };
}

/**
 * Every common name of each taxon, in all languages, from one request however many taxa.
 * GBIF's GraphQL draws on fewer checklists than REST's vernacularNames, so the name
 * `englishName()` picks can differ from a species page's. Taxa GBIF doesn't know are left out.
 */
export async function vernacularNamesByTaxon(
  keys: readonly number[],
  signal?: AbortSignal,
): Promise<Map<number, VernacularName[]>> {
  if (!keys.length) return new Map();

  const lookups = keys.map(
    (key) => `k${key}: taxonInfo(key: "${key}") { vernacularNames { vernacularName language } }`,
  );
  // An unknown key answers null (and a 404 error) beside the others' names, so it doesn't fail the batch.
  const data = await runQuery<Record<string, { vernacularNames?: VernacularName[] | null } | null>>(
    `query VernacularNames { ${lookups.join(' ')} }`,
    {},
    { signal, isComplete: hasData },
  );

  const byTaxon = new Map<number, VernacularName[]>();
  for (const key of keys) {
    const taxon = data[`k${key}`];
    if (taxon) byTaxon.set(key, taxon.vernacularNames ?? []);
  }
  return byTaxon;
}
