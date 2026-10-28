/**
 * Species and group search, shared by the header search and the What
 * filter's picker. The baked common-name index answers at once; live GBIF
 * providers (scientific suggest, plus vernacular search when the index is
 * thin) follow once typing pauses (`SEARCH_DEBOUNCE_MS`). Each new query aborts the last.
 */
import { computed, onScopeDispose, ref } from 'vue';
import { bakedIndexProvider, matchHit, nameIndexWithin } from '~/lib/data/name-index';
import { gbifSuggestProvider, gbifVernacularProvider, type NameHit } from '~/lib/gbif';
import { debounce, SEARCH_DEBOUNCE_MS } from '~/lib/util/debounce';

/** Shortest query searched at all, and the shortest sent to GBIF. */
const MIN_QUERY = 2;
export const MIN_LIVE_QUERY = 3;

/** Options for `useNameSearch`. */
export interface NameSearchOptions {
  /** Most hits to return. */
  max: number;
  /** Keys to leave out (e.g. taxa already picked). */
  exclude?: () => Iterable<number>;
  /**
   * Orders each wave of hits (index, then live) on its own, so late live hits
   * only ever land below the index hits already on screen.
   */
  order?: (hits: readonly NameHit[]) => NameHit[];
}

/** Live scientific matches are mostly noise once the index has answers, so only a few are kept then. */
const MAX_LIVE_HITS_WITH_INDEX = 3;
/** Vernacular search ranks poorly, so it is only asked when the index has fewer hits than this. */
const THIN_INDEX_HITS = 5;
const INDEX_WAIT_MS = 1500;

/** Index hits then live hits, each wave in `order`, without repeats or excluded keys, up to `max`. */
function mergeHits(
  indexHits: readonly NameHit[],
  liveHits: readonly NameHit[],
  { exclude, max, order = (hits) => [...hits] }: NameSearchOptions,
): NameHit[] {
  const seen = new Set(exclude?.() ?? []);
  const merged: NameHit[] = [];
  const live = indexHits.length ? liveHits.slice(0, MAX_LIVE_HITS_WITH_INDEX) : liveHits;
  for (const hit of [...order(indexHits), ...order(live)]) {
    if (seen.has(hit.key)) continue;
    seen.add(hit.key);
    merged.push(hit);
    if (merged.length >= max) break;
  }
  return merged;
}

/**
 * Best name matches first, scored like the index; GBIF's order breaks ties (the sort is stable).
 * Hits that matched on another English name carry it as `matchedName`.
 */
function rankByMatch(hits: NameHit[], text: string): NameHit[] {
  const scored = hits.map((hit) => {
    const { score, matchedName } = matchHit(hit, text);
    return { hit: matchedName ? { ...hit, matchedName } : hit, score };
  });
  return scored.sort((first, second) => second.score - first.score).map(({ hit }) => hit);
}

/** Asks GBIF's live providers, best matches first; `failed` is true when every one of them did. */
async function askLiveProviders(text: string, indexHitCount: number, signal: AbortSignal) {
  const results = await Promise.allSettled([
    gbifSuggestProvider.search(text, signal),
    indexHitCount < THIN_INDEX_HITS ? gbifVernacularProvider.search(text, signal) : Promise.resolve([]),
  ]);
  return {
    hits: rankByMatch(
      results.flatMap((result) => (result.status === 'fulfilled' ? result.value : [])),
      text,
    ),
    failed: results.every((result) => result.status === 'rejected'),
  };
}

/**
 * Live GBIF suggestions for the latest query: debounced, one search in flight, the previous one aborted.
 * @param prepare Runs first and resolves to how many hits the local index has, which decides whether
 *   the poorly ranked vernacular search is worth asking.
 */
function useLiveHits(prepare: (text: string) => Promise<number>) {
  const hits = ref<NameHit[]>([]);
  /** Live providers are being asked (or will be, once the debounce settles). */
  const loading = ref(false);
  /** Every live provider failed for the last query. */
  const failed = ref(false);
  let controller: AbortController | undefined;

  const run = debounce(async (text: string) => {
    controller?.abort();
    if (text.trim().length < MIN_LIVE_QUERY) {
      loading.value = false;
      return;
    }
    const mine = (controller = new AbortController());
    loading.value = true;
    failed.value = false;
    const indexHitCount = await prepare(text);
    if (mine.signal.aborted) return;
    const live = await askLiveProviders(text, indexHitCount, mine.signal);
    if (mine.signal.aborted) return;
    hits.value = live.hits;
    failed.value = live.failed;
    loading.value = false;
  }, SEARCH_DEBOUNCE_MS);

  /** Stop any search in flight and empty the results. */
  function reset() {
    run.cancel();
    controller?.abort();
    hits.value = [];
    loading.value = false;
    failed.value = false;
  }

  return { hits, loading, failed, run, reset };
}

/**
 * Search for taxa by name: the baked index answers at once, GBIF's live providers follow.
 * @returns Merged `hits`, `loading` and `failed` flags, `search(text)` to call on every input, and `reset()`.
 */
export function useNameSearch(options: NameSearchOptions) {
  const indexHits = ref<NameHit[]>([]);
  let current = '';

  async function runIndex(text: string) {
    const found = await bakedIndexProvider.search(text);
    if (text === current) indexHits.value = found;
  }

  // Let the local index answer first, so live results never reorder the list
  // under the pointer, and decide on the vernacular search with it loaded.
  const live = useLiveHits(async (text) => {
    await nameIndexWithin(INDEX_WAIT_MS);
    await runIndex(text);
    return indexHits.value.length;
  });

  const hits = computed(() => mergeHits(indexHits.value, live.hits.value, options));

  function reset() {
    current = '';
    indexHits.value = [];
    live.reset();
  }

  /** Search for `text` (call on every input). */
  function search(text: string) {
    if (text.trim().length < MIN_QUERY) {
      reset();
      return;
    }
    current = text;
    // Live hits belong to the previous query.
    live.hits.value = [];
    live.loading.value = text.trim().length >= MIN_LIVE_QUERY;
    void runIndex(text);
    live.run(text);
  }

  onScopeDispose(reset);

  return { hits, loading: live.loading, failed: live.failed, search, reset };
}
