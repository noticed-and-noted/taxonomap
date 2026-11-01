import { DAY, HOUR } from '~/lib/util/time';
import { LIMITS } from './config';
import { http } from './http';
import { yearRangeParam, type Params } from './params';
import type { BasisOfRecord, Continent, Facet, FacetCount, IucnCategory, Occurrence, OccurrenceSearch } from './types';

/**
 * Filters that both the search API and the adhoc map tiles accept, but the
 * (cheaper) density tiles ignore. Repeated values are OR'd by GBIF.
 */
export interface Refinements {
  hasImage?: boolean | undefined;
  hasSound?: boolean | undefined;
  /** Months 1–12. */
  months?: readonly number[] | undefined;
  continents?: readonly Continent[] | undefined;
  /** Keep records whose stated coordinate uncertainty is at most this; drops records without one. */
  maxUncertaintyM?: number | undefined;
  iucn?: readonly IucnCategory[] | undefined;
  /** GBIF date range "YYYY-MM-DD,YYYY-MM-DD" ("*" for an open end). */
  eventDate?: string | undefined;
  /** Publishing organisation keys (publishingOrg), OR'd. */
  publishers?: readonly string[] | undefined;
}

/** Query parameters for the refinement filters (media, basis of record, and so on). */
export function refinementParams(refinements: Refinements): Params {
  const media = [refinements.hasImage && 'StillImage', refinements.hasSound && 'Sound'].filter(
    (medium): medium is string => !!medium,
  );
  return {
    mediaType: media.length ? media : undefined,
    month: refinements.months,
    continent: refinements.continents,
    coordinateUncertaintyInMeters: refinements.maxUncertaintyM ? `0,${refinements.maxUncertaintyM}` : undefined,
    iucnRedListCategory: refinements.iucn,
    eventDate: refinements.eventDate,
    publishingOrg: refinements.publishers,
  };
}

/** True when any refinement applies (so map tiles must use the adhoc endpoint). */
export function hasRefinements(refinements: Refinements): boolean {
  return Object.values(refinementParams(refinements)).some((value) => value !== undefined);
}

/** Shared occurrence filter used by maps, panels and charts. */
export interface OccurrenceFilter extends Refinements {
  taxonKey?: number | undefined;
  /** Several taxa of any rank (repeated taxonKey, OR'd); takes precedence over taxonKey. */
  taxonKeys?: readonly number[] | undefined;
  /** Match only records filed at exactly these taxa, not their subspecies or lower ranks (acceptedTaxonKey). */
  exactTaxon?: boolean | undefined;
  /** Several species at once (repeated speciesKey param). */
  speciesKeys?: readonly number[] | undefined;
  /** Narrow to one class (AND'd with any taxa, unlike taxonKey). */
  classKey?: number | undefined;
  year?: readonly [number, number] | null | undefined;
  month?: number | undefined;
  basisOfRecord?: readonly BasisOfRecord[] | undefined;
  country?: string | undefined;
  /** WKT polygon (already rounded via params helpers); several are OR'd. */
  geometry?: string | readonly string[] | undefined;
  datasetKey?: string | undefined;
  /** Restrict to records with usable coordinates (matches what the map shows). */
  georeferenced?: boolean | undefined;
}

/** The taxa as taxonKey (taxon and everything under it) or, when exact, acceptedTaxonKey. */
export function taxonParams(filter: Pick<OccurrenceFilter, 'taxonKey' | 'taxonKeys' | 'exactTaxon'>): Params {
  const keys = filter.taxonKeys ?? filter.taxonKey;
  return filter.exactTaxon && keys !== undefined ? { acceptedTaxonKey: keys } : { taxonKey: keys };
}

/** Query parameters for an occurrence filter, with unset fields left out. */
export function filterToParams(filter: OccurrenceFilter): Params {
  // The map tiles leave out records with geospatial issues (e.g. a 0,0 placeholder), so area queries must too.
  const georeferenced = filter.georeferenced || filter.geometry !== undefined;
  return {
    ...taxonParams(filter),
    speciesKey: filter.speciesKeys,
    classKey: filter.classKey,
    year: yearRangeParam(filter.year),
    ...refinementParams(filter),
    // A single month (e.g. a chart drill-down) narrows any month refinement.
    month: filter.month ?? filter.months,
    basisOfRecord: filter.basisOfRecord,
    country: filter.country,
    geometry: filter.geometry,
    datasetKey: filter.datasetKey,
    hasCoordinate: georeferenced ? true : undefined,
    hasGeospatialIssue: georeferenced ? false : undefined,
  };
}

export type FacetField =
  | 'year'
  | 'month'
  | 'country'
  | 'datasetKey'
  | 'speciesKey'
  | 'kingdomKey'
  | 'phylumKey'
  | 'classKey'
  | 'orderKey'
  | 'familyKey'
  | 'genusKey'
  | 'basisOfRecord';

/** Aggregates via limit=0 + facets. One request regardless of facet count. */
export async function occurrenceFacets(
  filter: OccurrenceFilter,
  facets: readonly FacetField[],
  options: {
    facetLimit?: number;
    /** Per-field limits (GBIF's `<field>.facetLimit`), e.g. { year: 600, country: 10 }. */
    limits?: Partial<Record<FacetField, number>>;
    /** Offset into facet values, for paging (applies to every facet). */
    facetOffset?: number;
    signal?: AbortSignal;
  } = {},
): Promise<{ count: number; facets: Record<string, FacetCount[]> }> {
  const perField = Object.fromEntries(
    Object.entries(options.limits ?? {}).map(([field, limit]) => [`${field}.facetLimit`, limit]),
  );
  const response = await http().getJson<OccurrenceSearch>(
    '/v1/occurrence/search',
    {
      ...filterToParams(filter),
      limit: 0,
      facet: facets,
      facetLimit: options.facetLimit ?? 200,
      facetOffset: options.facetOffset || undefined,
      ...perField,
    },
    { ttlMs: HOUR, ...(options.signal && { signal: options.signal }) },
  );
  return { count: response.count, facets: indexFacets(response.facets ?? []) };
}

export const MONTHS_IN_YEAR = 12;

/** Records per calendar month (index 0 = January) from a `month` facet. */
export function monthCounts(monthFacet: readonly FacetCount[] | undefined): number[] {
  const months = Array<number>(MONTHS_IN_YEAR).fill(0);
  for (const entry of monthFacet ?? []) months[Number(entry.name) - 1] = entry.count;
  return months;
}

/** "YEAR" → "year", "SPECIES_KEY" → "speciesKey". */
export function facetFieldName(field: string): string {
  return field.toLowerCase().replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

/** Facet lists keyed by camel-cased field name. */
export function indexFacets(facets: readonly Facet[]): Record<string, FacetCount[]> {
  return Object.fromEntries(facets.map((facet) => [facetFieldName(facet.field), facet.counts]));
}

/**
 * Number of occurrences matching a filter.
 * @throws GbifRequestError or GbifUnavailableError when GBIF cannot answer.
 */
export async function occurrenceCount(filter: OccurrenceFilter, signal?: AbortSignal): Promise<number> {
  const response = await http().getJson<OccurrenceSearch>(
    '/v1/occurrence/search',
    { ...filterToParams(filter), limit: 0 },
    { ttlMs: HOUR, ...(signal && { signal }) },
  );
  return response.count;
}

/**
 * One page of occurrence records. A page beyond GBIF's paging limit comes back empty rather than as an error.
 * @param page Page size (capped) and offset.
 */
export function searchOccurrences(
  filter: OccurrenceFilter,
  page: { limit?: number; offset?: number } = {},
  signal?: AbortSignal,
): Promise<OccurrenceSearch> {
  const limit = Math.min(page.limit ?? 20, LIMITS.maxPageSize);
  const offset = Math.max(0, page.offset ?? 0);
  if (offset + limit > LIMITS.maxOffsetPlusLimit) {
    return Promise.resolve({ offset, limit, endOfRecords: true, count: 0, results: [] });
  }
  return http().getJson(
    '/v1/occurrence/search',
    { ...filterToParams(filter), limit, offset },
    {
      ttlMs: HOUR,
      ...(signal && { signal }),
    },
  );
}

/**
 * One occurrence record.
 * @throws GbifNotFoundError when there is no such record.
 */
export function getOccurrence(key: number): Promise<Occurrence> {
  return http().getJson(`/v1/occurrence/${key}`, undefined, { ttlMs: DAY });
}
