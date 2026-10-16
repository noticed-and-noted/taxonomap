/**
 * The occurrence hex grid: GBIF density tiles at one grid level we choose,
 * decoded to plain GeoJSON hexes for the map to draw.
 *
 * We pick the tiles rather than MapLibre so the grid follows the view the
 * way we want (see gridLevel): zooming shows finer or coarser cells; panning
 * the whole globe keeps the same ones; and zoomed in past the globe filling
 * the view, cells get coarser towards the poles, where Mercator cells would be tiny.
 */
import type { PbfReader } from 'pbf';
import type { VectorTile } from '@mapbox/vector-tile';

/** Hexes across each GBIF tile. */
export const HEX_PER_TILE = 28;
/** Finest grid level; GBIF serves density tiles to here. */
export const MAX_LEVEL = 14;
/** Hexes are clipped this far from the poles: MapLibre's globe stretches polygon edges on the Mercator edge (85.05°) to the pole. */
const MAX_LAT = 85;

export type LngLat = [number, number];
export interface TileId {
  x: number;
  y: number;
}

export interface HexProps {
  /** Stable for the cell at its grid level, whichever tile it came from. */
  id: string;
  total: number;
  /** The cell's centre is in the tile it came from: that tile's count is the one to trust (see mergeHexes). */
  home: boolean;
}
export type Hex = GeoJSON.Feature<GeoJSON.Polygon, HexProps>;

/** MapLibre's own latitude limit for its globe zoom drop. */
const DROP_LAT_LIMIT = 85.051129;
/** From this zoom MapLibre's globe is flat (its projection flattens over 11–12) and panning no longer changes the zoom. */
const FLAT_FROM = 12;

/** How far MapLibre's globe lowers the zoom at this latitude, keeping the globe's size as you pan: log2(1/cos lat). */
export function zoomDrop(lat: number): number {
  return Math.log2(1 / Math.cos((Math.min(Math.abs(lat), DROP_LAT_LIMIT) * Math.PI) / 180));
}

/** The equator-equivalent zoom at which the globe fills a w × h px view: its radius (512 · 2^z / 2π) reaches the half-diagonal. */
export function fillZoom(w: number, h: number): number {
  return Math.log2((Math.PI * Math.hypot(w, h)) / 512);
}

/**
 * How many zoom levels past filling the view polar cells switch to coarser
 * ones (each level doubles the globe's size).
 */
const POLAR_COARSEN_FROM = 1;

/**
 * The grid level for a view (w × h px), from MapLibre's zoom and the
 * latitude it is centred on.
 *
 * The base is the zoom as if centred on the equator (MapLibre's zoom plus its
 * drop): MapLibre keeps that constant as you pan the globe, so panning keeps
 * the same grid. Zoomed in POLAR_COARSEN_FROM levels past the globe filling
 * the view, the grid is coarser by whole levels in polar bands, where Mercator
 * cells would be tiny: one level from 60°, two from 75.5°, three from 82.8°
 * (where MapLibre's drop reaches each whole level). Below 60° nothing changes.
 *
 * Once the map is flat (zoom 12+) panning leaves MapLibre's zoom alone and
 * Mercator cells keep their size on screen, so the zoom is used as is.
 */
export function gridLevel(zoom: number, lat: number, w: number, h: number): number {
  // Zoom animations can end a hair short (3.9999999999999996 for 4): don't let that drop a level.
  const level = (z: number) => Math.min(MAX_LEVEL, Math.max(0, Math.floor(z + 1e-9)));
  if (zoom >= FLAT_FROM) return level(zoom);
  const drop = zoomDrop(lat);
  const equatorZoom = zoom + drop;
  const close = equatorZoom >= fillZoom(w, h) + POLAR_COARSEN_FROM;
  return level(equatorZoom - (close ? Math.floor(drop + 1e-9) : 0));
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

/**
 * The tiles bordering a set (sides and corners), not in it: prefetched so a
 * short pan lands on loaded cells. x wraps at the antimeridian; rows stop at the poles.
 */
export function ringAround(tiles: TileId[], level: number): TileId[] {
  const n = 2 ** level;
  const has = new Set(tiles.map((t) => `${t.x}/${t.y}`));
  const ring = new Map<string, TileId>();
  for (const t of tiles) {
    for (let dy = -1; dy <= 1; dy++) {
      const y = t.y + dy;
      if (y < 0 || y >= n) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const x = (((t.x + dx) % n) + n) % n;
        const k = `${x}/${y}`;
        if (!has.has(k)) ring.set(k, { x, y });
      }
    }
  }
  return [...ring.values()];
}

/** The same tiles moved by whole tiles (x wrapping, rows kept on the map): where a view's tiles will be after a pan. */
export function shiftTiles(tiles: TileId[], dx: number, dy: number, level: number): TileId[] {
  const n = 2 ** level;
  const out = new Map<string, TileId>();
  for (const t of tiles) {
    const y = t.y + dy;
    if (y < 0 || y >= n) continue;
    const x = (((t.x + dx) % n) + n) % n;
    out.set(`${x}/${y}`, { x, y });
  }
  return [...out.values()];
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

/**
 * Where a hex's centre falls relative to its tile, in whole tiles: [0, 0] when
 * the centre is in the tile itself. `ring` is in tile units (0…extent).
 */
export function homeOffset(ring: readonly { x: number; y: number }[], extent: number): [number, number] {
  const pts =
    ring.length > 1 && ring[0]!.x === ring.at(-1)!.x && ring[0]!.y === ring.at(-1)!.y ? ring.slice(0, -1) : ring;
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  return [Math.floor(cx / extent), Math.floor(cy / extent)];
}

/**
 * Records in a GBIF hex bin from its tile `total`. GBIF's hex binning counts
 * every record twice: a tile's hex totals sum to exactly twice its point or
 * square totals, and a hex's total is twice an occurrence search over the same
 * polygon. Square and point tiles are right.
 */
export function hexRecords(total: unknown): number {
  return Math.round((Number(total) || 0) / 2);
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
      const [dx, dy] = homeOffset(f.loadGeometry()[0] ?? [], layer.extent);
      out.push({
        type: 'Feature',
        properties: { id: cellId(whole, level), total: hexRecords(f.properties['total']), home: dx === 0 && dy === 0 },
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
 * comes in each tile it touches (GBIF pads tiles), but only the tile holding
 * its centre counts it right: a copy in a neighbour's padding can be off
 * several-fold. Keep that home copy; until its tile loads, the higher count.
 */
export function mergeHexes(tiles: Iterable<Hex[]>): Map<string, Hex> {
  const cells = new Map<string, Hex>();
  for (const hexes of tiles) {
    for (const h of hexes) {
      const had = cells.get(h.properties.id);
      const better =
        !had ||
        (h.properties.home && !had.properties.home) ||
        (h.properties.home === had.properties.home && h.properties.total > had.properties.total);
      if (better) cells.set(h.properties.id, h);
    }
  }
  return cells;
}
