/**
 * Records-per-year for the time slider. With no filters the baked global
 * snapshot is used; once taxon/basis/photo filters apply, one live
 * facet request (limit=0) replaces it. The date filter itself is excluded so
 * the histogram always shows the full range. In cube mode the charts cube
 * counts it instead, filtered or not, with no request to GBIF.
 */
import { useStore } from '@nanostores/vue';
import { ref, watch } from 'vue';
import { cubeYearCounts } from '~/lib/cubes/selected';
import { loadSnapshot } from '~/lib/data/load';
import { occurrenceFacets } from '~/lib/gbif';
import { $cubesOn } from '~/stores/cubes';
import { $occurrenceFilter } from '~/stores/explorer';
import { useLatestLoad } from './useLatestLoad';

export type YearCounts = Map<number, number>;

/** Records per year for the current filters: the baked snapshot when unfiltered, a live facet request otherwise. */
export function useYearHistogram() {
  const filter = useStore($occurrenceFilter);
  const cubesOn = useStore($cubesOn);
  const counts = ref<YearCounts>(new Map());
  const live = ref(false);
  const { loading, error, run } = useLatestLoad();

  function load() {
    const { year: _year, eventDate: _date, ...rest } = filter.value;
    const filtered = Object.values(rest).some((value) => value !== undefined);
    return run(async (signal) => {
      const fromCubes = await cubeYearCounts(rest);
      const snapshot = fromCubes || filtered ? null : await loadSnapshot('years');
      const rows = fromCubes ?? (snapshot ? snapshot.years : await fetchLive(rest, signal));
      if (signal.aborted) return;
      counts.value = new Map(rows);
      live.value = filtered || !!fromCubes;
    });
  }

  async function fetchLive(facetFilter: Parameters<typeof occurrenceFacets>[0], signal: AbortSignal) {
    const result = await occurrenceFacets(facetFilter, ['year'], { facetLimit: 1000, signal });
    return (result.facets['year'] ?? []).map((facet): [number, number] => [Number(facet.name), facet.count]);
  }

  // Only re-fetch when a non-date filter changes.
  watch(
    () => {
      const { year: _unusedYear, eventDate: _unusedDate, ...rest } = filter.value;
      return JSON.stringify([rest, cubesOn.value]);
    },
    () => void load(),
    { immediate: true },
  );

  return { counts, loading, error, live, reload: load };
}
