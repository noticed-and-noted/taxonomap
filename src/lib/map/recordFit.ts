/**
 * Keeps a large record area (lib/map/recordPlace.ts) in view: zooms out when the area spans over 80% of
 * the part of the map the panels leave clear and doesn't fit it, flies straight on to the next record's area
 * when that is large too, and goes back to the view from before once the record closes or a smaller one is
 * picked, unless the viewer moved the map or picked another cell since. The map also flies to a record that
 * can't be seen (off the clear map, or an area drawn only from a closer zoom), and back when it closes; from
 * there it goes straight on to the next record, with no stop at the view from before.
 */
import type { Map as MlMap } from 'maplibre-gl';
import { type MapView, sameView, $selectedHex } from '~/stores/explorer';
import { prefersReducedMotion } from '~/stores/reading';
import type { RecordArea, RecordPlace } from './recordPlace';
import { isOnNearSide } from './screen';
import { RECORD_AREA_LAYERS } from './style';

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

/**
 * How far past the zoom a record shows from to fly: the globe's zoom shifts with latitude on the way, and the
 * area's threshold is re-measured where the flight lands, so aiming at it exactly can stop just short.
 */
const SHOWN_ZOOM_MARGIN = 0.5;

/** A flight to show a record: the outline to fit, no closer than `maxZoom`. */
interface Flight {
  outline: GeoJSON.Position[];
  maxZoom: number;
  /** True when zooming out to a large area, false when going to a record that can't be seen. */
  isZoomOut: boolean;
}

interface Fitted {
  before: MapView;
  isZoomOut: boolean;
  /** The view the fit ended at; null while it is still flying. */
  after: MapView | null;
  hex: unknown;
}

/**
 * @returns A listener for the expanded record's place, to call each time it changes.
 */
export function createRecordFit({ map, coveredEdges, fitBox }: RecordFitOptions) {
  let fitted: Fitted | null = null;
  let latest: RecordPlace | null = null;

  /** Make a flight, returning to `before` when the record closes. */
  function startFit({ outline, maxZoom, isZoomOut }: Flight, before: MapView) {
    const current: Fitted = { before, isZoomOut, after: null, hex: $selectedHex.get() };
    fitted = current;
    map.once('moveend', () => {
      if (fitted === current) current.after = viewOf(map);
    });
    fitBox(boundsOf(outline), maxZoom);
  }

  /** From a record the map went to, go on to the next (or stay, if it shows), keeping the view to return to. */
  function goStraightOn(place: RecordPlace, last: Fitted) {
    map.stop();
    const flight = flightToShow(map, place, coveredEdges());
    if (flight) startFit(flight, last.before);
    else fitted = last;
  }

  /** The last fit, if the map is still where it left it; either way the fit is over. */
  function takeUnmovedFit(): Fitted | null {
    const last = fitted;
    fitted = null;
    const isUnmoved = !!last && $selectedHex.get() === last.hex && (!last.after || sameView(viewOf(map), last.after));
    return isUnmoved ? last : null;
  }

  return (place: RecordPlace | null) => {
    latest = place;
    const last = takeUnmovedFit();
    const outline = place ? outlineOf(place) : [];
    // From one large area to another, fly straight there: going back to the old view between them is a detour.
    if (last && isWorthFitting(map, outline, coveredEdges(), last.before.zoom)) {
      map.stop();
      return startFit({ outline, maxZoom: last.before.zoom, isZoomOut: true }, last.before);
    }
    if (last && !last.isZoomOut && place) return goStraightOn(place, last);
    const fitNext = () => {
      const flight = place && latest === place && flightToShow(map, place, coveredEdges());
      if (flight) startFit(flight, viewOf(map));
    };
    if (last) returnTo(map, last.before, fitNext);
    else fitNext();
  };
}

/**
 * Where to fly to show a record, if anywhere: out to a large area that is partly hidden, else to a record whose
 * point (or area's middle) is off the clear map, or whose area (with no point) shows only from a closer zoom.
 * @returns The outline to fit and the zoom to go no closer than, or null to leave the map as it is.
 */
function flightToShow(map: MlMap, place: RecordPlace, covered: CoveredEdges): Flight | null {
  const outline = outlineOf(place);
  const zoom = map.getZoom();
  if (isWorthFitting(map, outline, covered, zoom))
    return isInView(map, outline, covered) ? null : { outline, maxZoom: zoom, isZoomOut: true };
  // A vast area alone is not worth flying to; a point in one still is.
  if (!place.point && isTooWide(outline)) return null;

  const target = place.point ? [place.point.coordinates] : outline;
  if (target.length === 0) return null;
  const [west, south, east, north] = boundsOf(target);
  const middle = [(west + east) / 2, (south + north) / 2];
  // The dot shows at every zoom; an area only from its layer's.
  const shownFromZoom = place.point ? 0 : (map.getLayer(RECORD_AREA_LAYERS[0])?.minzoom ?? 0);
  const isUnseen = zoom < shownFromZoom || !isInView(map, [middle], covered);
  if (!isUnseen) return null;
  const maxZoom = zoom < shownFromZoom ? shownFromZoom + SHOWN_ZOOM_MARGIN : zoom;
  return { outline: target, maxZoom, isZoomOut: false };
}

/** Where the map is now. */
function viewOf(map: MlMap): MapView {
  return { ...map.getCenter(), zoom: map.getZoom() };
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

/** A record's area's outer positions, or none when it has no area. */
function outlineOf(place: RecordPlace): GeoJSON.Position[] {
  return place.area ? outerPositions(place.area) : [];
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

/** Whether every position of an outline sits on the map clear of the panels, on the globe's near side. */
function isInView(map: MlMap, ring: GeoJSON.Position[], covered: CoveredEdges): boolean {
  const { clientWidth: width, clientHeight: height } = map.getContainer();
  return ring.every((position) => {
    const lngLat = position as [number, number];
    if (!isOnNearSide(map, lngLat)) return false;
    const point = map.project(lngLat);
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
