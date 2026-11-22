/**
 * Every URL filter in one list, and what the app derives from it: the occurrence filter
 * every query uses, the pills, the rail's badge counts and "clear all".
 */
import { computed, type ReadableAtom, type WritableAtom } from 'nanostores';
import { rangeFilter, rangeLabel } from '~/lib/dates';
import { BASIS_LABELS, CONTINENT_LABELS, distance, IUCN_LABELS, MONTHS } from '~/lib/format';
import type { OccurrenceFilter } from '~/lib/gbif';
import {
  $basisOfRecord,
  clearHexSelection,
  $continents,
  $dateRange,
  $exactTaxon,
  $hasPhoto,
  $hasSound,
  $iucn,
  $maxUncertainty,
  $months,
  $selectedHex,
  $taxonKeys,
} from './explorer';
import { $hexGeometry } from './map-messages';
import { $publisherKeys, $publisherNames, publisherName } from './publisher';
import { $recorders } from './recorder';

/** The filter rail's groups (see lib/filter-groups.ts for labels and icons). */
export type FilterGroupId = 'what' | 'when' | 'where' | 'how';

/**
 * One URL-synced filter: the rail group it sits in, when it counts as set,
 * the OccurrenceFilter fields it contributes, its cleared value, and its
 * pills when set (none for taxa, which have their own chips).
 */
interface FilterDef<T> {
  store: WritableAtom<T>;
  group: FilterGroupId;
  cleared: T;
  isSet: (value: T) => boolean;
  apply: (value: T) => OccurrenceFilter;
  pills?: ((value: T) => FilterPill[]) | undefined;
}

/** A removable pill for (part of) a set filter. */
export interface FilterPill {
  text: string;
  clear: () => void;
}

/** A FilterDef with its value type erased, so filters of every type share one list. */
export interface Filter {
  store: ReadableAtom<unknown>;
  group: FilterGroupId;
  isSet: (value: unknown) => boolean;
  apply: (value: unknown) => OccurrenceFilter;
  pills?: ((value: unknown) => FilterPill[]) | undefined;
  clear: () => void;
}

function filter<T>(definition: FilterDef<T>): Filter {
  return {
    store: definition.store,
    group: definition.group,
    isSet: (value) => definition.isSet(value as T),
    apply: (value) => definition.apply(value as T),
    pills: definition.pills && ((value) => definition.pills!(value as T)),
    clear: () => definition.store.set(definition.cleared),
  };
}

/** One pill for the whole filter: removing it clears the filter. */
const whole =
  <T>(store: WritableAtom<T>, cleared: T, label: (value: T) => string) =>
  (value: T): FilterPill[] => [{ text: label(value), clear: () => store.set(cleared) }];

/** A list filter, with (`each`) one pill per item that removes just that item. */
const list = <T>(
  store: WritableAtom<T[]>,
  group: FilterGroupId,
  apply: (values: T[]) => OccurrenceFilter,
  each?: (item: T) => string,
) =>
  filter({
    store,
    group,
    cleared: [],
    isSet: (value) => value.length > 0,
    apply,
    pills:
      each &&
      ((value) =>
        value.map((item) => ({
          text: each(item),
          clear: () => store.set(store.get().filter((existing) => existing !== item)),
        }))),
  });
const flag = (store: WritableAtom<boolean>, group: FilterGroupId, fields: OccurrenceFilter, label: string) =>
  filter({
    store,
    group,
    cleared: false,
    isSet: (value) => value,
    apply: () => fields,
    pills: whole(store, false, () => label),
  });
const nullable = <T>(
  store: WritableAtom<T | null>,
  group: FilterGroupId,
  apply: (value: T) => OccurrenceFilter,
  label: (value: T) => string,
) =>
  filter({
    store,
    group,
    cleared: null,
    isSet: (value) => value !== null,
    apply: (value) => apply(value as T),
    pills: whole(store, null, (value) => label(value as T)),
  });

/**
 * Every filter, in one place: adding one here feeds the occurrence filter,
 * "clear all" and the rail's badge counts.
 */
export const FILTERS: readonly Filter[] = [
  list($taxonKeys, 'what', (taxonKeys) => ({ taxonKeys })),
  flag($exactTaxon, 'what', { exactTaxon: true }, 'Exact taxon only'),
  list(
    $iucn,
    'what',
    (iucn) => ({ iucn }),
    (code) => IUCN_LABELS[code]!,
  ),
  nullable($dateRange, 'when', (range) => rangeFilter(range), rangeLabel),
  list(
    $months,
    'when',
    (months) => ({ months }),
    (month) => MONTHS[month - 1]!,
  ),
  list(
    $continents,
    'where',
    (continents) => ({ continents }),
    (continent) => CONTINENT_LABELS[continent]!,
  ),
  nullable(
    $maxUncertainty,
    'where',
    (maxUncertaintyM) => ({ maxUncertaintyM }),
    (metres) => `Accuracy ≤ ${distance(metres)}`,
  ),
  list(
    $basisOfRecord,
    'how',
    (basisOfRecord) => ({ basisOfRecord }),
    (basis) => BASIS_LABELS[basis]!,
  ),
  list($publisherKeys, 'how', (publishers) => ({ publishers }), publisherName),
  list(
    $recorders,
    'how',
    (recorders) => ({ recorders }),
    (name) => name,
  ),
  flag($hasPhoto, 'how', { hasImage: true }, 'Has photo'),
  flag($hasSound, 'how', { hasSound: true }, 'Has sound'),
];

const filterValues = computed(
  FILTERS.map((filterDef) => filterDef.store),
  (...values: unknown[]) => values,
);

/** The URL filters as one OccurrenceFilter (only the ones that are set). */
export const $occurrenceFilter = computed(filterValues, (values): OccurrenceFilter => {
  const out: OccurrenceFilter = {};
  FILTERS.forEach((filterDef, index) => {
    if (filterDef.isSet(values[index])) Object.assign(out, filterDef.apply(values[index]));
  });
  return out;
});

/**
 * What the results panel lists: the selected cell under the filters, or everything the filters match when no
 * cell is selected. Null while a selected cell's geometry is still being found.
 */
export const $resultsFilter = computed(
  [$selectedHex, $hexGeometry, $occurrenceFilter],
  (hex, geometry, filter): OccurrenceFilter | null => {
    if (!hex) return filter;
    return geometry ? { ...filter, geometry: geometry.wkt } : null;
  },
);

/**
 * The set filters (other than taxa) as pills, with the rail group each sits in.
 * Publisher names arrive after their keys, so the pills follow those too.
 */
export const $filterPills = computed([filterValues, $publisherNames], (values) =>
  FILTERS.flatMap((filterDef, index) =>
    filterDef.pills && filterDef.isSet(values[index])
      ? filterDef
          .pills(values[index])
          .map((pill, pillIndex) => ({ ...pill, id: `${index}-${pillIndex}`, group: filterDef.group }))
      : [],
  ),
);

/** How many selections a set filter adds to its group's badge: one per pill, or per taxon (taxa have no pills). */
function selectionCount(filterDef: Filter, value: unknown): number {
  return filterDef.pills ? filterDef.pills(value).length : (value as readonly number[]).length;
}

export const $groupCounts = computed(filterValues, (values) => {
  const counts: Record<FilterGroupId, number> = { what: 0, when: 0, where: 0, how: 0 };
  FILTERS.forEach((filterDef, index) => {
    if (filterDef.isSet(values[index])) counts[filterDef.group] += selectionCount(filterDef, values[index]);
  });
  return counts;
});

/** Reset every filter, taxa included (one history step). */
export function clearFilters(): void {
  clearHexSelection();
  for (const filterDef of FILTERS) filterDef.clear();
}
