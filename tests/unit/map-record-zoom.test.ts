/** The zooms an expanded record's area shows from. */
import type { Map as MlMap } from 'maplibre-gl';
import { sizeRecordLayers } from '~/lib/map/recordZoom';
import { RECORD_DOT_LAYER, RECORD_MIN_ZOOM } from '~/lib/map/style';

const MAX_ZOOM = 22;

/** A stand-in map that records each layer's zoom range. */
function fakeMap(hasLayers = true) {
  const ranges = new Map<string, [number, number]>();
  const map = {
    ranges,
    getLayer: (id: string) => (hasLayers ? { id } : undefined),
    getMaxZoom: () => MAX_ZOOM,
    setLayerZoomRange: (id: string, min: number, max: number) => ranges.set(id, [min, max]),
  };
  return map;
}

const asMap = (map: ReturnType<typeof fakeMap>) => map as unknown as MlMap;

describe('sizeRecordLayers', () => {
  it('does nothing before the style has the record layers', () => {
    const map = fakeMap(false);
    sizeRecordLayers(asMap(map), Infinity);
    expect(map.ranges.size).toBe(0);
  });

  it('shows the area from the record zoom, leaving the dot at every zoom', () => {
    const map = fakeMap();
    sizeRecordLayers(asMap(map), Infinity);
    expect(map.ranges.get('record-area')).toEqual([RECORD_MIN_ZOOM, MAX_ZOOM + 1]);
    expect(map.ranges.get('record-edge')).toEqual([RECORD_MIN_ZOOM, MAX_ZOOM + 1]);
    expect(map.ranges.has(RECORD_DOT_LAYER)).toBe(false);
  });

  it('shows the area sooner where the grid turns finer', () => {
    const map = fakeMap();
    sizeRecordLayers(asMap(map), 3);
    expect(map.ranges.get('record-area')).toEqual([3, MAX_ZOOM + 1]);
  });
});
