/**
 * Species and group search, shared by the header search and the What
 * filter's picker. The baked common-name index answers at once; live GBIF
 * providers (scientific suggest, plus vernacular search when the index is
 * thin) follow after a 250 ms debounce. Each new query aborts the last.
 */
import { computed, onScopeDispose, ref } from 'vue';
import { bakedIndexProvider, nameIndexWithin } from '~/lib/data/name-index';
import { gbifSuggestProvider, gbifVernacularProvider, type NameHit } from '~/lib/gbif';
import { debounce } from '~/lib/util/debounce';

/** Shortest query searched at all, and the shortest sent to GBIF. */
const MIN_QUERY = 2;
const MIN_LIVE_QUERY = 3;

export interface NameSearchOptions {
  /** Most hits to return. */
  max: number;
  /** Keys to leave out (e.g. taxa already picked). */
  exclude?: () => Iterable<number>;
}

export function useNameSearch({ max, exclude }: NameSearchOptions) {
  const indexHits = ref<NameHit[]>([]);
  const liveHits = ref<NameHit[]>([]);
  /** Live providers are being asked. */
  const loading = ref(false);
  /** Every live provider failed for the last query. */
  const failed = ref(false);
  let current = '';
  let ctrl: AbortController | undefined;

  const hits = computed(() => {
    const seen = new Set(exclude?.() ?? []);
    const out: NameHit[] = [];
    // Live scientific matches are mostly noise once the index has answers.
    const live = indexHits.value.length ? liveHits.value.slice(0, 3) : liveHits.value;
    for (const h of [...indexHits.value, ...live]) {
      if (seen.has(h.key)) continue;
      seen.add(h.key);
      out.push(h);
      if (out.length >= max) break;
    }
    return out;
  });

  async function runIndex(q: string) {
    const found = await bakedIndexProvider.search(q);
    if (q === current) indexHits.value = found;
  }

  const runLive = debounce(async (q: string) => {
    ctrl?.abort();
    if (q.trim().length < MIN_LIVE_QUERY) {
      loading.value = false;
      return;
    }
    const mine = (ctrl = new AbortController());
    loading.value = true;
    failed.value = false;
    // Let the local index answer first, so live results never reorder the list
    // under the pointer, and decide on the vernacular search with it loaded.
    await nameIndexWithin(1500);
    await runIndex(q);
    if (mine.signal.aborted) return;
    const results = await Promise.allSettled([
      gbifSuggestProvider.search(q, mine.signal),
      // Vernacular search ranks poorly, so only use it when the index is thin.
      indexHits.value.length < 3 ? gbifVernacularProvider.search(q, mine.signal) : Promise.resolve([]),
    ]);
    if (mine.signal.aborted) return;
    liveHits.value = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
    failed.value = results.every((r) => r.status === 'rejected');
    loading.value = false;
  }, 250);

  /** Stop any search in flight and empty the results. */
  function reset() {
    current = '';
    runLive.cancel();
    ctrl?.abort();
    indexHits.value = [];
    liveHits.value = [];
    loading.value = false;
    failed.value = false;
  }

  /** Search for `q` (call on every input). */
  function search(q: string) {
    if (q.trim().length < MIN_QUERY) {
      reset();
      return;
    }
    current = q;
    // Live hits belong to the previous query.
    liveHits.value = [];
    void runIndex(q);
    runLive(q);
  }

  onScopeDispose(reset);

  return { hits, loading, failed, search, reset };
}
