/**
 * Loads Spread's cells into `$spreadCells` while Analyse shows Spread for a species, and clears them otherwise, so the
 * map keeps the spread when the phone sheet is closed.
 */
import { useStore } from '@nanostores/vue';
import { computed, onScopeDispose, watch } from 'vue';
import { loadSpreadCells } from '~/lib/analyse/spread';
import { $analyseView, $analyseYears, yearsIncluded } from '~/stores/analyse';
import { $analyseFilter } from '~/stores/map-filter';
import { $spreadCells } from '~/stores/spread';
import { useLatestLoad } from './useLatestLoad';

/** Keeps `$spreadCells` in step with Analyse; returns the load's `loading` and `error`. */
export function useSpreadCells() {
  const analyseFilter = useStore($analyseFilter);
  const view = useStore($analyseView);
  const years = useStore($analyseYears);
  const { loading, error, run, cancel } = useLatestLoad();

  /** The records to look through, without years: Spread asks year by year itself. Null when Spread isn't showing. */
  const request = computed(() => {
    if (view.value !== 'spread' || !analyseFilter.value) return null;
    const { year: _years, ...filter } = analyseFilter.value;
    return { filter, range: yearsIncluded(years.value) };
  });

  watch(
    () => JSON.stringify(request.value),
    () => {
      $spreadCells.set(null);
      cancel();
      const current = request.value;
      if (!current) return;
      void run(async (signal) => {
        const loaded = await loadSpreadCells(current.filter, current.range, signal);
        if (!signal.aborted) $spreadCells.set(loaded);
      });
    },
    { immediate: true },
  );
  onScopeDispose(() => $spreadCells.set(null));

  return { loading, error };
}
