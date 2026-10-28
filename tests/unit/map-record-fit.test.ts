import type { Map as MlMap } from 'maplibre-gl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRecordFit } from '~/lib/map/recordFit';
import { $selectedHex } from '~/stores/explorer';

const motion = vi.hoisted(() => ({ isReduced: true }));
vi.mock('~/stores/reading', () => ({ prefersReducedMotion: () => motion.isReduced }));

const SIZE_PX = 100;
const NONE_COVERED = { top: 0, right: 0, bottom: 0, left: 0 };

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
    getContainer: () => ({ clientWidth: SIZE_PX, clientHeight: SIZE_PX }),
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

function square(west: number, south: number, side: number): GeoJSON.Polygon {
  const [east, north] = [west + side, south + side];
  return {
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

describe('createRecordFit', () => {
  beforeEach(() => {
    $selectedHex.set([0, 0]);
    motion.isReduced = true;
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

  it('goes back, then fits the next record’s area from there', () => {
    const { map, fitBox, follow } = setup();
    follow(square(0, 0, 2));
    follow(square(-2, -2, 2));
    expect(map.easeTo).toHaveBeenCalledTimes(1);
    expect(fitBox).toHaveBeenLastCalledWith([-2, -2, 0, 0], 6);
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
    follow({ type: 'Polygon', coordinates: [] });
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
});
