/**
 * Species and group search, shared by the header search and the What
 * filter's picker. Once typing pauses (`SEARCH_DEBOUNCE_MS`) the baked common-name
 * index answers, and live GBIF providers (scientific suggest, plus vernacular search
 * when the index is thin) follow. Each new query aborts the last.
 */
import { computed, onScopeDispose, ref, type Ref } from 'vue';
import { bakedIndexProvider, matchHit, nameIndexIfLoaded, nameIndexWithin } from '~/lib/data/name-index';
import { gbifSuggestProvider, gbifVernacularProvider, type NameHit } from '~/lib/gbif';
import { inatNames } from '~/lib/photos/taxon-photos';
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

/** The name the baked index gives a taxon (iNaturalist's), when it holds one. */
const indexedName = (hit: NameHit) => nameIndexIfLoaded()?.get(hit.key)?.commonName;

/** A live hit named `name`; GBIF's own name stays searchable as another English name. */
function renamed({ matchedName: _staleMatch, ...hit }: NameHit, name: string): NameHit {
  const gbifNames = hit.commonName ? [hit.commonName] : [];
  return { ...hit, commonName: name, englishNames: [...(hit.englishNames ?? []), ...gbifNames] };
}

/** A live hit named as the index names it, so a taxon shows one name everywhere. */
function withIndexedName(hit: NameHit): NameHit {
  const name = indexedName(hit);
  return name && name !== hit.commonName ? renamed(hit, name) : hit;
}

/** How many live hits can reach the list (see mergeHits). */
function liveSlots(indexHitCount: number, max: number): number {
  return indexHitCount ? Math.max(0, Math.min(MAX_LIVE_HITS_WITH_INDEX, max - indexHitCount)) : max;
}

/**
 * The hits named as iNaturalist names them, in the same order. Only species GBIF already gives a
 * common name are looked up, and only those that can reach the list: an obscure species costs a
 * slow, empty search. Names already remembered cost nothing, and a failed lookup leaves GBIF's.
 */
async function withInatNames(hits: NameHit[], slots: number, text: string, signal: AbortSignal): Promise<NameHit[]> {
  const toName = hits.slice(0, slots).filter((hit) => hit.rank === 'SPECIES' && hit.commonName && !indexedName(hit));
  if (!toName.length) return hits;
  // Swallowed on purpose: a name is a nicety, and search still works with GBIF's.
  const names = await inatNames(toName, { signal }).catch(() => new Map<number, string | null>());
  return hits.map((hit) => {
    const name = names.get(hit.key);
    if (!name || name === hit.commonName) return hit;
    const named = renamed(hit, name);
    const { matchedName } = matchHit(named, text);
    return matchedName ? { ...named, matchedName } : named;
  });
}

/** Asks GBIF's live providers, best matches first, each taxon once; `failed` is true when every one of them did. */
async function askLiveProviders(text: string, indexHitCount: number, signal: AbortSignal) {
  const results = await Promise.allSettled([
    gbifSuggestProvider.search(text, signal),
    indexHitCount < THIN_INDEX_HITS ? gbifVernacularProvider.search(text, signal) : Promise.resolve([]),
  ]);
  const found = results.flatMap((result) => (result.status === 'fulfilled' ? result.value.map(withIndexedName) : []));
  const seen = new Set<number>();
  return {
    hits: rankByMatch(found, text).filter((hit) => !seen.has(hit.key) && seen.add(hit.key)),
    failed: results.every((result) => result.status === 'rejected'),
  };
}

/** What a live search shows as it goes. */
interface LiveState {
  hits: Ref<NameHit[]>;
  loading: Ref<boolean>;
  failed: Ref<boolean>;
}

/** Asks the live providers and shows their hits with GBIF's names, then iNaturalist's: a slow name lookup shouldn't hold results back. */
async function showLiveHits(state: LiveState, text: string, slots: number, indexHitCount: number, signal: AbortSignal) {
  const live = await askLiveProviders(text, indexHitCount, signal);
  if (signal.aborted) return;
  state.hits.value = live.hits;
  state.failed.value = live.failed;
  state.loading.value = false;
  const named = await withInatNames(live.hits, slots, text, signal);
  if (!signal.aborted && named !== live.hits) state.hits.value = named;
}

/**
 * Live GBIF suggestions for the latest query: debounced, one search in flight, the previous one
 * aborted as soon as the text changes, so a late answer can't land under newer text.
 * @param max Most hits the list shows, which caps how many live hits are renamed.
 * @param prepare Runs first and resolves to how many hits the local index has, which decides whether
 *   the poorly ranked vernacular search is worth asking.
 */
function useLiveHits(max: number, prepare: (text: string) => Promise<number>) {
  const hits = ref<NameHit[]>([]);
  /** Live providers are being asked (or will be, once the debounce settles). */
  const loading = ref(false);
  /** Every live provider failed for the last query. */
  const failed = ref(false);
  let controller: AbortController | undefined;
  /** The text the running search is for; empty while the next one waits on the debounce. */
  let startedText = '';
  let indexAnswered: Promise<unknown> = Promise.resolve();

  async function start(text: string) {
    controller?.abort();
    const mine = (controller = new AbortController());
    startedText = text;
    const isLive = text.trim().length >= MIN_LIVE_QUERY;
    loading.value = isLive;
    failed.value = false;
    const prepared = prepare(text).then((indexHitCount) => {
      // Swapped in together with the index's hits, so nothing on screen changes before the debounce settles.
      if (!mine.signal.aborted) hits.value = [];
      return indexHitCount;
    });
    indexAnswered = prepared;
    const indexHitCount = await prepared;
    if (mine.signal.aborted || !isLive) return;
    const slots = liveSlots(indexHitCount, max);
    await showLiveHits({ hits, loading, failed }, text, slots, indexHitCount, mine.signal);
  }

  const run = debounce((text: string) => void start(text), SEARCH_DEBOUNCE_MS);

  /** Searches for `text` once typing pauses, dropping whatever is in flight. */
  function queue(text: string) {
    controller?.abort();
    startedText = '';
    loading.value = text.trim().length >= MIN_LIVE_QUERY;
    run(text);
  }

  /** Searches for `text` now if the debounce is still holding it, and resolves once the index has answered. */
  async function settle(text: string) {
    if (startedText !== text) {
      run.cancel();
      void start(text);
    }
    await indexAnswered;
  }

  /** Stop any search in flight and empty the results. */
  function reset() {
    run.cancel();
    controller?.abort();
    startedText = '';
    hits.value = [];
    loading.value = false;
    failed.value = false;
  }

  return { hits, loading, failed, queue, settle, reset };
}

/**
 * Search for taxa by name: once typing pauses the baked index answers, and GBIF's live providers follow.
 * @returns Merged `hits`, `loading` and `failed` flags, `answered` (the text `hits` belong to, which
 *   lags the typed text during the debounce), `search(text)` to call on every input, `settle()` for
 *   a pick that can't wait for the debounce, and `reset()`.
 */
export function useNameSearch(options: NameSearchOptions) {
  const indexHits = ref<NameHit[]>([]);
  const answered = ref('');
  let current = '';

  async function runIndex(text: string) {
    const found = await bakedIndexProvider.search(text);
    if (text !== current) return;
    indexHits.value = found;
    answered.value = text;
  }

  // Let the local index answer first, so live results never reorder the list
  // under the pointer, and decide on the vernacular search with it loaded.
  const live = useLiveHits(options.max, async (text) => {
    await nameIndexWithin(INDEX_WAIT_MS);
    await runIndex(text);
    return indexHits.value.length;
  });

  const hits = computed(() => mergeHits(indexHits.value, live.hits.value, options));

  function reset() {
    current = '';
    answered.value = '';
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
    live.queue(text);
  }

  /** Answers the typed text from the index now, so Enter picks from it and not from the previous query's hits. */
  async function settle() {
    if (current) await live.settle(current);
  }

  onScopeDispose(reset);

  return { hits, loading: live.loading, failed: live.failed, answered, search, settle, reset };
}
