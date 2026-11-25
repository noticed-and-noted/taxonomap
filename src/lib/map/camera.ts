/**
 * Camera flights for the map's one-shot requests ($flyTo, the record fit): to a point, or to fit a box clear of
 * the floating chrome, keeping the size a box fits at when the flight lands somewhere else.
 */
import type { Map as MlMap } from 'maplibre-gl';
import { prefersReducedMotion } from '~/stores/reading';
import type { FlyRequest } from '~/stores/map-messages';
import { coveredEdges } from './chrome';
import { zoomDrop } from './occGrid';

/** Breathing room between a fitted area and the map's edges, in px. */
const FIT_PADDING = 60;
const FIT_MAX_ZOOM = 9;
const FIT_DURATION_MS = 1200;
const FLIGHT_DURATION_MS = 1400;
/** MapLibre's world is this many px wide at zoom 0. */
const TILE_SIZE_PX = 512;
/**
 * The most a point is moved off the globe's centre to clear the chrome, as a share of the globe's radius: zoomed
 * out, the chrome can be wider than the globe, and a full offset would put the point on its rim or past it.
 */
const MAX_OFFSET_SHARE = 0.5;

type BoundsRequest = Extract<FlyRequest, { kind: 'bounds' }>;
type PointRequest = Extract<FlyRequest, { kind: 'point' }>;

/** Fly to a point, or fit a box, with the map's covered edges allowed for. */
export function flyMap(map: MlMap, request: FlyRequest): void {
  if (request.kind === 'bounds') flyToBounds(map, request);
  else flyToPoint(map, request);
}

/** Fly to a point, centred in the part of the map the chrome leaves clear. */
function flyToPoint(map: MlMap, request: PointRequest): void {
  const covered = coveredEdges(map);
  const maxOffset = MAX_OFFSET_SHARE * globeRadiusPx(request.zoom);
  const clamp = (px: number) => Math.max(-maxOffset, Math.min(maxOffset, px));
  // An offset, not camera padding: MapLibre keeps padding after the move.
  map.flyTo({
    center: [request.lng, request.lat],
    zoom: request.zoom,
    offset: [clamp((covered.left - covered.right) / 2), clamp((covered.top - covered.bottom) / 2)],
    duration: prefersReducedMotion() ? 0 : FLIGHT_DURATION_MS,
    essential: false,
  });
}

/** The globe's radius on screen at a zoom, in px: the world's width there wrapped round a circle. */
function globeRadiusPx(zoom: number): number {
  return (TILE_SIZE_PX * 2 ** zoom) / (2 * Math.PI);
}

/** Fit a box clear of the floating chrome, or fly to a chosen centre at the zoom that fits it. */
export function flyToBounds(map: MlMap, request: BoundsRequest): void {
  const covered = coveredEdges(map);
  const [west, south, east, north] = request.bbox;
  const bounds: [[number, number], [number, number]] = [
    [west, south],
    [east, north],
  ];
  const fit = {
    padding: {
      top: covered.top + FIT_PADDING,
      bottom: covered.bottom + FIT_PADDING,
      left: covered.left + FIT_PADDING,
      right: covered.right + FIT_PADDING,
    },
    maxZoom: request.maxZoom ?? FIT_MAX_ZOOM,
  };
  if (!request.centre) {
    map.fitBounds(bounds, { ...fit, duration: prefersReducedMotion() ? 0 : FIT_DURATION_MS });
    return;
  }
  const camera = map.cameraForBounds(bounds, fit);
  const [lng, lat] = request.centre;
  if (!camera?.center || camera.zoom === undefined)
    return flyToPoint(map, { kind: 'point', lng, lat, zoom: map.getZoom() });
  // The globe draws at its centre's scale: keep the size that fits the box, wherever the centre is.
  const boxLat = Array.isArray(camera.center) ? camera.center[1] : camera.center.lat;
  // Below the least zoom MapLibre's globe flights near a pole can stall or land elsewhere.
  const zoom = Math.max(map.getMinZoom(), camera.zoom + zoomDrop(boxLat) - zoomDrop(lat));
  flyToPoint(map, { kind: 'point', lng, lat, zoom });
}
