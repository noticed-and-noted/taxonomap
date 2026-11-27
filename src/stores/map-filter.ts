/**
 * What the map draws. In Analyse with a species picked, that species' records in Analyse's years (and, in Migration,
 * its month), narrowed by the filters Analyse keeps; everywhere else, the filters.
 */
import { computed } from 'nanostores';
import type { OccurrenceFilter } from '~/lib/gbif';
import {
  $analyseGroup,
  $analyseMonth,
  $analyseTaxon,
  $analyseView,
  $analyseYears,
  $migrationEffort,
  yearsIncluded,
} from './analyse';
import { $occurrenceFilter } from './filters';
import { $mode } from './mode';

/** The species' records in Analyse's years, every month; null outside Analyse or with no species picked. */
export const $analyseFilter = computed(
  [$mode, $analyseTaxon, $analyseYears, $occurrenceFilter],
  (mode, taxonKey, years, filter): OccurrenceFilter | null => {
    if (mode !== 'analyse' || taxonKey === null) return null;
    // Analyse has no What or When: a hand-written link's taxa and dates give way to its own.
    const { taxonKeys: _taxa, eventDate: _dates, ...kept } = filter;
    return { ...kept, taxonKey, year: yearsIncluded(years) };
  },
);

/** The records the map draws and counts. */
export const $mapFilter = computed(
  [$analyseFilter, $analyseView, $analyseMonth, $occurrenceFilter],
  (analyse, view, month, filter): OccurrenceFilter => {
    if (!analyse) return filter;
    return view === 'migration' ? { ...analyse, months: [month] } : analyse;
  },
);

/**
 * What the map compares its records with when Migration adjusts for how many people record: the same records of the
 * species' whole group (all birds, say), cell by cell. Null when the map draws plain record counts.
 */
export const $mapBaseline = computed(
  [$mapFilter, $analyseFilter, $analyseView, $migrationEffort, $analyseGroup],
  (filter, analyse, view, isAdjusted, group): OccurrenceFilter | null => {
    if (!analyse || view !== 'migration' || !isAdjusted || !group) return null;
    return { ...filter, taxonKey: group.key };
  },
);
