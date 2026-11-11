/** The occurrence hex grid: level from zoom, tiles for a view, GBIF tiles decoded to hexes. */
import type Point from '@mapbox/point-geometry';
import { fromVectorTileJs } from '@maplibre/vt-pbf';
import {
  adhocLevel,
  clipRingLat,
  decodeHexes,
  fillZoom,
  homeOffset,
  gridLevel,
  mergeHexes,
  ringAround,
  shiftTiles,
  tileAt,
  tileDistance,
  tilePoints,
  tilesFor,
  zoomDrop,
  zoomPastLevel,
  type LngLat,
} from '~/lib/map/occGrid';
import { TILE_EXTENT, hexAt, mvt, type Px } from './helpers/tiles';

describe('adhocLevel', () => {
  it('drops levels where adhoc geohash cells are wider than hexes, keeps the rest', () => {
    expect([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map(adhocLevel)).toEqual([
      2, 2, 4, 5, 5, 7, 7, 7, 10, 10, 12, 12, 12,
    ]);
  });
});

describe('gridLevel', () => {
  // A 1024 × 768 view: the globe fills it from an equator-equivalent zoom of about 3.
  const WIDTH = 1024;
  const HEIGHT = 768;
  const level = (zoom: number, lat: number) => gridLevel(zoom, lat, WIDTH, HEIGHT);

  it('fills a 1024 × 768 view from about zoom 3', () => {
    expect(fillZoom(WIDTH, HEIGHT)).toBeCloseTo(2.97, 2);
    expect(zoomDrop(0)).toBe(0);
    expect(zoomDrop(60)).toBeCloseTo(1);
  });

  it('follows the zoom, whole levels, 0 to 14', () => {
    expect(level(1.7, 0)).toBe(1);
    expect(level(6, 0)).toBe(6);
    expect(level(-1, 0)).toBe(0);
    expect(level(19, 0)).toBe(14);
  });

  it('keeps the whole globe’s grid wherever it is centred', () => {
    // MapLibre lowers the zoom by zoomDrop towards the poles to keep the globe's size.
    for (const lat of [0, 30, 60, 80, -75]) expect(level(1.5 - zoomDrop(lat), lat)).toBe(1);
  });

  it('already has coarser polar cells by the time the globe fills the view', () => {
    // Equator-equivalent zoom 3.1, just past filling: the streaky view straight down on the South Pole.
    expect([0, 60, 80, -89.8].map((lat) => level(3.1 - zoomDrop(lat), lat))).toEqual([3, 2, 2, 2]);
  });

  it('never makes cells coarser while zooming in', () => {
    for (const lat of [0, 55, 61, 70, 76, 82, 85, -89.8]) {
      let previous = 0;
      for (let equatorZoom = 0; equatorZoom < 11.9; equatorZoom += 0.01) {
        const current = level(equatorZoom - zoomDrop(lat), lat);
        expect(current).toBeGreaterThanOrEqual(previous);
        previous = current;
      }
    }
  });

  it('changes at most one level while panning round a pole just past filling the view', () => {
    // A seal's range round Antarctica at equator-equivalent zoom 4.1: the grid only moves at the 75.5° band.
    const levels = [-60, -70, -76, -81.2, -83, -89].map((lat) => level(4.1 - zoomDrop(lat), lat));
    expect(levels).toEqual([3, 3, 2, 2, 2, 2]);
  });

  it('coarsens the grid in whole steps in polar bands once zoomed in past that', () => {
    // The same close-up globe (equator-equivalent zoom 6.5) centred further north.
    const at = (lat: number) => level(6.5 - zoomDrop(lat), lat);
    expect([0, 59, 61, 75, 76, 82, 84].map(at)).toEqual([6, 6, 5, 5, 4, 4, 3]);
    expect(at(-80)).toBe(4);
  });

  it('keeps the same grid while panning anywhere below 60°', () => {
    // Panning the close-up globe over Spain and beyond: MapLibre's zoom moves, the grid does not.
    for (const zoom of [5, 5.5, 6.9]) {
      const levels = [0, 20, 34.36, 40, 44, 55, -45].map((lat) => level(zoom - zoomDrop(lat), lat));
      expect(new Set(levels).size).toBe(1);
    }
  });

  it('is not thrown a level by a zoom that ends a hair short', () => {
    // The + button's animation from 3 lands on 3.9999999999999996.
    expect(level(3.9999999999999996, 41.75)).toBe(level(4, 41.75));
    expect(level(3.9999999999999996, 0)).toBe(4);
  });

  it('uses the zoom as is once the map is flat', () => {
    expect(level(12.5, 70)).toBe(12);
  });
});

describe('zoomPastLevel', () => {
  const MAX_ZOOM = 22;

  it('finds the zoom where the grid turns finer, at or just past the switch', () => {
    const atLondon = (zoom: number) => gridLevel(zoom, 51.5, 1024, 768);
    const switchZoom = zoomPastLevel(atLondon, 6, MAX_ZOOM);
    expect(atLondon(switchZoom)).toBe(7);
    expect(atLondon(switchZoom - 0.01)).toBe(6);
  });

  it('is Infinity when the grid never gets finer', () => {
    expect(zoomPastLevel(() => 14, 14, MAX_ZOOM)).toBe(Infinity);
  });
});

describe('tileDistance', () => {
  it('counts diagonal steps as one, wrapping at the antimeridian', () => {
    expect(tileDistance({ x: 3, y: 3 }, { x: 3, y: 3 }, 3)).toBe(0);
    expect(tileDistance({ x: 3, y: 3 }, { x: 5, y: 4 }, 3)).toBe(2);
    expect(tileDistance({ x: 0, y: 2 }, { x: 7, y: 2 }, 3)).toBe(1);
  });
});

describe('tilesFor', () => {
  it('finds the tile under a point', () => {
    expect(tileAt([0.1, 0.1], 1)).toEqual({ x: 1, y: 0 });
    expect(tileAt([-0.1, -0.1], 1)).toEqual({ x: 0, y: 1 });
    expect(tileAt([10, 89], 3).y).toBe(0);
  });

  it('lists no tiles for no points', () => {
    expect(tilesFor([], 2)).toEqual([]);
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

describe('ringAround and shiftTiles', () => {
  it('rings a view’s tiles with their neighbours, wrapping at the antimeridian and stopping at the poles', () => {
    // Level 2: 4 × 4 tiles. A view of two tiles on the top row at the antimeridian.
    const ring = ringAround(
      [
        { x: 3, y: 0 },
        { x: 0, y: 0 },
      ],
      2,
    );
    expect(ring).toHaveLength(6);
    expect(ring).toContainEqual({ x: 2, y: 0 });
    expect(ring).toContainEqual({ x: 1, y: 1 });
    expect(ring.every((tile) => tile.y >= 0)).toBe(true);
    expect(ring).not.toContainEqual({ x: 3, y: 0 });
  });

  it('moves a view’s tiles by a pan, wrapping x and dropping rows off the map', () => {
    expect(
      shiftTiles(
        [
          { x: 3, y: 1 },
          { x: 3, y: 2 },
        ],
        1,
        -2,
        2,
      ),
    ).toEqual([{ x: 0, y: 0 }]);
  });
});

describe('tilePoints', () => {
  it('spans the tile from corner to corner, clipped short of the pole', () => {
    const points = tilePoints({ x: 1, y: 0 }, 2);
    expect(points).toHaveLength(9);
    expect(points[0]).toEqual([-90, 85]);
    expect(points[8]![0]).toBe(0);
    expect(points[8]![1]).toBeCloseTo(66.513, 3);
    expect(tileAt(points[4]!, 2)).toEqual({ x: 1, y: 0 });
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
    // An open ring is clipped the same way.
    expect(clipRingLat(ring.slice(0, -1), -85, 85)).toEqual(out);
    expect(out[0]).toEqual(out.at(-1));
    expect(Math.max(...out.map((point) => point[1]))).toBe(85);
    expect(
      clipRingLat(
        ring.map(([lng, lat]) => [lng, lat + 10] as LngLat),
        -85,
        85,
      ),
    ).toEqual([]);
  });
});

describe('decodeHexes', () => {
  it('turns tile hexes into lng/lat cells with the same id from either tile', async () => {
    // A hex across the edge between z1 tiles (0, 1) and (1, 1): GBIF puts it in both.
    // Its centre (x 0 of the right tile) is in the right tile; the left tile's padded copy over-counts.
    const left = await decodeHexes(mvt([{ ring: hexAt(4096, 1000), total: 30 }]), { x: 0, y: 1 }, 1);
    const right = await decodeHexes(mvt([{ ring: hexAt(0, 1000), total: 14 }]), { x: 1, y: 1 }, 1);
    expect(left).toHaveLength(1);
    expect(left[0]!.properties.id).toBe(right[0]!.properties.id);
    expect(left[0]!.geometry.coordinates[0]).toHaveLength(7);
    const lngs = left[0]!.geometry.coordinates[0]!.map((point) => point[0]!);
    expect(Math.min(...lngs)).toBeLessThan(0);
    expect(Math.max(...lngs)).toBeGreaterThan(0);
    expect(left[0]!.properties.home).toBe(false);
    expect(right[0]!.properties.home).toBe(true);
    // The home copy wins over a higher count, in either order; alone, the padded copy stands in.
    expect([...mergeHexes([left, right]).values()].map((hex) => hex.properties.total)).toEqual([7]);
    expect([...mergeHexes([right, left]).values()].map((hex) => hex.properties.total)).toEqual([7]);
    expect([...mergeHexes([left]).values()].map((hex) => hex.properties.total)).toEqual([15]);
  });

  it('halves GBIF hex totals, which count each record twice', async () => {
    const [hex] = await decodeHexes(mvt([{ ring: hexAt(2048, 2048), total: 500 }]), { x: 0, y: 0 }, 0);
    expect(hex!.properties.total).toBe(250);
  });

  it('clips cells off the poles', async () => {
    // A hex straddling the top edge of the top row (85.05°).
    const [hex] = await decodeHexes(mvt([{ ring: hexAt(2048, 0), total: 3 }]), { x: 0, y: 0 }, 0);
    expect(Math.max(...hex!.geometry.coordinates[0]!.map((point) => point[1]!))).toBe(85);
  });

  it('skips points and empty polygons, and takes the first ring of a multipolygon', async () => {
    const feature = (type: 1 | 3, rings: Px[][], total: unknown = 4) => ({
      id: 1,
      type,
      extent: TILE_EXTENT,
      properties: { total } as Record<string, number>,
      loadGeometry: () => rings.map((ring) => ring.map(([pointX, pointY]) => ({ x: pointX, y: pointY }) as Point)),
    });
    const closed = (ring: Px[]) => [...ring, ring[0]!];
    const features = [
      feature(1, [[[100, 100]]]),
      feature(3, []),
      // Two outer rings: a MultiPolygon. Its ring is left open, and the total is not a number.
      feature(3, [hexAt(1000, 1000), closed(hexAt(3000, 3000))], 'n/a'),
    ];
    const bytes = fromVectorTileJs({
      layers: {
        occurrence: {
          version: 2,
          name: 'occurrence',
          extent: TILE_EXTENT,
          length: 3,
          feature: (index) => features[index]!,
        },
      },
    });
    const hexes = await decodeHexes(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      { x: 0, y: 0 },
      0,
    );
    expect(hexes).toHaveLength(1);
    expect(hexes[0]!.properties).toMatchObject({ total: 0, home: true });
  });

  it('places a hex by its centre, closed ring or not', () => {
    const ring = hexAt(5000, 100).map(([pointX, pointY]) => ({ x: pointX, y: pointY }));
    expect(homeOffset(ring, TILE_EXTENT)).toEqual([1, 0]);
    expect(homeOffset([...ring, ring[0]!], TILE_EXTENT)).toEqual([1, 0]);
  });

  it('drops a cell wholly past the latitude limit', async () => {
    // Above the top of the tile: past 85.05°.
    expect(await decodeHexes(mvt([{ ring: hexAt(2048, -400, 100), total: 3 }]), { x: 0, y: 0 }, 0)).toEqual([]);
  });

  it('keeps the higher count of two copies from tiles of the same standing', () => {
    const hex = (total: number) => ({
      type: 'Feature' as const,
      properties: { id: 'a', total, home: false },
      geometry: { type: 'Polygon' as const, coordinates: [] },
    });
    expect(mergeHexes([[hex(5)], [hex(3)]]).get('a')!.properties.total).toBe(5);
  });

  it('is empty for an empty tile', async () => {
    expect(await decodeHexes(new ArrayBuffer(0), { x: 0, y: 0 }, 0)).toEqual([]);
  });
});
