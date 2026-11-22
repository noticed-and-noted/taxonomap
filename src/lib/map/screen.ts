/**
 * Where places fall on the map's canvas, allowing for the globe: a place on
 * the far side still projects to a pixel, and a pixel past the globe's rim
 * still unprojects to a place, so both are checked by a round trip.
 */
import type { Map as MlMap } from 'maplibre-gl';

import type { LngLat } from './occGrid';
import type { Bbox } from './taxonView';

/** How far, in degrees, a place may drift on its way to the screen and back and still count as on the near side. */
const ROUND_TRIP_DEGREES = 0.5;
/** How far, in px, a pixel may drift on its way to the globe and back and still count as on it. */
const ROUND_TRIP_PX = 1;

/**
 * The place under a pixel, or null when the pixel is off the globe
 * (there unproject snaps to the horizon, so the pixel does not round-trip).
 */
export function placeAt(map: MlMap, pixelX: number, pixelY: number): LngLat | null {
  const position = map.unproject([pixelX, pixelY]);
  const back = map.project(position);
  return Math.hypot(back.x - pixelX, back.y - pixelY) <= ROUND_TRIP_PX ? [position.lng, position.lat] : null;
}

/** Whether a place is on the canvas and on the globe's near side. */
export function isOnScreen(map: MlMap, [lng, lat]: LngLat): boolean {
  const canvas = map.getCanvas();
  const point = map.project([lng, lat]);
  if (point.x < 0 || point.y < 0 || point.x > canvas.clientWidth || point.y > canvas.clientHeight) return false;
  const back = map.unproject([point.x, point.y]);
  const lngDrift = Math.abs(((back.lng - lng + 540) % 360) - 180);
  return Math.abs(back.lat - lat) < ROUND_TRIP_DEGREES && lngDrift < ROUND_TRIP_DEGREES;
}

/** Whether the globe (or the flat map) covers the whole canvas, corner to corner. */
export function fillsCanvas(map: MlMap): boolean {
  const { clientWidth: width, clientHeight: height } = map.getCanvas();
  const corners = [
    [0, 0],
    [width, 0],
    [0, height],
    [width, height],
  ] as const;
  return corners.every(([pixelX, pixelY]) => placeAt(map, pixelX, pixelY) !== null);
}

/** Below this zoom the canvas corners miss the globe, so the extent is the whole world. */
const WORLD_BOUNDS_MAX_ZOOM = 2.5;
const MAX_MERCATOR_LAT = 85;
const WORLD_BOUNDS: Bbox = [-180, -MAX_MERCATOR_LAT, 180, MAX_MERCATOR_LAT];

/**
 * The visible extent, from the canvas corners and edge midpoints (getBounds() is world-wide under the globe
 * projection). At very low zoom, or before the canvas has a size, the corners miss the globe: the whole world.
 */
export function viewBounds(map: MlMap): Bbox {
  const { clientWidth: width, clientHeight: height } = map.getCanvas();
  if (map.getZoom() < WORLD_BOUNDS_MAX_ZOOM || !width || !height) return WORLD_BOUNDS;
  const edgePoints: [number, number][] = [
    [0, 0],
    [width, 0],
    [0, height],
    [width, height],
    [width / 2, 0],
    [width / 2, height],
  ];
  const places = edgePoints.map((point) => map.unproject(point));
  const lngs = places.map((place) => place.lng);
  const lats = places.map((place) => place.lat);
  return [
    Math.min(...lngs),
    Math.max(-MAX_MERCATOR_LAT, Math.min(...lats)),
    Math.max(...lngs),
    Math.min(MAX_MERCATOR_LAT, Math.max(...lats)),
  ];
}

/**
 * Whether any cell of a layer is drawn in view. A whole-canvas query finds nothing under the globe once the
 * canvas reaches past its rim, so only then look for a cell corner on screen.
 */
export function hasCellInView(map: MlMap, layerId: string): boolean {
  if (map.queryRenderedFeatures({ layers: [layerId] }).length) return true;
  if (fillsCanvas(map)) return false;
  const source = map.getLayer(layerId)!.source;
  return map.querySourceFeatures(source).some((feature) => {
    const { geometry } = feature;
    if (geometry.type !== 'Polygon') return false;
    return geometry.coordinates.some((ring) => ring.some(([lng = 0, lat = 0]) => isOnScreen(map, [lng, lat])));
  });
}
