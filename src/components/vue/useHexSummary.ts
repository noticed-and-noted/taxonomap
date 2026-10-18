/**
 * Data for the selected hex, with no N+1 calls:
 *  1. one facet request (limit=0): total count, classes, months and the top species
 *  2. picking a group: one facet request for that group's top species (cached per cell)
 *  3. names from the baked index; rows show now, then one batched search
 *     names misses (see species/groups.ts)
 *  4. photos, and any names still missing, are looked up by the table as rows
 *     scroll into view
 * Selecting another cell aborts the previous load's remaining requests.
 */
import { useStore } from '@nanostores/vue';
import { ref, shallowRef, watch } from 'vue';
import { loadSnapshot } from '~/lib/data/load';
import { loadNameIndex } from '~/lib/data/name-index';
import { occurrenceFacets } from '~/lib/gbif';
import { rememberCount } from '~/lib/map/cellCounts';
import { nameFromRecords, namedClasses, topSpecies, type ClassGroup, type SpeciesRow } from '~/lib/species/groups';
import { $hexGeometry, $occurrenceFilter } from '~/stores/explorer';
import { useLatestLoad } from './useLatestLoad';

/** Species rows per list (the whole cell, or one group). */
export const HEX_SPECIES = 200;
/** Groups offered in the table's filter (a cell's long tail beyond this is a few records each). */
const HEX_CLASSES = 50;

export function useHexSummary() {
  const geometry = useStore($hexGeometry);
  const filter = useStore($occurrenceFilter);
  const { loading, error, run, cancel } = useLatestLoad();

  const count = ref<number | null>(null);
  const months = ref<number[]>(Array(12).fill(0));
  const classes = shallowRef<ClassGroup[]>([]);
  const species = shallowRef<SpeciesRow[]>([]);
  /** The whole cell's list, whichever group is picked (the records tab's species search). */
  const cellSpecies = shallowRef<SpeciesRow[]>([]);
  /** Class the species list is narrowed to, or null for the whole cell. */
  const group = ref<number | null>(null);
  /** This cell's lists already loaded, by group. */
  let lists = new Map<number | null, SpeciesRow[]>();

  /** Show rows now, then again once the batched search has named the index's misses. */
  async function show(key: number | null, rows: SpeciesRow[], signal: AbortSignal) {
    const set = (r: SpeciesRow[]) => {
      lists.set(key, r);
      if (group.value === key) species.value = r;
      if (key === null) cellSpecies.value = r;
    };
    set(rows);
    const named = await nameFromRecords(rows, signal);
    if (!signal.aborted) set(named);
  }

  async function load() {
    const g = geometry.value;
    species.value = [];
    cellSpecies.value = [];
    group.value = null;
    lists = new Map();
    if (!g) {
      cancel();
      count.value = null;
      classes.value = [];
      return;
    }
    await run(async (signal) => {
      // Baked lookups the steps below wait on: fetch them alongside the facet request.
      void loadSnapshot('tree');
      void loadNameIndex();
      const f = { ...filter.value, geometry: g.wkt };
      const r = await occurrenceFacets(f, ['classKey', 'month', 'speciesKey'], {
        facetLimit: HEX_CLASSES,
        limits: { speciesKey: HEX_SPECIES },
        signal,
      });
      if (signal.aborted) return;
      count.value = r.count;
      // The map's tooltip shows this cell's exact count from now on.
      rememberCount(filter.value, g.wkt, r.count);
      const m = Array(12).fill(0) as number[];
      for (const c of r.facets['month'] ?? []) m[Number(c.name) - 1] = c.count;
      months.value = m;

      const groups = await namedClasses(r.facets['classKey'] ?? []);
      const rows = await topSpecies(f, { known: r.facets['speciesKey'] ?? [], signal });
      if (signal.aborted) return;
      classes.value = groups;
      await show(null, rows, signal);
    });
  }

  /** Narrow the list to one group (null for all), loading its species the first time. */
  async function pickGroup(key: number | null) {
    const g = geometry.value;
    if (!g || key === group.value) return;
    group.value = key;
    const cached = lists.get(key);
    if (cached) {
      species.value = cached;
      return;
    }
    species.value = [];
    await run(async (signal) => {
      const f = { ...filter.value, geometry: g.wkt, ...(key !== null && { classKey: key }) };
      const rows = await topSpecies(f, { limit: HEX_SPECIES, signal });
      if (!signal.aborted) await show(key, rows, signal);
    });
  }

  watch([geometry, () => JSON.stringify(filter.value)], () => void load(), { immediate: true });

  return { loading, error, count, months, classes, species, cellSpecies, group, pickGroup, reload: load };
}
