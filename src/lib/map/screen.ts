/**
 * Where places fall on the map's canvas, allowing for the globe: a place on
 * the far side still projects to a pixel, and a pixel past the globe's rim
 * still unprojects to a place, so both are checked by a round trip.
 */
import type { Map as MlMap } from 'maplibre-gl';

import type { LngLat } from './occGrid';

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
