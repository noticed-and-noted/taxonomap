/** The years a species' records cover, for the range Analyse lets the viewer pick. */
import { occurrenceFacets, type OccurrenceFilter } from '~/lib/gbif';
import { MIN_RECORDS } from './spread';

/** More than every year GBIF holds a record in (1500 to now). */
const YEAR_FACET_LIMIT = 600;

/**
 * The first year the species could show on the map: the year its mapped records (with coordinates and no
 * location problems) first add up to `MIN_RECORDS`, as a Spread cell needs. Records with no coordinates, often old
 * specimens, never show, so they don't stretch the range. The filter's own years are ignored.
 * @returns null when too few records are mapped.
 */
export async function earliestRecordYear(filter: OccurrenceFilter, signal: AbortSignal): Promise<number | null> {
  const { year: _years, ...allYears } = filter;
  const result = await occurrenceFacets({ ...allYears, georeferenced: true }, ['year'], {
    facetLimit: YEAR_FACET_LIMIT,
    signal,
  });
  const byYear = (result.facets['year'] ?? [])
    .map((facet) => ({ year: Number(facet.name), count: facet.count }))
    .sort((left, right) => left.year - right.year);
  let total = 0;
  for (const { year, count } of byYear) {
    total += count;
    if (total >= MIN_RECORDS) return year;
  }
  return null;
}

/** Records of every species each year in `range` under `filter`'s other conditions (its taxa and years ignored). */
export async function allRecordsByYear(
  filter: OccurrenceFilter,
  range: readonly [number, number],
  signal: AbortSignal,
): Promise<Map<number, number>> {
  const { year: _years, taxonKey: _taxon, taxonKeys: _taxa, ...everything } = filter;
  const result = await occurrenceFacets({ ...everything, year: range }, ['year'], {
    facetLimit: YEAR_FACET_LIMIT,
    signal,
  });
  return new Map((result.facets['year'] ?? []).map((facet) => [Number(facet.name), facet.count]));
}
