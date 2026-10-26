/**
 * Keeps an expanded record's whole obscured area (lib/map/recordPlace.ts) in view: zooms out when the
 * area doesn't fit the part of the map the panels leave clear, and goes back to the view from before once
 * the record closes or another is picked, unless the viewer moved the map or picked another cell since.
 */
import type { Map as MlMap } from 'maplibre-gl';
import { $selectedHex, sameView, type MapView } from '~/stores/explorer';
import { prefersReducedMotion } from '~/stores/reading';

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
  let latest: GeoJSON.Point | GeoJSON.Polygon | null = null;

  const viewNow = (): MapView => ({ ...map.getCenter(), zoom: map.getZoom() });

  function fitIfHidden(area: GeoJSON.Polygon) {
    const ring = area.coordinates[0] ?? [];
    if (isInView(map, ring, coveredEdges())) return;
    const current: Fitted = { before: viewNow(), after: null, hex: $selectedHex.get() };
    fitted = current;
    map.once('moveend', () => {
      if (fitted === current) current.after = viewNow();
    });
    fitBox(boundsOf(ring), map.getZoom());
  }

  /** Back to the view before the last fit, if the map is still where the fit left it; `then` runs once there. */
  function goBack(then: () => void) {
    const last = fitted;
    fitted = null;
    const isUnmoved = !!last && $selectedHex.get() === last.hex && (!last.after || sameView(viewNow(), last.after));
    if (!isUnmoved) return then();
    // Stop first: a fit still flying ends now, not after `then` is listening.
    map.stop();
    map.once('moveend', then);
    map.easeTo({
      center: [last.before.lng, last.before.lat],
      zoom: last.before.zoom,
      duration: prefersReducedMotion() ? 0 : RETURN_DURATION_MS,
      essential: false,
    });
  }

  return (place: GeoJSON.Point | GeoJSON.Polygon | null) => {
    latest = place;
    goBack(() => {
      if (place?.type === 'Polygon' && latest === place) fitIfHidden(place);
    });
  };
}

function isInView(map: MlMap, ring: GeoJSON.Position[], covered: CoveredEdges): boolean {
  const { clientWidth: width, clientHeight: height } = map.getContainer();
  return ring.every((position) => {
    const point = map.project(position as [number, number]);
    const isInWidth = point.x >= covered.left && point.x <= width - covered.right;
    return isInWidth && point.y >= covered.top && point.y <= height - covered.bottom;
  });
}

function boundsOf(ring: GeoJSON.Position[]): [number, number, number, number] {
  const lngs = ring.map((position) => position[0]!);
  const lats = ring.map((position) => position[1]!);
  return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
}
