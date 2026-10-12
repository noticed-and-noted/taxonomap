import { LIMITS } from './config';
import { http } from './http';
import { circleToWkt, yearRangeParam, type Params } from './params';
import type { BasisOfRecord, Facet, FacetCount, Occurrence, OccurrenceSearch } from './types';

const HOUR = 3_600_000;

/** Shared occurrence filter used by maps, panels and charts. */
export interface OccurrenceFilter {
  taxonKey?: number | undefined;
  year?: readonly [number, number] | null | undefined;
  month?: number | undefined;
  basisOfRecord?: readonly BasisOfRecord[] | undefined;
  country?: string | undefined;
  hasImage?: boolean | undefined;
  /** WKT polygon (already rounded via params helpers). */
  geometry?: string | undefined;
  datasetKey?: string | undefined;
  /** Restrict to records with usable coordinates (matches what the map shows). */
  georeferenced?: boolean | undefined;
}

export function filterToParams(f: OccurrenceFilter): Params {
  return {
    taxonKey: f.taxonKey,
    year: yearRangeParam(f.year),
    month: f.month,
    basisOfRecord: f.basisOfRecord,
    country: f.country,
    mediaType: f.hasImage ? 'StillImage' : undefined,
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
  opts: { facetLimit?: number; signal?: AbortSignal } = {},
): Promise<{ count: number; facets: Record<string, FacetCount[]> }> {
  const res = await http().getJson<OccurrenceSearch>(
    '/v1/occurrence/search',
    { ...filterToParams(filter), limit: 0, facet: facets, facetLimit: opts.facetLimit ?? 200 },
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

/** Species in an area, ranked by record count. */
export function speciesInRadius(
  lat: number,
  lng: number,
  radiusKm: number,
  filter: Omit<OccurrenceFilter, 'geometry'> = {},
  facetLimit = 200,
) {
  return occurrenceFacets({ ...filter, geometry: circleToWkt(lat, lng, radiusKm) }, ['speciesKey'], { facetLimit });
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
  return http().getJson(`/v1/occurrence/${key}`, undefined, { ttlMs: 24 * HOUR });
}
