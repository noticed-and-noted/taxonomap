/**
 * Filter groups shown in the left rail (desktop) and stacked in the Filters
 * sheet (phones). Counts are per group, so the rail can badge each icon.
 */
import { computed } from 'nanostores';
import { $groupCounts, type FilterGroupId } from '~/stores/explorer';

export { $groupCounts, type FilterGroupId };

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
];

/** Map settings: the rail's foot button and the phone sheet's last tab. */
export const SETTINGS = {
  id: 'settings',
  label: 'Settings',
  title: 'Settings',
  icon: 'M4 6h8M16 6h4M4 12h2M10 12h10M4 18h10M18 18h2M14 4v4M8 10v4M16 16v4',
} as const;

export const $activeFilterCount = computed($groupCounts, (counts) =>
  Object.values(counts).reduce((sum, count) => sum + count, 0),
);
