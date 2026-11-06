/**
 * Name search over an area's species, for the cell's species and records searches. It asks the
 * shared name search (the baked index, then at most two live GBIF requests) rather than looking
 * up every species' common name, a request each. Hits among the listed species match by key;
 * given an `area`, species hits outside the list are checked there with one facet request,
 * which also gives their record counts. In cube mode (`cubeArea`) the area's cube rows count them
 * instead, with no request.
 */
import { computed, ref, shallowRef, watch, type Ref } from 'vue';
import type { CubeArea } from '~/lib/cubes/cell';
import { speciesInArea } from '~/lib/cubes/selected';
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
  /** The same area in the cubes, in cube mode: checked from its rows instead of GBIF. */
  cubeArea?: () => CubeArea | null;
}

/** Records of each key in the area: from the cube rows in cube mode, else one GBIF facet request. */
async function countsIn(filter: OccurrenceFilter, cubeArea: CubeArea | null, keys: number[], signal: AbortSignal) {
  if (cubeArea) return speciesInArea(cubeArea, keys);
  const response = await occurrenceFacets({ ...filter, speciesKeys: keys }, ['speciesKey'], {
    facetLimit: keys.length,
    signal,
  });
  return new Map((response.facets['speciesKey'] ?? []).map((facet) => [Number(facet.name), facet.count]));
}

/** The candidates with records in the area, with their counts. */
async function countInArea(
  filter: OccurrenceFilter,
  cubeArea: CubeArea | null,
  candidates: readonly NameHit[],
  signal: AbortSignal,
) {
  const counts = await countsIn(
    filter,
    cubeArea,
    candidates.map((hit) => hit.key),
    signal,
  );
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
 *   records in the area, with their counts), `namePendingKeys` and `loading`.
 */
export function useCellNameSearch({ query, species, area, cubeArea }: CellNameSearchOptions) {
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
  /** Hits whose name is still being looked up, so their rows can hold its place. */
  const namePendingKeys = computed(() => new Set(hits.value.filter((hit) => hit.isNamePending).map((hit) => hit.key)));
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
      checked.value = await countInArea(filter, cubeArea?.() ?? null, candidates, mine.signal);
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
    namePendingKeys,
    loading: computed(() => nameSearch.loading.value || isChecking.value),
  };
}
