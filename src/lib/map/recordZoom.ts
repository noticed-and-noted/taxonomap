/** The zooms from which an expanded record's dot and area show on the map. */
import type { Map as MlMap } from 'maplibre-gl';
import type { LngLat } from './occGrid';
import { RECORD_AREA_LAYERS, RECORD_DOT_LAYER, RECORD_MIN_ZOOM, recordDotMinZoom } from './style';

/**
 * Show the record's dot from the zoom where the area holding it (the selected cell, or near me's circle) is wide
 * enough on screen, and its area from RECORD_MIN_ZOOM; either from `finerMinZoom` if sooner, where the grid turns
 * finer than the selected cell: mid-gesture, before the new cells load.
 * @param areaRing The cell's or circle's outline, if there is one.
 */
export function sizeRecordLayers(map: MlMap, areaRing: readonly LngLat[] | undefined, finerMinZoom: number): void {
  if (!map.getLayer(RECORD_DOT_LAYER)) return;
  const xs = areaRing?.map((position) => map.project(position as [number, number]).x);
  const areaWidth = xs ? Math.max(...xs) - Math.min(...xs) : null;
  const maxZoom = map.getMaxZoom() + 1;
  const dotMinZoom = Math.min(recordDotMinZoom(map.getZoom(), areaWidth), finerMinZoom);
  map.setLayerZoomRange(RECORD_DOT_LAYER, dotMinZoom, maxZoom);
  for (const layer of RECORD_AREA_LAYERS)
    map.setLayerZoomRange(layer, Math.min(RECORD_MIN_ZOOM, finerMinZoom), maxZoom);
}
