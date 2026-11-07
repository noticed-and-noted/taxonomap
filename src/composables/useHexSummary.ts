/**
 * Data for the selected hex, with no N+1 calls:
 *  1. one facet request (limit=0): total count, classes, months and the top species
 *  2. picking a group: one facet request for that group's top species (cached per cell)
 *  3. names from the baked index, then from the facet itself (GBIF's GraphQL
 *     API names each value; see species/groups.ts)
 *  4. photos, and any names still missing, are looked up by the table as rows
 *     scroll into view
 * Selecting another cell aborts the previous load's remaining requests.
 */
import { useStore } from '@nanostores/vue';
import { ref, shallowRef, watch } from 'vue';
import { loadSnapshot } from '~/lib/data/load';
import { loadNameIndex } from '~/lib/data/name-index';
import { MONTHS_IN_YEAR, monthCounts, namedOccurrenceFacets, type OccurrenceFilter } from '~/lib/gbif';
import { rememberCount } from '~/lib/map/cellCounts';
import { namedClasses, topSpecies, type ClassGroup, type SpeciesRow } from '~/lib/species/groups';
import { $hexGeometry, $occurrenceFilter } from '~/stores/explorer';
import { useLatestLoad } from './useLatestLoad';

/** Species rows per list (the whole cell, or one group). */
export const HEX_SPECIES = 200;
/** Groups offered in the table's filter (a cell's long tail beyond this is a few records each). */
const HEX_CLASSES = 50;

/** The species lists of one cell: the whole cell's, and one group's at a time, each loaded once. */
function useSpeciesLists() {
  const species = shallowRef<SpeciesRow[]>([]);
  /** The whole cell's list, whichever group is picked (the records tab's species search). */
  const cellSpecies = shallowRef<SpeciesRow[]>([]);
  /** Class the species list is narrowed to, or null for the whole cell. */
  const group = ref<number | null>(null);
  /** This cell's lists already loaded, by group. */
  let lists = new Map<number | null, SpeciesRow[]>();

  /** Keep a group's rows, and show them if that group is picked. */
  function show(key: number | null, rows: SpeciesRow[]) {
    lists.set(key, rows);
    if (group.value === key) species.value = rows;
    if (key === null) cellSpecies.value = rows;
  }

  /** Forget everything, for a new cell. */
  function reset() {
    species.value = [];
    cellSpecies.value = [];
    group.value = null;
    lists = new Map();
  }

  /** Switch to a group's list; true when it was already loaded, false when the caller must load it. */
  function select(key: number | null): boolean {
    group.value = key;
    const cached = lists.get(key);
    species.value = cached ?? [];
    return !!cached;
  }

  return { species, cellSpecies, group, show, reset, select };
}

/** One facet request for a cell: total, classes, months and top species. Also warms the baked lookups it waits on. */
function fetchCellFacets(hexFilter: OccurrenceFilter, signal: AbortSignal) {
  void loadSnapshot('tree');
  void loadNameIndex();
  return namedOccurrenceFacets(hexFilter, ['classKey', 'month', 'speciesKey'], {
    facetLimit: HEX_CLASSES,
    limits: { speciesKey: HEX_SPECIES },
    signal,
  });
}

/** The class groups and top species of a cell, given its facet result. Names resolve from the baked index. */
async function fetchCellLists(
  hexFilter: OccurrenceFilter,
  result: Awaited<ReturnType<typeof fetchCellFacets>>,
  signal: AbortSignal,
) {
  const groups = await namedClasses(result.facets.classKey);
  const rows = await topSpecies(hexFilter, { known: result.facets.speciesKey, signal });
  return { groups, rows };
}

/** The top species of one group within a cell. */
function fetchGroupRows(cellFilter: OccurrenceFilter, wkt: string, classKey: number | null, signal: AbortSignal) {
  const groupFilter = { ...cellFilter, geometry: wkt, ...(classKey !== null && { classKey }) };
  return topSpecies(groupFilter, { limit: HEX_SPECIES, signal });
}

/** Everything about the selected hex; see the file comment for the request plan. */
export function useHexSummary() {
  const geometry = useStore($hexGeometry);
  const filter = useStore($occurrenceFilter);
  const { loading, error, run, cancel } = useLatestLoad();
  const { species, cellSpecies, group, show, reset, select } = useSpeciesLists();
  const count = ref<number | null>(null);
  const months = ref<number[]>(Array(MONTHS_IN_YEAR).fill(0));
  const classes = shallowRef<ClassGroup[]>([]);

  async function load() {
    const hexGeometry = geometry.value;
    reset();
    // Clear the old cell's count so the panel shows its skeleton, not a stale number.
    count.value = null;
    if (!hexGeometry) {
      cancel();
      classes.value = [];
      return;
    }
    await run(async (signal) => {
      const hexFilter = { ...filter.value, geometry: hexGeometry.wkt };
      const result = await fetchCellFacets(hexFilter, signal);
      if (signal.aborted) return;
      count.value = result.count;
      // The map's tooltip shows this cell's exact count from now on.
      rememberCount(filter.value, hexGeometry.wkt, result.count);
      months.value = monthCounts(result.facets.month);

      const { groups, rows } = await fetchCellLists(hexFilter, result, signal);
      if (signal.aborted) return;
      classes.value = groups;
      show(null, rows);
    });
  }

  /** Narrow the list to one group (null for all), loading its species the first time. */
  async function pickGroup(key: number | null) {
    const hexGeometry = geometry.value;
    if (!hexGeometry || key === group.value) return;
    if (select(key)) return;
    await run(async (signal) => {
      const rows = await fetchGroupRows(filter.value, hexGeometry.wkt, key, signal);
      if (!signal.aborted) show(key, rows);
    });
  }

  watch([geometry, () => JSON.stringify(filter.value)], () => void load(), { immediate: true });

  return { loading, error, count, months, classes, species, cellSpecies, group, pickGroup, reload: load };
}
