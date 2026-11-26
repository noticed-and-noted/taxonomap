/**
 * Which mode the map page is in: Explore (the filters and results), Near me, or Analyse.
 * Near me keeps its own `?near=1` key so old links still work; Analyse adds `?analyse=1`.
 */
import { atom, computed } from 'nanostores';
import { SIDE_PANEL_QUERY } from '~/lib/breakpoints';
import { $panel, clearHexSelection } from './explorer';
import { clearFilters, type FilterGroupId } from './filters';
import { $railOpen } from './map-messages';
import { $nearMode, exitNearMode } from './near';
import { codecs, urlAtom } from './url-sync';

export const MAP_MODES = ['explore', 'near', 'analyse'] as const;
export type MapMode = (typeof MAP_MODES)[number];

/** Analyse mode on the map page (`?analyse=1`). */
export const $analyseMode = urlAtom(codecs.bool('analyse', { scope: 'map' }));

/** The current mode; Near me wins if a hand-written link sets both keys. */
export const $mode = computed([$nearMode, $analyseMode], (isNear, isAnalyse): MapMode => {
  if (isNear) return 'near';
  return isAnalyse ? 'analyse' : 'explore';
});

/**
 * The filter groups Analyse keeps: How, and Where for its location accuracy alone (FilterGroup hides the rest).
 * They narrow the migration and spread results too, through `$occurrenceFilter`.
 */
export const ANALYSE_FILTER_GROUPS: readonly FilterGroupId[] = ['where', 'how'];

/** Whether Analyse's panel is showing; the phone's bottom button opens it again once it's slid away. */
export const $analysePanelOpen = atom(true);

/**
 * Switches mode in one history step. Leaving Explore drops the selected cell and closes its panels,
 * as entering Near me always has; coming back opens Explore's results beside the map, where side panels are, as
 * Near me and Analyse open theirs. (A page that opens in Explore keeps its results closed.)
 */
export function setMapMode(mode: MapMode): void {
  if (mode === $mode.get()) return;
  if ($nearMode.get()) exitNearMode();
  if (mode !== 'explore') {
    clearHexSelection();
    $panel.set('none');
  }
  if (mode === 'analyse') enterAnalyse();
  if (mode === 'explore' && window.matchMedia(SIDE_PANEL_QUERY).matches) $panel.set('results');
  $analysePanelOpen.set(true);
  $analyseMode.set(mode === 'analyse');
  if (mode === 'near') $nearMode.set(true);
}

/** Analyse starts from no filters, and closes a filter flyout it doesn't offer. */
function enterAnalyse() {
  clearFilters();
  const openGroup = $railOpen.get();
  if (openGroup && openGroup !== 'settings' && !ANALYSE_FILTER_GROUPS.includes(openGroup)) $railOpen.set(null);
}
