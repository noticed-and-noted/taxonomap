/**
 * Which mode the map page is in: Explore (the filters and results), Near me, or Analyse.
 * Near me keeps its own `?near=1` key so old links still work; Analyse adds `?analyse=1`.
 */
import { computed } from 'nanostores';
import { $panel, clearHexSelection } from './explorer';
import { $nearMode, exitNearMode } from './near';
import { codecs, urlAtom } from './url-sync';

export const MAP_MODES = ['explore', 'near', 'analyse'] as const;
export type MapMode = (typeof MAP_MODES)[number];

/** Analyse mode on the map page (`?analyse=1`). */
export const $analyseMode = urlAtom(codecs.bool('analyse', { scope: 'map' }));

/** The current mode; Near me wins if a hand-written link sets both keys. */
export const $mapMode = computed([$nearMode, $analyseMode], (isNear, isAnalyse): MapMode => {
  if (isNear) return 'near';
  return isAnalyse ? 'analyse' : 'explore';
});

/**
 * Switches mode in one history step. Leaving Explore drops the selected cell and closes its panels,
 * as entering Near me always has.
 */
export function setMapMode(mode: MapMode): void {
  if (mode === $mapMode.get()) return;
  if ($nearMode.get()) exitNearMode();
  if (mode !== 'explore') {
    clearHexSelection();
    $panel.set('none');
  }
  $analyseMode.set(mode === 'analyse');
  if (mode === 'near') $nearMode.set(true);
}
