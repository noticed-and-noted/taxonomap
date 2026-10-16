/**
 * Records-per-year for the time slider. With no filters the baked global
 * snapshot is used; once taxon/basis/photo filters apply, one live
 * facet request (limit=0) replaces it. The year filter itself is excluded so
 * the histogram always shows the full range.
 */
import { useStore } from '@nanostores/vue';
import { ref, watch } from 'vue';
import { loadSnapshot } from '~/lib/data/load';
import { occurrenceFacets } from '~/lib/gbif';
import { $occurrenceFilter } from '~/stores/explorer';
import { useLatestLoad } from './useLatestLoad';

export type YearCounts = Map<number, number>;

export function useYearHistogram() {
  const filter = useStore($occurrenceFilter);
  const counts = ref<YearCounts>(new Map());
  const live = ref(false);
  const { loading, error, run } = useLatestLoad();

  function load() {
    const { year: _year, ...rest } = filter.value;
    const filtered = Object.values(rest).some((v) => v !== undefined);
    return run(async (signal) => {
      const snap = filtered ? null : await loadSnapshot('years');
      const rows = snap ? snap.years : await fetchLive(rest, signal);
      if (signal.aborted) return;
      counts.value = new Map(rows);
      live.value = filtered;
    });
  }

  async function fetchLive(f: Parameters<typeof occurrenceFacets>[0], signal: AbortSignal) {
    const r = await occurrenceFacets(f, ['year'], { facetLimit: 1000, signal });
    return (r.facets['year'] ?? []).map((c): [number, number] => [Number(c.name), c.count]);
  }

  // Only re-fetch when a non-year filter changes.
  watch(
    () => {
      const { year: _y, ...rest } = filter.value;
      return JSON.stringify(rest);
    },
    () => void load(),
    { immediate: true },
  );

  return { counts, loading, error, live, reload: load };
}
