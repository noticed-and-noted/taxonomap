/**
 * Data for the selected hex, with no N+1 calls:
 *  1. one facet request (limit=0): total count, classes, months
 *  2. one facet request per leading class for its top species (2 at a time)
 *  3. names from the baked index, with a batched fallback (see species/groups.ts)
 *  4. photos, and any names still missing, are looked up by the table as rows
 *     scroll into view
 * Selecting another cell aborts the previous load's remaining requests.
 */
import { useStore } from '@nanostores/vue';
import { ref, shallowRef, watch } from 'vue';
import { occurrenceFacets } from '~/lib/gbif';
import { namedClasses, speciesInClasses, type ClassGroup, type SpeciesRow } from '~/lib/species/groups';
import { $hexGeometry, $occurrenceFilter } from '~/stores/explorer';
import { useLatestLoad } from './useLatestLoad';

export const HEX_CLASSES = 8;
export const HEX_PER_CLASS = 25;

export function useHexSummary() {
  const geometry = useStore($hexGeometry);
  const filter = useStore($occurrenceFilter);
  const { loading, error, run, cancel } = useLatestLoad();

  const count = ref<number | null>(null);
  const months = ref<number[]>(Array(12).fill(0));
  const classes = shallowRef<ClassGroup[]>([]);
  const species = shallowRef<SpeciesRow[]>([]);

  async function load() {
    const g = geometry.value;
    species.value = [];
    if (!g) {
      cancel();
      count.value = null;
      classes.value = [];
      return;
    }
    await run(async (signal) => {
      const f = { ...filter.value, geometry: g.wkt };
      const r = await occurrenceFacets(f, ['classKey', 'month'], { facetLimit: 12, signal });
      if (signal.aborted) return;
      count.value = r.count;
      const m = Array(12).fill(0) as number[];
      for (const c of r.facets['month'] ?? []) m[Number(c.name) - 1] = c.count;
      months.value = m;

      const groups = await namedClasses(r.facets['classKey'] ?? []);
      const rows = await speciesInClasses(f, groups, { maxClasses: HEX_CLASSES, perClass: HEX_PER_CLASS, signal });
      if (signal.aborted) return;
      classes.value = groups;
      species.value = rows;
    });
  }

  watch([geometry, () => JSON.stringify(filter.value)], () => void load(), { immediate: true });

  return { loading, error, count, months, classes, species, reload: load };
}
