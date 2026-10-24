/**
 * Place search as you type, shared by the header search and the near-me
 * panel: debounced, one geocoder request in flight, the previous one aborted.
 */
import { onScopeDispose, ref } from 'vue';
import { searchPlaces, type Place } from '~/lib/geocode';
import { debounce } from '~/lib/util/debounce';

/** Longer than the species debounce: the public geocoder is shared, so it gets fewer requests. */
const PLACE_DEBOUNCE_MS = 400;

/** Shorter queries match half the world, so they aren't sent. */
const MIN_QUERY_LENGTH = 2;

/**
 * Debounced place search state.
 * @returns The latest places, whether a search is pending or failed, whether one has answered,
 * and `search` (debounced), `flush` (send a pending search now) and `reset`.
 */
export function usePlaceSearch() {
  const places = ref<Place[]>([]);
  const loading = ref(false);
  const failed = ref(false);
  /** A search has answered since the last reset, so an empty list means "no places found". */
  const answered = ref(false);
  let abort: AbortController | undefined;

  const run = debounce(async (text: string) => {
    const controller = new AbortController();
    abort = controller;
    try {
      const found = await searchPlaces(text, controller.signal);
      if (controller.signal.aborted) return;
      places.value = found;
      answered.value = true;
    } catch (error) {
      // Aborted: a newer search (or a reset) has taken over.
      if (controller.signal.aborted || (error as Error).name === 'AbortError') return;
      places.value = [];
      failed.value = true;
    }
    loading.value = false;
  }, PLACE_DEBOUNCE_MS);

  function reset() {
    run.cancel();
    abort?.abort();
    places.value = [];
    loading.value = false;
    failed.value = false;
    answered.value = false;
  }

  function search(text: string) {
    const trimmed = text.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      reset();
      return;
    }
    abort?.abort();
    failed.value = false;
    loading.value = true;
    run(trimmed);
  }

  onScopeDispose(reset);

  return { places, loading, failed, answered, search, flush: run.flush, reset };
}
