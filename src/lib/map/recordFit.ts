/**
 * Keeps a large record area (lib/map/recordPlace.ts) in view: zooms out when the area spans over 80% of
 * the part of the map the panels leave clear and doesn't fit it, flies straight on to the next record's area
 * when that is large too, and goes back to the view from before once the record closes or a smaller one is
 * picked, unless the viewer moved the map or picked another cell since.
 */
import type { Map as MlMap } from 'maplibre-gl';
import { $selectedHex, sameView, type MapView } from '~/stores/explorer';
import { prefersReducedMotion } from '~/stores/reading';
import type { RecordArea } from './recordPlace';

/** How much of the map the floating panels cover, in px per edge. */
export interface CoveredEdges {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface RecordFitOptions {
  map: MlMap;
  coveredEdges: () => CoveredEdges;
  /** Fit [west, south, east, north] clear of the panels, zooming in no further than `maxZoom`. */
  fitBox: (bbox: readonly [number, number, number, number], maxZoom: number) => void;
}

const RETURN_DURATION_MS = 1200;
/** Wider or taller than this, an area (a country's centroid with a vast uncertainty, say) isn't worth zooming out for. */
const MAX_FIT_SPAN_DEGREES = 3;
/** An area smaller than this share of the clear map, on both axes, is left as it lies: panning to it would jolt the map for little. */
const MIN_FIT_SHARE = 0.8;

interface Fitted {
  before: MapView;
  /** The view the fit ended at; null while it is still flying. */
  after: MapView | null;
  hex: unknown;
}

/**
 * @returns A listener for the expanded record's place, to call each time it changes.
 */
export function createRecordFit({ map, coveredEdges, fitBox }: RecordFitOptions) {
  let fitted: Fitted | null = null;
  let latest: RecordArea | null = null;

  const viewNow = (): MapView => ({ ...map.getCenter(), zoom: map.getZoom() });

  /** Fly to show an outline, returning to `before` when the record closes; zooms in no further than it. */
  function startFit(outline: GeoJSON.Position[], before: MapView) {
    const current: Fitted = { before, after: null, hex: $selectedHex.get() };
    fitted = current;
    map.once('moveend', () => {
      if (fitted === current) current.after = viewNow();
    });
    fitBox(boundsOf(outline), before.zoom);
  }

  /** Zoom out to an area that is partly hidden and fills most of the clear map. */
  function fitIfHidden(area: RecordArea) {
    const outline = outerPositions(area);
    const covered = coveredEdges();
    if (!isWorthFitting(map, outline, covered, map.getZoom()) || isInView(map, outline, covered)) return;
    startFit(outline, viewNow());
  }

  /** The last fit, if the map is still where it left it; either way the fit is over. */
  function takeUnmovedFit(): Fitted | null {
    const last = fitted;
    fitted = null;
    const isUnmoved = !!last && $selectedHex.get() === last.hex && (!last.after || sameView(viewNow(), last.after));
    return isUnmoved ? last : null;
  }

  return (area: RecordArea | null) => {
    latest = area;
    const last = takeUnmovedFit();
    const outline = area ? outerPositions(area) : [];
    // From one large area to another, fly straight there: going back to the old view between them is a detour.
    if (last && isWorthFitting(map, outline, coveredEdges(), last.before.zoom)) {
      map.stop();
      return startFit(outline, last.before);
    }
    const fitNext = () => {
      if (area && latest === area) fitIfHidden(area);
    };
    if (last) returnTo(map, last.before, fitNext);
    else fitNext();
  };
}

/** Glide back to a view from before a fit; `then` runs once there. */
function returnTo(map: MlMap, before: MapView, then: () => void) {
  // Stop first: a fit still flying ends now, not after `then` is listening.
  map.stop();
  map.once('moveend', then);
  map.easeTo({
    center: [before.lng, before.lat],
    zoom: before.zoom,
    duration: prefersReducedMotion() ? 0 : RETURN_DURATION_MS,
    essential: false,
  });
}

/** Whether an area is big enough to zoom out for, judged as it would look at `zoom`. */
function isWorthFitting(map: MlMap, outline: GeoJSON.Position[], covered: CoveredEdges, zoom: number): boolean {
  const scale = 2 ** (zoom - map.getZoom());
  return isLargeOnScreen(map, outline, covered, scale) && !isTooWide(outline);
}

/** The positions of an area's outer rings: holes never reach past them. */
function outerPositions(area: RecordArea): GeoJSON.Position[] {
  const polygons = area.type === 'Polygon' ? [area.coordinates] : area.coordinates;
  return polygons.flatMap((polygon) => polygon[0] ?? []);
}

/** Whether an outline spans more than is worth zooming out to show. */
function isTooWide(outline: GeoJSON.Position[]): boolean {
  const [west, south, east, north] = boundsOf(outline);
  return east - west > MAX_FIT_SPAN_DEGREES || north - south > MAX_FIT_SPAN_DEGREES;
}

/**
 * Whether an outline spans more than MIN_FIT_SHARE of the map clear of the panels, across or down.
 * @param scale How much bigger the outline would draw than now: 2 for one zoom level in.
 */
function isLargeOnScreen(map: MlMap, outline: GeoJSON.Position[], covered: CoveredEdges, scale: number): boolean {
  if (outline.length === 0) return false;
  const { clientWidth: width, clientHeight: height } = map.getContainer();
  const points = outline.map((position) => map.project(position as [number, number]));
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const clearWidth = width - covered.left - covered.right;
  const clearHeight = height - covered.top - covered.bottom;
  const isWide = scale * (Math.max(...xs) - Math.min(...xs)) > MIN_FIT_SHARE * clearWidth;
  return isWide || scale * (Math.max(...ys) - Math.min(...ys)) > MIN_FIT_SHARE * clearHeight;
}

/** Whether every position of an outline sits on the map clear of the panels. */
function isInView(map: MlMap, ring: GeoJSON.Position[], covered: CoveredEdges): boolean {
  const { clientWidth: width, clientHeight: height } = map.getContainer();
  return ring.every((position) => {
    const point = map.project(position as [number, number]);
    const isInWidth = point.x >= covered.left && point.x <= width - covered.right;
    return isInWidth && point.y >= covered.top && point.y <= height - covered.bottom;
  });
}

/** A ring's bounding box, as [west, south, east, north]. */
export function boundsOf(ring: GeoJSON.Position[]): [number, number, number, number] {
  const lngs = ring.map((position) => position[0]!);
  const lats = ring.map((position) => position[1]!);
  return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
}
