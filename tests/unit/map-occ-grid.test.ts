/** The occurrence hex grid: level from zoom, tiles for a view, GBIF tiles decoded to hexes. */
import type Point from '@mapbox/point-geometry';
import { fromVectorTileJs } from '@maplibre/vt-pbf';
import { clipRingLat, decodeHexes, gridLevel, mergeHexes, tileAt, tilesFor, type LngLat } from '~/lib/map/occGrid';

const E = 4096;
type Px = [number, number];

/** A GBIF-like density tile with one hex ring per entry, in tile pixels. */
function mvt(hexes: { ring: Px[]; total: number }[]): ArrayBuffer {
  const features = hexes.map(({ ring, total }, i) => ({
    type: 3 as const,
    id: i + 1,
    extent: E,
    properties: { total },
    loadGeometry: () => [[...ring, ring[0]!].map(([x, y]) => ({ x, y }) as Point)],
  }));
  const bytes = fromVectorTileJs({
    layers: {
      occurrence: { version: 2, name: 'occurrence', extent: E, length: features.length, feature: (i) => features[i]! },
    },
  });
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** A flat-topped hex around a tile-pixel centre. */
const hexAt = (cx: number, cy: number, r = 100): Px[] =>
  [0, 60, 120, 180, 240, 300].map((a) => [
    Math.round(cx + r * Math.cos((a * Math.PI) / 180)),
    Math.round(cy + r * Math.sin((a * Math.PI) / 180)),
  ]);

describe('gridLevel', () => {
  it('follows the zoom, whole levels, 0 to 14', () => {
    expect(gridLevel(2.7, 0)).toBe(2);
    expect(gridLevel(3, 0)).toBe(3);
    expect(gridLevel(-1, 0)).toBe(0);
    expect(gridLevel(19, 0)).toBe(14);
  });

  it('gives the same level for the same globe size wherever the globe is centred', () => {
    // MapLibre lowers the zoom by log2(1/cos lat) towards the poles to keep the globe's size.
    const drop = (lat: number) => Math.log2(1 / Math.cos((lat * Math.PI) / 180));
    for (const lat of [0, 30, 60, 80, -75]) expect(gridLevel(2.5 - drop(lat), lat)).toBe(2);
  });

  it('uses the zoom as is once the map is flat', () => {
    expect(gridLevel(12.5, 70)).toBe(12);
  });
});

describe('tilesFor', () => {
  it('finds the tile under a point', () => {
    expect(tileAt([0.1, 0.1], 1)).toEqual({ x: 1, y: 0 });
    expect(tileAt([-0.1, -0.1], 1)).toEqual({ x: 0, y: 1 });
    expect(tileAt([10, 89], 3).y).toBe(0);
  });

  it('lists each tile under the view once, centre tile first, wrapping at the antimeridian', () => {
    const view: LngLat[] = [
      [179.9, 0.1],
      [-179.9, 0.1],
      [179.8, 0.2],
      [100, -10],
    ];
    expect(tilesFor(view, 2)).toEqual([
      { x: 3, y: 1 },
      { x: 0, y: 1 },
      { x: 3, y: 2 },
    ]);
  });
});

describe('clipRingLat', () => {
  it('cuts a ring at the latitude limits and keeps it closed', () => {
    const ring: LngLat[] = [
      [0, 80],
      [10, 80],
      [10, 89],
      [0, 89],
      [0, 80],
    ];
    const out = clipRingLat(ring, -85, 85);
    expect(out[0]).toEqual(out.at(-1));
    expect(Math.max(...out.map((p) => p[1]))).toBe(85);
    expect(
      clipRingLat(
        ring.map(([x, y]) => [x, y + 10] as LngLat),
        -85,
        85,
      ),
    ).toEqual([]);
  });
});

describe('decodeHexes', () => {
  it('turns tile hexes into lng/lat cells with the same id from either tile', async () => {
    // A hex across the edge between z1 tiles (0, 1) and (1, 1): GBIF puts it in both.
    const left = await decodeHexes(mvt([{ ring: hexAt(4096, 1000), total: 5 }]), { x: 0, y: 1 }, 1);
    const right = await decodeHexes(mvt([{ ring: hexAt(0, 1000), total: 7 }]), { x: 1, y: 1 }, 1);
    expect(left).toHaveLength(1);
    expect(left[0]!.properties.id).toBe(right[0]!.properties.id);
    expect(left[0]!.geometry.coordinates[0]).toHaveLength(7);
    const lngs = left[0]!.geometry.coordinates[0]!.map((p) => p[0]!);
    expect(Math.min(...lngs)).toBeLessThan(0);
    expect(Math.max(...lngs)).toBeGreaterThan(0);
    // The fuller copy wins.
    expect([...mergeHexes([left, right]).values()].map((h) => h.properties.total)).toEqual([7]);
  });

  it('clips cells off the poles', async () => {
    // A hex straddling the top edge of the top row (85.05°).
    const [hex] = await decodeHexes(mvt([{ ring: hexAt(2048, 0), total: 3 }]), { x: 0, y: 0 }, 0);
    expect(Math.max(...hex!.geometry.coordinates[0]!.map((p) => p[1]!))).toBe(85);
  });

  it('is empty for an empty tile', async () => {
    expect(await decodeHexes(new ArrayBuffer(0), { x: 0, y: 0 }, 0)).toEqual([]);
  });
});
