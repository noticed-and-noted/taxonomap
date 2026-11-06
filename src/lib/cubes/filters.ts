/**
 * Which filters cube mode answers, in one place. The cubes hold taxon, place, years, months, record
 * type and media; everything else is greyed out in the filter controls and cleared on entering cube
 * mode, so no number on screen comes from somewhere else.
 */
import type { DateRange } from '~/lib/dates';
import type { OccurrenceFilter } from '~/lib/gbif';

/** Bits of the cubes' media column (pipeline/bake_cubes.py). */
export const MEDIA_PHOTO = 1;
export const MEDIA_SOUND = 2;

/** The label greyed-out controls carry. */
export const NOT_IN_DEMO = 'Not in cube demo';

/** Occurrence filter fields the cubes can't answer, with the name a notice uses for each. */
const UNSUPPORTED: Partial<Record<keyof OccurrenceFilter, string>> = {
  exactTaxon: 'exact taxon',
  iucn: 'IUCN Red List',
  continents: 'continent',
  maxUncertaintyM: 'location accuracy',
  eventDate: 'dates that aren’t whole years',
  publishers: 'publisher',
  country: 'country',
  datasetKey: 'dataset',
};

const isSet = (value: unknown) =>
  value !== undefined && value !== null && value !== false && !(Array.isArray(value) && !value.length);

/**
 * The filters set in `filter` that the cubes can't answer.
 * @returns their names, for a notice; empty when the cubes answer everything set
 */
export function unsupportedFilters(filter: OccurrenceFilter): string[] {
  return Object.entries(filter).flatMap(([field, value]) => {
    const name = UNSUPPORTED[field as keyof OccurrenceFilter];
    return name && isSet(value) ? [name] : [];
  });
}

/** Whether a date range is one the cubes answer: none, or whole years (the year slider, or a custom range in years). */
export function isCubeRange(range: DateRange | null): boolean {
  return !range || (!('preset' in range) && range.unit === 'y');
}
