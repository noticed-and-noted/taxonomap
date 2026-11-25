/**
 * MapLibre's compact attribution: on a phone it opens over too much of the map once its text arrives, so close
 * it then, and close it whenever a press lands outside it.
 */
import type { Map as MlMap } from 'maplibre-gl';

const COMPACT = '.maplibregl-compact';
const SHOWN_CLASS = 'maplibregl-compact-show';

/**
 * Keep the attribution out of the way.
 * @param isPhone Whether to close it as soon as its text arrives.
 * @returns Stops listening.
 */
export function tameAttribution(map: MlMap, container: HTMLElement, isPhone: boolean): () => void {
  function collapse() {
    const attribution = container.querySelector(COMPACT);
    if (!attribution) return;
    attribution.classList.remove(SHOWN_CLASS);
    map.off('sourcedata', collapse);
  }

  function closeOnPressOutside(event: PointerEvent) {
    const attribution = container.querySelector(`.${SHOWN_CLASS}`);
    if (attribution && !attribution.contains(event.target as Node)) attribution.classList.remove(SHOWN_CLASS);
  }

  if (isPhone) map.on('sourcedata', collapse);
  document.addEventListener('pointerdown', closeOnPressOutside);
  return () => {
    map.off('sourcedata', collapse);
    document.removeEventListener('pointerdown', closeOnPressOutside);
  };
}
