/** The zoom from which an expanded record's area shows on the map; its dot shows at every zoom. */
import type { Map as MlMap } from 'maplibre-gl';
import { RECORD_AREA_LAYERS, RECORD_MIN_ZOOM } from './style';

/**
 * Show the record's area from RECORD_MIN_ZOOM, or from `finerMinZoom` if sooner, where the grid turns finer than
 * the selected cell: mid-gesture, before the new cells load.
 */
export function sizeRecordLayers(map: MlMap, finerMinZoom: number): void {
  const maxZoom = map.getMaxZoom() + 1;
  for (const layer of RECORD_AREA_LAYERS) {
    if (map.getLayer(layer)) map.setLayerZoomRange(layer, Math.min(RECORD_MIN_ZOOM, finerMinZoom), maxZoom);
  }
}
