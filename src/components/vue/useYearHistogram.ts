/**
 * Records-per-year for the time slider. With no filters the baked global
 * snapshot is used; once taxon/basis/photo/country filters apply, one live
 * facet request (limit=0) replaces it. The year filter itself is excluded so
 * the histogram always shows the full range.
 */
import { useStore } from '@nanostores/vue';
import { ref, watch } from 'vue';
import { loadSnapshot } from '~/lib/data/load';
import { classifyError, occurrenceFacets, type UiErrorKind } from '~/lib/gbif';
import { $occurrenceFilter } from '~/stores/explorer';

export type YearCounts = Map<number, number>;

export function useYearHistogram() {
  const filter = useStore($occurrenceFilter);
  const counts = ref<YearCounts>(new Map());
  const loading = ref(true);
  const error = ref<UiErrorKind | null>(null);
  const live = ref(false);
  let seq = 0;

  async function load() {
    const mine = ++seq;
    const { year: _year, ...rest } = filter.value;
    const filtered = Object.values(rest).some((v) => v !== undefined);
    loading.value = true;
    error.value = null;
    try {
      let rows: [number, number][];
      if (!filtered) {
        const snap = await loadSnapshot('years');
        if (snap) rows = snap.years;
        else rows = await fetchLive(rest);
      } else {
        rows = await fetchLive(rest);
      }
      if (mine !== seq) return;
      counts.value = new Map(rows);
      live.value = filtered;
    } catch (e) {
      if (mine === seq) error.value = classifyError(e);
    } finally {
      if (mine === seq) loading.value = false;
    }
  }

  async function fetchLive(f: Parameters<typeof occurrenceFacets>[0]): Promise<[number, number][]> {
    const r = await occurrenceFacets(f, ['year'], { facetLimit: 1000 });
    return (r.facets['year'] ?? []).map((c) => [Number(c.name), c.count]);
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
