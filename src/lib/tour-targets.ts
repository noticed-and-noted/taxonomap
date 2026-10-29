/**
 * Where on the page the tour and the "Try this" hints point: the first laid-out
 * match of a selector, so a desktop control and its phone stand-in can share one.
 */
import { $busiestHexBox } from '~/stores/explorer';
import type { ChecklistId } from '~/stores/onboarding';
import { clipBox, type ScreenBox } from './tour';

/** The cell panel: a side panel on wide screens, a bottom sheet on narrow ones. */
export const PANEL_SELECTOR = '.side-panel, .bottom-sheet';

/**
 * The box of the first matching element that is laid out (hidden ones have no size).
 * @param selector A CSS selector, often a list of alternatives.
 * @returns Its box on screen, or null when none is shown.
 */
export function boxOf(selector: string): ScreenBox | null {
  for (const element of document.querySelectorAll(selector)) {
    const rect = element.getBoundingClientRect();
    if (rect.width && rect.height) return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  }
  return null;
}

/**
 * The cell panel's species list (each row opens its species), cut to the part the panel shows.
 * @returns Its visible box, or null when the panel or list isn't shown.
 */
export function speciesListBox(): ScreenBox | null {
  const panel = boxOf(PANEL_SELECTOR);
  const list = boxOf('.hex-panel [role="region"][aria-label="Species results"]');
  return panel && list && clipBox(list, panel);
}

/** A rail button on wide screens; phones reach the same group through the Filters button. */
const railOrFilters = (id: string) => boxOf(`[data-tour="rail-${id}"], .filters-btn`);

export interface Hint {
  body: string;
  targets: () => (ScreenBox | null)[];
  /** Asks the map for a hex to point at (its box arrives on $busiestHexBox). */
  needsHex?: boolean;
  /** Shown instead of `body` when there is nothing clear of the chrome to point at. */
  emptyBody?: string;
}

/** What each "Try this" item's help shows: where to click, and what to do there. */
export const HINTS: Record<ChecklistId, Hint> = {
  search: {
    body: 'Type a species name here, such as puffin, and pick it from the list.',
    targets: () => [boxOf('[data-tour="search"]')],
  },
  hex: {
    body: 'Click any hex to see the species and records found inside it.',
    targets: () => [$busiestHexBox.get()],
    needsHex: true,
    emptyBody:
      'Can’t see a hex? Pan or zoom out the map, or loosen your filters. Then click a hex to see what was found there.',
  },
  when: {
    body: 'Open the When filter, then drag the time slider or pick a range of years.',
    targets: () => [railOrFilters('when')],
  },
  group: {
    body: 'Open the What filter, then pick a group such as birds or fungi.',
    targets: () => [railOrFilters('what')],
  },
  near: {
    body: 'Near me shows what has been found around your location, or around a place you pick.',
    targets: () => [boxOf('[data-tour="near"]')],
  },
  tree: {
    body: 'Open Tree of life, then click a group to go down a rank.',
    targets: () => [boxOf('[data-tour="nav"] a[href="/tree/"]')],
  },
  style: {
    body: 'Change the map colours in Settings, or switch between light and dark here.',
    targets: () => [railOrFilters('settings'), boxOf('[data-theme-toggle]')],
  },
};
