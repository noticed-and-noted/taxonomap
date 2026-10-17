/**
 * Data for the selected hex, with no N+1 calls:
 *  1. one facet request (limit=0): total count, classes, months; also top
 *     species when the selected taxon puts every record in one class
 *  2. one facet request per leading class for its top species (2 at a time),
 *     unless step 1 already has them
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
import { occurrenceFacets, type FacetField, type Rank } from '~/lib/gbif';
import { rememberCount } from '~/lib/map/cellCounts';
import {
  nameFromRecords,
  namedClasses,
  speciesInClasses,
  type ClassGroup,
  type SpeciesRow,
} from '~/lib/species/groups';
import { $hexGeometry, $occurrenceFilter } from '~/stores/explorer';
import { $taxa } from '~/stores/taxon';
import { useLatestLoad } from './useLatestLoad';

export const HEX_CLASSES = 8;
export const HEX_PER_CLASS = 25;

/** Ranks whose records all sit in one class. */
const IN_ONE_CLASS = new Set<Rank>(['CLASS', 'ORDER', 'FAMILY', 'GENUS', 'SPECIES', 'SUBSPECIES', 'VARIETY', 'FORM']);

export function useHexSummary() {
  const geometry = useStore($hexGeometry);
  const filter = useStore($occurrenceFilter);
  const taxa = useStore($taxa);
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
      // Baked lookups the steps below wait on: fetch them alongside the facet request.
      void loadSnapshot('tree');
      void loadNameIndex();
      const f = { ...filter.value, geometry: g.wkt };
      // Ask for top species up front only when they will be one class's (the extra facet slows the request).
      const oneTaxon = taxa.value.length === 1 && IN_ONE_CLASS.has(taxa.value[0]!.rank);
      const fields: FacetField[] = oneTaxon ? ['classKey', 'month', 'speciesKey'] : ['classKey', 'month'];
      const r = await occurrenceFacets(f, fields, {
        facetLimit: 12,
        ...(oneTaxon && { limits: { speciesKey: HEX_PER_CLASS } }),
        signal,
      });
      if (signal.aborted) return;
      count.value = r.count;
      // The map's tooltip shows this cell's exact count from now on.
      rememberCount(filter.value, g.wkt, r.count);
      const m = Array(12).fill(0) as number[];
      for (const c of r.facets['month'] ?? []) m[Number(c.name) - 1] = c.count;
      months.value = m;

      const classCounts = r.facets['classKey'] ?? [];
      const groups = await namedClasses(classCounts);
      // Every record in one class: the cell's species facet is that class's.
      const only = classCounts.length === 1 && classCounts[0]!.count === r.count ? groups[0] : undefined;
      const known = only && r.facets['speciesKey'] ? new Map([[only.key, r.facets['speciesKey']]]) : undefined;
      const rows = await speciesInClasses(f, groups, {
        maxClasses: HEX_CLASSES,
        perClass: HEX_PER_CLASS,
        signal,
        ...(known && { known }),
      });
      if (signal.aborted) return;
      classes.value = groups;
      species.value = rows;
      const named = await nameFromRecords(rows, signal);
      if (!signal.aborted) species.value = named;
    });
  }

  watch([geometry, () => JSON.stringify(filter.value)], () => void load(), { immediate: true });

  return { loading, error, count, months, classes, species, reload: load };
}
