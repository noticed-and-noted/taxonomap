import { LIMITS } from './config';
import { http } from './http';
import { yearRangeParam, type Params } from './params';
import type { BasisOfRecord, Continent, Facet, FacetCount, IucnCategory, Occurrence, OccurrenceSearch } from './types';

import { DAY, HOUR } from '~/lib/util/time';

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
}

export function refinementParams(r: Refinements): Params {
  const media = [r.hasImage && 'StillImage', r.hasSound && 'Sound'].filter((m): m is string => !!m);
  return {
    mediaType: media.length ? media : undefined,
    month: r.months,
    continent: r.continents,
    coordinateUncertaintyInMeters: r.maxUncertaintyM ? `0,${r.maxUncertaintyM}` : undefined,
    iucnRedListCategory: r.iucn,
    eventDate: r.eventDate,
  };
}

/** True when any refinement applies (so map tiles must use the adhoc endpoint). */
export function hasRefinements(r: Refinements): boolean {
  return Object.values(refinementParams(r)).some((v) => v !== undefined);
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
  /** WKT polygon (already rounded via params helpers). */
  geometry?: string | undefined;
  datasetKey?: string | undefined;
  /** Restrict to records with usable coordinates (matches what the map shows). */
  georeferenced?: boolean | undefined;
}

/** The taxa as taxonKey (taxon and everything under it) or, when exact, acceptedTaxonKey. */
export function taxonParams(f: Pick<OccurrenceFilter, 'taxonKey' | 'taxonKeys' | 'exactTaxon'>): Params {
  const keys = f.taxonKeys ?? f.taxonKey;
  return f.exactTaxon && keys !== undefined ? { acceptedTaxonKey: keys } : { taxonKey: keys };
}

export function filterToParams(f: OccurrenceFilter): Params {
  return {
    ...taxonParams(f),
    speciesKey: f.speciesKeys,
    classKey: f.classKey,
    year: yearRangeParam(f.year),
    ...refinementParams(f),
    // A single month (e.g. a chart drill-down) narrows any month refinement.
    month: f.month ?? f.months,
    basisOfRecord: f.basisOfRecord,
    country: f.country,
    geometry: f.geometry,
    datasetKey: f.datasetKey,
    hasCoordinate: f.georeferenced ? true : undefined,
    hasGeospatialIssue: f.georeferenced ? false : undefined,
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
  opts: {
    facetLimit?: number;
    /** Per-field limits (GBIF's `<field>.facetLimit`), e.g. { year: 600, country: 10 }. */
    limits?: Partial<Record<FacetField, number>>;
    /** Offset into facet values, for paging (applies to every facet). */
    facetOffset?: number;
    signal?: AbortSignal;
  } = {},
): Promise<{ count: number; facets: Record<string, FacetCount[]> }> {
  const perField = Object.fromEntries(Object.entries(opts.limits ?? {}).map(([k, v]) => [`${k}.facetLimit`, v]));
  const res = await http().getJson<OccurrenceSearch>(
    '/v1/occurrence/search',
    {
      ...filterToParams(filter),
      limit: 0,
      facet: facets,
      facetLimit: opts.facetLimit ?? 200,
      facetOffset: opts.facetOffset || undefined,
      ...perField,
    },
    { ttlMs: HOUR, ...(opts.signal && { signal: opts.signal }) },
  );
  return { count: res.count, facets: indexFacets(res.facets ?? []) };
}

/** "YEAR" → "year", "SPECIES_KEY" → "speciesKey". */
export function facetFieldName(field: string): string {
  return field.toLowerCase().replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

export function indexFacets(facets: readonly Facet[]): Record<string, FacetCount[]> {
  return Object.fromEntries(facets.map((f) => [facetFieldName(f.field), f.counts]));
}

export async function occurrenceCount(filter: OccurrenceFilter, signal?: AbortSignal): Promise<number> {
  const res = await http().getJson<OccurrenceSearch>(
    '/v1/occurrence/search',
    { ...filterToParams(filter), limit: 0 },
    { ttlMs: HOUR, ...(signal && { signal }) },
  );
  return res.count;
}

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

export function getOccurrence(key: number): Promise<Occurrence> {
  return http().getJson(`/v1/occurrence/${key}`, undefined, { ttlMs: DAY });
}
