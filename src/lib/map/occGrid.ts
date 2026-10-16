/**
 * The occurrence hex grid: GBIF density tiles at one grid level we choose,
 * decoded to plain GeoJSON hexes for the map to draw.
 *
 * We pick the tiles rather than MapLibre because on the globe MapLibre picks
 * them from its zoom, which it lowers as you pan towards a pole (keeping the
 * globe the same size on screen). The hexes then changed as you panned. Here
 * the level changes only when you zoom (see gridLevel), so panning keeps the
 * same cells and zooming shows finer or coarser ones.
 */
import type { PbfReader } from 'pbf';
import type { VectorTile } from '@mapbox/vector-tile';

/** Hexes across each GBIF tile. */
export const HEX_PER_TILE = 28;
/** Finest grid level; GBIF serves density tiles to here. */
export const MAX_LEVEL = 14;
/** Hexes are clipped this far from the poles: MapLibre's globe stretches polygon edges on the Mercator edge (85.05°) to the pole. */
const MAX_LAT = 85;
/** Below this zoom MapLibre draws a round globe and lowers the zoom towards the poles (its globe projection flattens over 11–12). */
const GLOBE_UNTIL = 11;

export type LngLat = [number, number];
export interface TileId {
  x: number;
  y: number;
}

export interface HexProps {
  /** Stable for the cell at its grid level, whichever tile it came from. */
  id: string;
  total: number;
}
export type Hex = GeoJSON.Feature<GeoJSON.Polygon, HexProps>;

/**
 * The grid level for a view: its zoom as if centred on the equator, where the
 * globe is the same size. MapLibre lowers the zoom by log2(1/cos lat) as the
 * view nears a pole; adding that back gives the same grid for the same globe
 * size anywhere. Once the map is flat the zoom is the scale, so it is used as is.
 */
export function gridLevel(zoom: number, lat: number): number {
  const z =
    zoom < GLOBE_UNTIL ? zoom + Math.log2(1 / Math.cos((Math.min(Math.abs(lat), MAX_LAT) * Math.PI) / 180)) : zoom;
  return Math.min(MAX_LEVEL, Math.max(0, Math.floor(z)));
}

/** The level-`level` tile holding a point. */
export function tileAt([lng, lat]: LngLat, level: number): TileId {
  const n = 2 ** level;
  const phi = (Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI) / 180;
  const x = Math.floor(((lng + 180) / 360) * n);
  const y = Math.floor(((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * n);
  return { x: ((x % n) + n) % n, y: Math.max(0, Math.min(n - 1, y)) };
}

/**
 * The tiles covering a view, from points sampled across it (centre first),
 * nearest the centre first. Sampling closer together than a tile is wide on
 * screen means none is skipped.
 */
export function tilesFor(points: LngLat[], level: number): TileId[] {
  const n = 2 ** level;
  const seen = new Map<string, TileId>();
  for (const p of points) {
    const t = tileAt(p, level);
    seen.set(`${t.x}/${t.y}`, t);
  }
  const c = points[0] ? tileAt(points[0], level) : { x: 0, y: 0 };
  const dist = (t: TileId) => {
    const dx = Math.abs(t.x - c.x);
    return Math.hypot(Math.min(dx, n - dx), t.y - c.y);
  };
  return [...seen.values()].sort((a, b) => dist(a) - dist(b));
}

/** Clip a lng/lat ring to minLat <= lat <= maxLat (Sutherland–Hodgman); [] if nothing is left. */
export function clipRingLat(ring: LngLat[], minLat: number, maxLat: number): LngLat[] {
  const open =
    ring.length > 1 && ring[0]![0] === ring.at(-1)![0] && ring[0]![1] === ring.at(-1)![1] ? ring.slice(0, -1) : ring;
  const half = (pts: LngLat[], inside: (p: LngLat) => boolean, edge: number) => {
    const out: LngLat[] = [];
    pts.forEach((cur, i) => {
      const prev = pts[(i + pts.length - 1) % pts.length]!;
      if (inside(cur) !== inside(prev)) {
        const t = (edge - prev[1]) / (cur[1] - prev[1]);
        out.push([prev[0] + t * (cur[0] - prev[0]), edge]);
      }
      if (inside(cur)) out.push(cur);
    });
    return out;
  };
  const clipped = half(
    half(open, (p) => p[1] >= minLat, minLat),
    (p) => p[1] <= maxLat,
    maxLat,
  );
  return clipped.length >= 3 ? [...clipped, clipped[0]!] : [];
}

/** A key for a cell from its ring: the rounded centre, longitude wrapped, so copies from neighbouring tiles match. */
function cellId(ring: LngLat[], level: number): string {
  const pts = ring.slice(0, -1);
  const lng = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const lat = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const wrapped = ((((lng + 180) % 360) + 360) % 360) - 180;
  return `${level}:${wrapped.toFixed(5)},${lat.toFixed(5)}`;
}

/** The hexes in a decoded GBIF density tile, in lng/lat, clipped off the poles. */
export function hexesOf(tile: VectorTile, t: TileId, level: number): Hex[] {
  const out: Hex[] = [];
  for (const layer of Object.values(tile.layers)) {
    for (let i = 0; i < layer.length; i++) {
      const f = layer.feature(i);
      if (f.type !== 3) continue;
      const g = f.toGeoJSON(t.x, t.y, level).geometry;
      const outer =
        g.type === 'Polygon' ? g.coordinates[0] : g.type === 'MultiPolygon' ? g.coordinates[0]?.[0] : undefined;
      if (!outer) continue;
      // Cells are computed by their unclipped centre, so a polar cell keeps one id.
      const whole = outer.map((p) => [p[0], p[1]] as LngLat);
      const ring = clipRingLat(whole, -MAX_LAT, MAX_LAT);
      if (!ring.length) continue;
      out.push({
        type: 'Feature',
        properties: { id: cellId(whole, level), total: Number(f.properties['total'] ?? 0) },
        geometry: { type: 'Polygon', coordinates: [ring] },
      });
    }
  }
  return out;
}

/** Decode a GBIF density tile (MVT bytes) to hexes. */
export async function decodeHexes(data: ArrayBuffer, t: TileId, level: number): Promise<Hex[]> {
  if (!data.byteLength) return [];
  const [{ VectorTile }, { PbfReader: Reader }] = await Promise.all([import('@mapbox/vector-tile'), import('pbf')]);
  return hexesOf(new VectorTile(new Reader(data) as PbfReader), t, level);
}

/**
 * One feature per cell from several tiles' hexes. A cell near a tile edge
 * comes in both tiles (GBIF pads tiles); keep the copy with the higher count.
 */
export function mergeHexes(tiles: Iterable<Hex[]>): Map<string, Hex> {
  const cells = new Map<string, Hex>();
  for (const hexes of tiles) {
    for (const h of hexes) {
      const had = cells.get(h.properties.id);
      if (!had || h.properties.total > had.properties.total) cells.set(h.properties.id, h);
    }
  }
  return cells;
}
