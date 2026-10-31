/**
 * Data for "What's near me":
 *   classes in the area      → 1 facet request
 *   species in the area      → 1 facet request per leading class, named by the facet (see species/groups.ts)
 */
import { circleToWkt, namedOccurrenceFacets, type OccurrenceFilter } from '~/lib/gbif';
import { namedClasses, topSpecies, type ClassGroup, type SpeciesRow } from '~/lib/species/groups';

export type { ClassGroup, SpeciesRow };

export interface Area {
  lat: number;
  lng: number;
  radiusKm: number;
  /** 1–12: only records from this calendar month (any year). */
  month?: number | undefined;
  /** The map's filters (taxa, dates, basis…), applied inside the circle. */
  filter?: OccurrenceFilter | undefined;
}

/** The circle (and month) as an occurrence filter; the Records tab searches with it. */
export const nearFilter = (area: Area, extra: { taxonKey?: number; classKey?: number } = {}): OccurrenceFilter => ({
  ...area.filter,
  geometry: circleToWkt(area.lat, area.lng, area.radiusKm),
  month: area.month,
  ...extra,
});

/** Total records and the classes present, most-recorded first. */
export async function classesNear(
  area: Area,
  signal?: AbortSignal,
): Promise<{ records: number; classes: ClassGroup[] }> {
  const result = await namedOccurrenceFacets(nearFilter(area), ['classKey'], {
    facetLimit: 50,
    ...(signal && { signal }),
  });
  return { records: result.count, classes: await namedClasses(result.facets['classKey'] ?? []) };
}

/** The area's top species, or one class's (photos are added separately). */
export const NEAR_SPECIES = 200;
/** Top species around a point, optionally within one class. */
export function speciesNear(area: Area, classKey: number | null, signal?: AbortSignal): Promise<SpeciesRow[]> {
  return topSpecies(nearFilter(area, classKey === null ? {} : { classKey }), {
    limit: NEAR_SPECIES,
    ...(signal && { signal }),
  });
}
