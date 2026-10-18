/** GBIF-like vector tiles for the hex grid tests. */
import type Point from '@mapbox/point-geometry';
import { fromVectorTileJs } from '@maplibre/vt-pbf';

export const E = 4096;
export type Px = [number, number];

/** A GBIF-like density tile with one hex ring per entry, in tile pixels. */
export function mvt(hexes: { ring: Px[]; total: number }[]): ArrayBuffer {
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
export const hexAt = (cx: number, cy: number, r = 100): Px[] =>
  [0, 60, 120, 180, 240, 300].map((a) => [
    Math.round(cx + r * Math.cos((a * Math.PI) / 180)),
    Math.round(cy + r * Math.sin((a * Math.PI) / 180)),
  ]);
