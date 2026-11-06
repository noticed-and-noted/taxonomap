/** The cubes' H3 grid on the map: resolution by grid level, colour levels, view bounds and hex features. */
import { latLngToCell } from 'h3-js';
import type { Map as MlMap } from 'maplibre-gl';
import { cellToHex, colourLevel, estimateBounds, resolutionForLevel, viewBounds } from '~/lib/cubes/grid';

/** A map whose canvas corners unproject to a box `width` × `height` degrees around the centre. */
function boxMap(options: { zoom: number; width?: number; height?: number; canvas?: [number, number] }) {
  const [canvasWidth, canvasHeight] = options.canvas ?? [1000, 500];
  const [spanLng, spanLat] = [options.width ?? 20, options.height ?? 10];
  return {
    getZoom: () => options.zoom,
    getCanvas: () => ({ clientWidth: canvasWidth, clientHeight: canvasHeight }),
    unproject: ([pixelX, pixelY]: [number, number]) => ({
      lng: 10 + (pixelX / canvasWidth - 0.5) * spanLng,
      lat: 50 - (pixelY / canvasHeight - 0.5) * spanLat,
    }),
  } as unknown as MlMap;
}

describe('resolutionForLevel and colourLevel', () => {
  it('picks the coarsest resolution whose cells are no bigger than the level’s', () => {
    expect([0, 2, 3, 4, 5, 6, 12].map(resolutionForLevel)).toEqual([2, 2, 3, 3, 4, 5, 5]);
  });

  it('colours each resolution as the level its cells match', () => {
    expect([2, 3, 4, 5].map((resolution) => colourLevel(resolution as 2 | 3 | 4 | 5))).toEqual([2, 4, 5, 6]);
  });
});

describe('viewBounds', () => {
  it('is the box the canvas shows', () => {
    expect(viewBounds(boxMap({ zoom: 5 }))).toEqual([0, 45, 20, 55]);
  });

  it('keeps latitudes inside the poles’ cut-off', () => {
    const bounds = viewBounds(boxMap({ zoom: 4, height: 100 }))!;
    expect([bounds[1], bounds[3]]).toEqual([0, 85]);
  });

  it('is the whole world zoomed out, on an unsized canvas, or when the view spans half the globe', () => {
    expect(viewBounds(boxMap({ zoom: 2 }))).toBeNull();
    expect(viewBounds(boxMap({ zoom: 5, canvas: [0, 0] }))).toBeNull();
    expect(viewBounds(boxMap({ zoom: 3, width: 200 }))).toBeNull();
  });
});

describe('cellToHex', () => {
  it('makes a closed hex feature keyed by its cell', () => {
    const cell = latLngToCell(51.5, -0.1, 4);
    const hex = cellToHex(cell, 12);
    expect(hex.properties).toEqual({ id: cell, total: 12, home: true, h3: cell });
    const ring = hex.geometry.coordinates[0]!;
    expect(ring.at(0)).toEqual(ring.at(-1));
    expect(ring.every(([lng, lat]) => Math.abs(lng! + 0.1) < 1 && Math.abs(lat! - 51.5) < 1)).toBe(true);
  });

  it('unwraps a cell over the antimeridian past 180°, as GBIF’s cells are', () => {
    const lngs = cellToHex(latLngToCell(0, 179.9, 2), 1).geometry.coordinates[0]!.map(([lng]) => lng!);
    expect(Math.min(...lngs)).toBeGreaterThan(0);
    expect(Math.max(...lngs)).toBeGreaterThan(180);
  });

  it('clips polar cells at 85°', () => {
    const lats = cellToHex(latLngToCell(89.9, 0, 2), 1).geometry.coordinates[0]!.map(([, lat]) => lat!);
    expect(Math.max(...lats)).toBe(85);
  });
});

describe('estimateBounds', () => {
  it('is the whole world zoomed out, or wider than half the globe', () => {
    expect(estimateBounds({ lng: 0, lat: 0, zoom: 2 }, { width: 1280, height: 800 })).toBeNull();
    expect(estimateBounds({ lng: 0, lat: 0, zoom: 2.6 }, { width: 4000, height: 800 })).toBeNull();
  });

  it('pads the view around its centre, a little wider than the canvas shows', () => {
    const [west, south, east, north] = estimateBounds({ lng: 10, lat: 50, zoom: 4 }, { width: 1280, height: 800 })!;
    // 1,280 px at zoom 4 is about 56° of longitude; padded by a quarter, about 70°.
    expect(east - west).toBeCloseTo(70.3, 0);
    expect((west + east) / 2).toBeCloseTo(10);
    expect(south).toBeLessThan(50);
    expect(north).toBeGreaterThan(50);
    // Mercator stretches the north, so the north edge is nearer the centre than the south.
    expect(north - 50).toBeLessThan(50 - south);
  });

  it('stops short of the poles', () => {
    const [, south, , north] = estimateBounds({ lng: 0, lat: 84, zoom: 3 }, { width: 400, height: 3000 })!;
    expect(north).toBeLessThanOrEqual(85);
    expect(south).toBeGreaterThan(-85);
  });
});
