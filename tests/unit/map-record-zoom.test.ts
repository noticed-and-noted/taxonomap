/** The zooms an expanded record's dot and area show from. */
import type { Map as MlMap } from 'maplibre-gl';
import type { LngLat } from '~/lib/map/occGrid';
import { sizeRecordLayers } from '~/lib/map/recordZoom';
import { RECORD_DOT_LAYER, RECORD_MIN_ZOOM, recordDotMinZoom } from '~/lib/map/style';

const ZOOM = 5;
const MAX_ZOOM = 22;

/** A stand-in map, 10 px per degree, that records each layer's zoom range. */
function fakeMap(hasLayer = true) {
  const ranges = new Map<string, [number, number]>();
  const map = {
    ranges,
    getLayer: (id: string) => (hasLayer && id === RECORD_DOT_LAYER ? {} : undefined),
    getZoom: () => ZOOM,
    getMaxZoom: () => MAX_ZOOM,
    project: ([lng]: [number, number]) => ({ x: lng * 10, y: 0 }),
    setLayerZoomRange: (id: string, min: number, max: number) => ranges.set(id, [min, max]),
  };
  return map;
}

const asMap = (map: ReturnType<typeof fakeMap>) => map as unknown as MlMap;
const RING: LngLat[] = [
  [0, 0],
  [4, 0],
  [2, 2],
];

describe('sizeRecordLayers', () => {
  it('does nothing before the style has the record layers', () => {
    const map = fakeMap(false);
    sizeRecordLayers(asMap(map), RING, Infinity);
    expect(map.ranges.size).toBe(0);
  });

  it('shows the dot once the area is wide enough, and the area from the record zoom', () => {
    const map = fakeMap();
    sizeRecordLayers(asMap(map), RING, Infinity);
    expect(map.ranges.get(RECORD_DOT_LAYER)).toEqual([recordDotMinZoom(ZOOM, 40), MAX_ZOOM + 1]);
    expect(map.ranges.get('record-area')).toEqual([RECORD_MIN_ZOOM, MAX_ZOOM + 1]);
    expect(map.ranges.get('record-edge')).toEqual([RECORD_MIN_ZOOM, MAX_ZOOM + 1]);
  });

  it('falls back to the record zoom without an area, and shows both sooner where the grid turns finer', () => {
    const map = fakeMap();
    sizeRecordLayers(asMap(map), undefined, 3);
    expect(map.ranges.get(RECORD_DOT_LAYER)).toEqual([Math.min(recordDotMinZoom(ZOOM, null), 3), MAX_ZOOM + 1]);
    expect(map.ranges.get('record-area')).toEqual([3, MAX_ZOOM + 1]);
  });
});
