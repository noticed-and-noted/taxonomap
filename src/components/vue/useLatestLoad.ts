/**
 * Loads where only the latest one matters (another cell, another pin): each
 * run aborts the one before, and `loading` / `error` follow the latest run
 * only. The load function gets the run's AbortSignal; after each await it
 * checks `signal.aborted` before publishing anything.
 */
import { onScopeDispose, ref } from 'vue';
import { classifyError, type UiErrorKind } from '~/lib/gbif';

export function useLatestLoad() {
  const loading = ref(false);
  const error = ref<UiErrorKind | null>(null);
  let ctrl: AbortController | undefined;

  /** Stop the current run, if any. */
  function cancel() {
    ctrl?.abort();
    ctrl = undefined;
    loading.value = false;
  }

  async function run(load: (signal: AbortSignal) => Promise<void>): Promise<void> {
    cancel();
    const mine = new AbortController();
    ctrl = mine;
    loading.value = true;
    error.value = null;
    try {
      await load(mine.signal);
    } catch (e) {
      if (!mine.signal.aborted) error.value = classifyError(e);
    } finally {
      if (ctrl === mine) loading.value = false;
    }
  }

  onScopeDispose(cancel);

  return { loading, error, run, cancel };
}

/** "top 25 in each of the 8 most-recorded groups", for tables cut per group. */
export function perGroupNote(groups: number, maxGroups: number, perGroup: number): string {
  return groups > maxGroups
    ? `top ${perGroup} in each of the ${maxGroups} most-recorded groups`
    : `top ${perGroup} in each group`;
}
