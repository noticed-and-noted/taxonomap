/**
 * Loads where only the latest one matters (another cell, another pin): each
 * run aborts the one before, and `loading` / `error` follow the latest run
 * only. The load function gets the run's AbortSignal; after each await it
 * checks `signal.aborted` before publishing anything.
 */
import { onScopeDispose, ref } from 'vue';
import { classifyError, type UiErrorKind } from '~/lib/gbif';

/**
 * @returns `loading` and `error` for the latest run, `run(load)` to start one (aborting the previous), and `cancel()`.
 */
export function useLatestLoad() {
  const loading = ref(false);
  const error = ref<UiErrorKind | null>(null);
  let controller: AbortController | undefined;

  /** Stop the current run, if any. */
  function cancel() {
    controller?.abort();
    controller = undefined;
    loading.value = false;
  }

  async function run(load: (signal: AbortSignal) => Promise<void>): Promise<void> {
    cancel();
    const mine = new AbortController();
    controller = mine;
    loading.value = true;
    error.value = null;
    try {
      await load(mine.signal);
    } catch (failure) {
      if (!mine.signal.aborted) error.value = classifyError(failure);
    } finally {
      if (controller === mine) loading.value = false;
    }
  }

  onScopeDispose(cancel);

  return { loading, error, run, cancel };
}
