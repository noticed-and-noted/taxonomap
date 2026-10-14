/**
 * Filter groups shown in the left rail (desktop) and stacked in the Filters
 * sheet (phones). Counts are per group, so the rail can badge each icon.
 */
import { computed } from 'nanostores';
import {
  $basisOfRecord,
  $continents,
  $hasPhoto,
  $hasSound,
  $iucn,
  $licences,
  $maxUncertainty,
  $months,
  $taxonKeys,
  $yearRange,
} from '~/stores/explorer';

export type FilterGroupId = 'what' | 'when' | 'where' | 'how' | 'source';

export interface FilterGroupMeta {
  id: FilterGroupId;
  /** Short rail label. */
  label: string;
  /** Flyout / section heading. */
  title: string;
  /** 24×24 stroke icon path. */
  icon: string;
}

export const FILTER_GROUPS: readonly FilterGroupMeta[] = [
  {
    id: 'what',
    label: 'What',
    title: 'What',
    icon: 'M5 21c.5-4.5 2.5-8 7-10M9 18c6.2 0 10.5-3.3 11-12V4h-4c-9 0-12 4-12 9 0 1 0 3 2 5h3z',
  },
  {
    id: 'when',
    label: 'When',
    title: 'When',
    icon: 'M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM16 3v4M8 3v4M4 11h16',
  },
  {
    id: 'where',
    label: 'Where',
    title: 'Where',
    icon: 'M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0M3.6 9h16.8M3.6 15h16.8M11.5 3a17 17 0 0 0 0 18M12.5 3a17 17 0 0 1 0 18',
  },
  {
    id: 'how',
    label: 'How',
    title: 'How recorded',
    icon: 'M10 12a2 2 0 1 0 4 0a2 2 0 0 0-4 0M21 12c-2.4 4-5.4 6-9 6s-6.6-2-9-6c2.4-4 5.4-6 9-6s6.6 2 9 6',
  },
  {
    id: 'source',
    label: 'Source',
    title: 'Source',
    icon: 'M4 6a8 3 0 1 0 16 0a8 3 0 1 0-16 0M4 6v6a8 3 0 0 0 16 0V6M4 12v6a8 3 0 0 0 16 0v-6',
  },
];

/** Active filters per group (each control that is set counts once). */
export const $groupCounts = computed(
  [
    $taxonKeys,
    $iucn,
    $yearRange,
    $months,
    $continents,
    $maxUncertainty,
    $basisOfRecord,
    $hasPhoto,
    $hasSound,
    $licences,
  ],
  (taxa, iucn, years, months, continents, uncert, basis, photo, sound, licences): Record<FilterGroupId, number> => ({
    what: +(taxa.length > 0) + +(iucn.length > 0),
    when: +(years !== null) + +(months.length > 0),
    where: +(continents.length > 0) + +(uncert !== null),
    how: +(basis.length > 0) + +photo + +sound,
    source: +(licences.length > 0),
  }),
);

export const $activeFilterCount = computed($groupCounts, (c) => Object.values(c).reduce((a, b) => a + b, 0));
