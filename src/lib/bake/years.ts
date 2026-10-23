import type { YearsSnapshot } from '~/lib/data/types';
import { countedFacets, once, snapshotMeta } from './cache';

const YEAR_FACET_LIMIT = 1000;

/** Records per year, for the time slider's histogram. */
export function bakeYears(): Promise<YearsSnapshot> {
  return once('years', async () => {
    const result = await countedFacets({}, ['year'], { facetLimit: YEAR_FACET_LIMIT });
    const years = (result.facets['year'] ?? [])
      .map((facet) => [Number(facet.name), facet.count] as [number, number])
      .sort((left, right) => left[0] - right[0]);
    return { ...snapshotMeta(), total: result.count, years };
  });
}
