/**
 * Data for "What's near me":
 *   classes in the area      → 1 facet request
 *   species in the area      → 1 facet request per leading class, then 1 batched name search (see species/groups.ts)
 */
import { circleToWkt, occurrenceFacets, type OccurrenceFilter } from '~/lib/gbif';
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
export const nearFilter = (a: Area, extra: { taxonKey?: number; classKey?: number } = {}): OccurrenceFilter => ({
  ...a.filter,
  geometry: circleToWkt(a.lat, a.lng, a.radiusKm),
  month: a.month,
  ...extra,
});

/** Total records and the classes present, most-recorded first. */
export async function classesNear(a: Area, signal?: AbortSignal): Promise<{ records: number; classes: ClassGroup[] }> {
  const r = await occurrenceFacets(nearFilter(a), ['classKey'], { facetLimit: 50, ...(signal && { signal }) });
  return { records: r.count, classes: await namedClasses(r.facets['classKey'] ?? []) };
}

/** The area's top species, or one class's (photos are added separately). */
export const NEAR_SPECIES = 200;
export function speciesNear(a: Area, classKey: number | null, signal?: AbortSignal): Promise<SpeciesRow[]> {
  return topSpecies(nearFilter(a, classKey === null ? {} : { classKey }), {
    limit: NEAR_SPECIES,
    ...(signal && { signal }),
  });
}
