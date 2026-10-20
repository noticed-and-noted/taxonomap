/** GBIF-like vector tiles for the hex grid tests. */
import type Point from '@mapbox/point-geometry';
import { fromVectorTileJs } from '@maplibre/vt-pbf';

export const TILE_EXTENT = 4096;
export type Px = [number, number];

/** A GBIF-like density tile with one hex ring per entry, in tile pixels. */
export function mvt(hexes: { ring: Px[]; total: number }[]): ArrayBuffer {
  const features = hexes.map(({ ring, total }, index) => ({
    type: 3 as const,
    id: index + 1,
    extent: TILE_EXTENT,
    properties: { total },
    loadGeometry: () => [[...ring, ring[0]!].map(([pointX, pointY]) => ({ x: pointX, y: pointY }) as Point)],
  }));
  const bytes = fromVectorTileJs({
    layers: {
      occurrence: {
        version: 2,
        name: 'occurrence',
        extent: TILE_EXTENT,
        length: features.length,
        feature: (index) => features[index]!,
      },
    },
  });
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** A flat-topped hex around a tile-pixel centre. */
export const hexAt = (centreX: number, centreY: number, radius = 100): Px[] =>
  [0, 60, 120, 180, 240, 300].map((angle) => [
    Math.round(centreX + radius * Math.cos((angle * Math.PI) / 180)),
    Math.round(centreY + radius * Math.sin((angle * Math.PI) / 180)),
  ]);
