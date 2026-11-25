import type { Map as MlMap } from 'maplibre-gl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRecordFit } from '~/lib/map/recordFit';
import type { RecordPlace } from '~/lib/map/recordPlace';
import { $selectedHex } from '~/stores/explorer';

const motion = vi.hoisted(() => ({ isReduced: true }));
vi.mock('~/stores/reading', () => ({ prefersReducedMotion: () => motion.isReduced }));

const SIZE_PX = 100;
/** The zoom the record's layers show from, as sizeRecordLayers last set it. */
const layerMinZoom = { value: 0 };
const NONE_COVERED = { top: 0, right: 0, bottom: 0, left: 0 };
/** Where the globe's far side starts, as a longitude: past it a point projects on screen but is hidden. */
const farSide = { fromLng: Infinity };

/** A flat stand-in map, SIZE_PX square, 2^zoom px per degree, whose moves end at once. */
function fakeMap() {
  const camera = { lng: 0, lat: 0, zoom: 6 };
  const handlers: (() => void)[] = [];
  const moveEnd = () => handlers.splice(0).forEach((handler) => handler());
  const map = {
    camera,
    moveEnd,
    getCenter: () => ({ lng: camera.lng, lat: camera.lat }),
    getZoom: () => camera.zoom,
    getLayer: () => ({ minzoom: layerMinZoom.value }),
    getContainer: () => ({ clientWidth: SIZE_PX, clientHeight: SIZE_PX }),
    /** A far-side point projects through the globe, so it comes back as the near-side point in front of it. */
    unproject: ([pixelX, pixelY]: [number, number]) => {
      const lng = camera.lng + (pixelX - SIZE_PX / 2) / 2 ** camera.zoom;
      const lat = camera.lat - (pixelY - SIZE_PX / 2) / 2 ** camera.zoom;
      return { lng: lng >= farSide.fromLng ? lng + 180 : lng, lat };
    },
    project: ([lng, lat]: [number, number]) => ({
      x: SIZE_PX / 2 + (lng - camera.lng) * 2 ** camera.zoom,
      y: SIZE_PX / 2 - (lat - camera.lat) * 2 ** camera.zoom,
    }),
    once: (_event: string, handler: () => void) => handlers.push(handler),
    stop: vi.fn(),
    easeTo: vi.fn((options: { center: [number, number]; zoom: number }) => {
      [camera.lng, camera.lat] = options.center;
      camera.zoom = options.zoom;
      moveEnd();
    }),
  };
  return map;
}

/** An area-only record place: a square of `side` degrees. */
function square(west: number, south: number, side: number): RecordPlace {
  const [east, north] = [west + side, south + side];
  const area: GeoJSON.Polygon = {
    type: 'Polygon',
    coordinates: [
      [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south],
      ],
    ],
  };
  return { point: null, area };
}

/** A record place with only a point. */
function point(lng: number, lat: number): RecordPlace {
  return { point: { type: 'Point', coordinates: [lng, lat] }, area: null };
}

function setup() {
  const map = fakeMap();
  const fitBox = vi.fn(() => {
    map.camera.zoom = 2;
    map.moveEnd();
  });
  const follow = createRecordFit({ map: map as unknown as MlMap, coveredEdges: () => NONE_COVERED, fitBox });
  return { map, fitBox, follow };
}

/** Like setup, but each fit lands on its box's south-west corner at its zoom limit. */
function setupLanding() {
  const map = fakeMap();
  const fitBox = vi.fn(([west, south]: readonly number[], maxZoom: number) => {
    [map.camera.lng, map.camera.lat, map.camera.zoom] = [west!, south!, maxZoom];
    map.moveEnd();
  });
  const follow = createRecordFit({ map: map as unknown as MlMap, coveredEdges: () => NONE_COVERED, fitBox });
  return { map, fitBox, follow };
}

describe('createRecordFit', () => {
  beforeEach(() => {
    $selectedHex.set([0, 0]);
    motion.isReduced = true;
    layerMinZoom.value = 0;
    farSide.fromLng = Infinity;
  });

  it('leaves the map alone when the whole area is in view', () => {
    const { fitBox, follow } = setup();
    follow(square(0, 0, 0.2));
    expect(fitBox).not.toHaveBeenCalled();
  });

  it('zooms out to an area that does not fit, zooming in no further', () => {
    const { fitBox, follow } = setup();
    follow(square(0, 0, 2));
    expect(fitBox).toHaveBeenCalledWith([0, 0, 2, 2], 6);
  });

  it('leaves the map alone for an area off to the side that would fit in most of the view', () => {
    const { fitBox, follow } = setup();
    follow(square(0.2, 0.2, 1));
    expect(fitBox).not.toHaveBeenCalled();
  });

  it('leaves the map alone for an area too vast to be worth zooming out to', () => {
    const { fitBox, follow } = setup();
    follow(square(0, 0, 4));
    expect(fitBox).not.toHaveBeenCalled();
  });

  it('fits every polygon of a multipolygon', () => {
    const { fitBox, follow } = setup();
    const parts = [square(0, 0, 0.5), square(1.5, 1.5, 0.5)].map(
      (place) => (place.area as GeoJSON.Polygon).coordinates,
    );
    follow({ point: null, area: { type: 'MultiPolygon', coordinates: parts } });
    expect(fitBox).toHaveBeenCalledWith([0, 0, 2, 2], 6);
  });

  it('goes back to the view from before when the record closes', () => {
    const { map, follow } = setup();
    follow(square(0, 0, 2));
    follow(null);
    expect(map.easeTo).toHaveBeenCalledWith(expect.objectContaining({ center: [0, 0], zoom: 6 }));
  });

  it('stays put when the viewer moved the map since', () => {
    const { map, follow } = setup();
    follow(square(0, 0, 2));
    map.camera.lng = 5;
    follow(null);
    expect(map.easeTo).not.toHaveBeenCalled();
  });

  it('stays put when another cell was picked since', () => {
    const { map, follow } = setup();
    follow(square(0, 0, 2));
    $selectedHex.set([1, 1]);
    follow(null);
    expect(map.easeTo).not.toHaveBeenCalled();
  });

  it('flies straight from one large area to the next, then back to the view from before the first', () => {
    const { map, fitBox, follow } = setup();
    follow(square(0, 0, 2));
    follow(square(-2, -2, 2));
    expect(map.easeTo).not.toHaveBeenCalled();
    expect(fitBox).toHaveBeenLastCalledWith([-2, -2, 0, 0], 6);
    follow(null);
    expect(map.easeTo).toHaveBeenCalledWith(expect.objectContaining({ center: [0, 0], zoom: 6 }));
  });

  it('goes back before a record whose area is small at the view from before', () => {
    const { map, fitBox, follow } = setup();
    follow(square(0, 0, 2));
    follow(square(0.2, 0.2, 1));
    expect(map.easeTo).toHaveBeenCalledWith(expect.objectContaining({ center: [0, 0], zoom: 6 }));
    expect(fitBox).toHaveBeenCalledOnce();
  });

  it('glides back unless motion is reduced', () => {
    motion.isReduced = false;
    const { map, follow } = setup();
    follow(square(0, 0, 2));
    follow(null);
    expect(map.easeTo).toHaveBeenCalledWith(expect.objectContaining({ duration: expect.any(Number) }));
    expect(map.easeTo.mock.calls[0]![0]).not.toMatchObject({ duration: 0 });
  });

  it('leaves the map alone for an area with no ring', () => {
    const { fitBox, follow } = setup();
    follow({ point: null, area: { type: 'Polygon', coordinates: [] } });
    expect(fitBox).not.toHaveBeenCalled();
  });

  it('ignores the end of a fit it has since gone back from', () => {
    const map = fakeMap();
    // This fit's move is still under way when the next record opens.
    const fitBox = vi.fn();
    const follow = createRecordFit({ map: map as unknown as MlMap, coveredEdges: () => NONE_COVERED, fitBox });
    follow(square(0, 0, 2));
    follow(square(-2, -2, 2));
    expect(map.stop).toHaveBeenCalledOnce();
    expect(fitBox).toHaveBeenCalledTimes(2);
    // The second fit's view is taken when its own move ends, not the first's.
    map.camera.lng = 9;
    map.moveEnd();
    follow(null);
    expect(map.easeTo).toHaveBeenLastCalledWith(expect.objectContaining({ center: [0, 0] }));
  });

  it('leaves the map alone for a record point in view', () => {
    const { fitBox, follow } = setup();
    follow(point(0.1, 0.1));
    expect(fitBox).not.toHaveBeenCalled();
  });

  it('goes to a record point off the map, keeping the zoom', () => {
    const { fitBox, follow } = setup();
    follow(point(40, 10));
    expect(fitBox).toHaveBeenCalledWith([40, 10, 40, 10], 6);
  });

  it('goes to a record point on the far side of the globe, though it projects on screen', () => {
    farSide.fromLng = 0.1;
    const { fitBox, follow } = setup();
    follow(point(0.2, 0.1));
    expect(fitBox).toHaveBeenCalledWith([0.2, 0.1, 0.2, 0.1], 6);
  });

  it('leaves a record point in view alone, however far out, as its dot shows at every zoom', () => {
    layerMinZoom.value = 7;
    const { fitBox, follow } = setup();
    follow(point(0.1, 0.1));
    expect(fitBox).not.toHaveBeenCalled();
  });

  it('goes to a record point off the map whose area is too vast to fit', () => {
    const { fitBox, follow } = setup();
    follow({ ...point(40, 10), area: square(38, 8, 4).area });
    expect(fitBox).toHaveBeenCalledWith([40, 10, 40, 10], 6);
  });

  it('zooms in, a little past, to an area too far out to show', () => {
    layerMinZoom.value = 7;
    const { fitBox, follow } = setup();
    follow(square(0, 0, 0.25));
    expect(fitBox).toHaveBeenCalledWith([0, 0, 0.25, 0.25], 7.5);
  });

  it('goes to a small area whose middle is off the map', () => {
    const { fitBox, follow } = setup();
    follow(square(40, 10, 0.2));
    expect(fitBox).toHaveBeenCalledWith([40, 10, 40.2, 10.2], 6);
  });

  it('goes back to the view from before once a record it went to closes', () => {
    const { map, follow } = setup();
    follow(point(40, 10));
    follow(null);
    expect(map.easeTo).toHaveBeenCalledWith(expect.objectContaining({ center: [0, 0], zoom: 6 }));
  });

  it('flies straight from one record it went to on to the next, then back to the view from before', () => {
    const { map, fitBox, follow } = setupLanding();
    follow(point(40, 10));
    follow(point(-40, -10));
    expect(map.easeTo).not.toHaveBeenCalled();
    expect(fitBox).toHaveBeenLastCalledWith([-40, -10, -40, -10], 6);
    follow(null);
    expect(map.easeTo).toHaveBeenCalledWith(expect.objectContaining({ center: [0, 0], zoom: 6 }));
  });

  it('stays put for a next record already in view, still going back on close', () => {
    const { map, fitBox, follow } = setupLanding();
    follow(point(40, 10));
    follow(point(40.1, 10.1));
    expect(fitBox).toHaveBeenCalledOnce();
    expect(map.easeTo).not.toHaveBeenCalled();
    follow(null);
    expect(map.easeTo).toHaveBeenCalledWith(expect.objectContaining({ center: [0, 0], zoom: 6 }));
  });
});
