/**
 * Data for "What's near me":
 *   classes in the area      → 1 facet request
 *   species in the area      → 1 facet request per leading class, then 1 batched name search (see species/groups.ts)
 */
import { nameIndexWithin } from '~/lib/data/name-index';
import {
  circleToWkt,
  occurrenceFacets,
} from '~/lib/gbif';
import { namedClasses, topSpecies, type ClassGroup, type SpeciesRow } from '~/lib/species/groups';

export type { ClassGroup, SpeciesRow };

export interface Area {
  lat: number;
  lng: number;
  radiusKm: number;
  /** 1–12: only records from this calendar month (any year). */
  month?: number | undefined;
}

/** The circle (and month) as an occurrence filter; the Records tab searches with it. */
export const nearFilter = (a: Area, extra: { taxonKey?: number; classKey?: number } = {}) => ({
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

/**
 * Distinct species (and the top names) overall and per class — fetched when
 * the share dialog opens (click), one facet request per group.
 */
export async function speciesTallies(
  a: Area,
  classes: readonly ClassGroup[],
): Promise<{ total: number; topNames: string[]; groups: (ClassGroup & { species: number; topNames: string[] })[] }> {
  const LIMIT = 3000;
  const idx = await nameIndexWithin(800);
  const tally = async (taxonKey?: number) => {
    const r = await occurrenceFacets(nearFilter(a, taxonKey ? { taxonKey } : {}), ['speciesKey'], { facetLimit: LIMIT });
    const rows = r.facets['speciesKey'] ?? [];
    const topNames = rows
      .slice(0, 6)
      .map((c) => idx?.get(Number(c.name)))
      .map((n) => n?.commonName ?? n?.scientificName)
      .filter((n): n is string => !!n)
      .slice(0, 3);
    return { species: rows.length, topNames };
  };
  const leading = classes.slice(0, 6);
  const [all, per] = await Promise.all([tally(), Promise.all(leading.map((c) => tally(c.key)))]);
  return {
    total: all.species,
    topNames: all.topNames,
    groups: leading.map((c, i) => ({ ...c, ...per[i]! })),
  };
}
