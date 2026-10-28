/**
 * Name search over an area's species, for the cell's species and records searches. It asks the
 * shared name search (the baked index, then at most two live GBIF requests) rather than looking
 * up every species' common name, a request each. Hits among the listed species match by key;
 * given an `area`, species hits outside the list are checked there with one facet request,
 * which also gives their record counts.
 */
import { computed, onScopeDispose, ref, shallowRef, watch, type Ref } from 'vue';
import { occurrenceFacets, type NameHit, type OccurrenceFilter } from '~/lib/gbif';
import type { SpeciesRow } from '~/lib/species/groups';
import { debounce, SEARCH_DEBOUNCE_MS } from '~/lib/util/debounce';
import { MIN_LIVE_QUERY, useNameSearch } from './useNameSearch';

/** Hits asked for: they come mixed with genera and families, so plenty leaves enough species. */
const NAME_SEARCH_HITS = 50;

/** Options for `useCellNameSearch`. */
export interface CellNameSearchOptions {
  query: Ref<string>;
  /** The area's listed species (the most recorded ones). */
  species: () => readonly SpeciesRow[];
  /** The area to check unlisted species against; without it only listed species match. */
  area?: () => OccurrenceFilter | null;
}

/** The candidates with records in the area, with their counts, from one facet request. */
async function countInArea(filter: OccurrenceFilter, candidates: readonly NameHit[], signal: AbortSignal) {
  const keys = candidates.map((hit) => hit.key);
  const response = await occurrenceFacets({ ...filter, speciesKeys: keys }, ['speciesKey'], {
    facetLimit: keys.length,
    signal,
  });
  const counts = new Map((response.facets['speciesKey'] ?? []).map((facet) => [Number(facet.name), facet.count]));
  return candidates.flatMap((hit): SpeciesRow[] => {
    const records = counts.get(hit.key);
    if (!records) return [];
    return [
      {
        key: hit.key,
        scientificName: hit.scientificName,
        records,
        ...(hit.commonName && { commonName: hit.commonName }),
      },
    ];
  });
}

/**
 * Searches names as `query` changes.
 * @returns `matchedKeys` (listed species the search matched), `outside` (unlisted species with
 *   records in the area, with their counts) and `loading`.
 */
export function useCellNameSearch({ query, species, area }: CellNameSearchOptions) {
  const nameSearch = useNameSearch({ max: NAME_SEARCH_HITS });
  const listed = computed(() => new Set(species().map((row) => row.key)));
  const matchedKeys = computed(
    () => new Set(nameSearch.hits.value.filter((hit) => listed.value.has(hit.key)).map((hit) => hit.key)),
  );
  const outside = shallowRef<SpeciesRow[]>([]);
  const isChecking = ref(false);
  let controller: AbortController | undefined;

  /** Keeps the unlisted species hits that have records in the area. */
  async function checkOutside(hits: readonly NameHit[]) {
    controller?.abort();
    outside.value = [];
    const filter = area?.();
    const candidates = hits.filter((hit) => hit.rank === 'SPECIES' && !listed.value.has(hit.key));
    if (!filter || !candidates.length) return;
    const mine = (controller = new AbortController());
    isChecking.value = true;
    try {
      outside.value = await countInArea(filter, candidates, mine.signal);
    } catch {
      // Unchecked hits are left out rather than offered unverified; the listed species still match.
    } finally {
      if (controller === mine) isChecking.value = false;
    }
  }

  const checkSoon = debounce((hits: readonly NameHit[]) => void checkOutside(hits), SEARCH_DEBOUNCE_MS);

  // The index answers on every keystroke, so its hits wait for a pause; GBIF's arrive after one, so they go at once.
  watch(nameSearch.hits, (hits) => {
    checkSoon.cancel();
    controller?.abort();
    outside.value = [];
    if (nameSearch.loading.value) return;
    if (query.value.trim().length >= MIN_LIVE_QUERY) void checkOutside(hits);
    else checkSoon(hits);
  });

  watch(query, (text) => nameSearch.search(text), { immediate: true });

  onScopeDispose(checkSoon.cancel);

  return {
    matchedKeys,
    outside,
    loading: computed(() => nameSearch.loading.value || isChecking.value),
  };
}
