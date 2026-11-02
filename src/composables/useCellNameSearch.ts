/**
 * Name search over an area's species, for the cell's species and records searches. It asks the
 * shared name search (the baked index, then at most two live GBIF requests) rather than looking
 * up every species' common name, a request each. Hits among the listed species match by key;
 * given an `area`, species hits outside the list are checked there with one facet request,
 * which also gives their record counts.
 */
import { computed, ref, shallowRef, watch, type Ref } from 'vue';
import { occurrenceFacets, type NameHit, type OccurrenceFilter } from '~/lib/gbif';
import type { SpeciesRow } from '~/lib/species/groups';
import { useNameSearch } from './useNameSearch';

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
  /** During the debounce the hits are still the previous text's, so nothing is matched from them. */
  const isAnswered = computed(() => nameSearch.answered.value === query.value);
  const hits = computed(() => (isAnswered.value ? nameSearch.hits.value : []));
  const matchedKeys = computed(
    () => new Set(hits.value.filter((hit) => listed.value.has(hit.key)).map((hit) => hit.key)),
  );
  const checked = shallowRef<SpeciesRow[]>([]);
  /** The species found in the area, under the names the hits have now: a hit can be renamed after its check. */
  const outside = computed(() => {
    const names = new Map(hits.value.map((hit) => [hit.key, hit.commonName]));
    return isAnswered.value
      ? checked.value.map((row) => {
          const name = names.get(row.key);
          return name ? { ...row, commonName: name } : row;
        })
      : [];
  });
  const isChecking = ref(false);
  let controller: AbortController | undefined;

  /** Keeps the unlisted species hits that have records in the area. */
  async function checkOutside(found: readonly NameHit[]) {
    const filter = area?.();
    const candidates = found.filter((hit) => hit.rank === 'SPECIES' && !listed.value.has(hit.key));
    if (!filter || !candidates.length) return;
    const mine = (controller = new AbortController());
    isChecking.value = true;
    try {
      checked.value = await countInArea(filter, candidates, mine.signal);
    } catch {
      // Unchecked hits are left out rather than offered unverified; the listed species still match.
    } finally {
      if (controller === mine) isChecking.value = false;
    }
  }

  // Keys, not hits: a rename changes the hits but not what the area holds, so it needs no new check.
  const hitKeys = computed(() => hits.value.map((hit) => hit.key).join());

  watch([hitKeys, isAnswered, nameSearch.loading], () => {
    controller?.abort();
    checked.value = [];
    if (isAnswered.value && !nameSearch.loading.value) void checkOutside(hits.value);
  });

  watch(query, (text) => nameSearch.search(text), { immediate: true });

  return {
    matchedKeys,
    outside,
    loading: computed(() => nameSearch.loading.value || isChecking.value),
  };
}
