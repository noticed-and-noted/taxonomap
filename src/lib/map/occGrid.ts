/**
 * The occurrence hex grid: GBIF density tiles at one grid level we choose,
 * decoded to plain GeoJSON hexes for the map to draw.
 *
 * We pick the tiles rather than MapLibre so the grid follows the view the
 * way we want (see gridLevel): zooming shows finer or coarser cells; panning
 * the whole globe keeps the same ones; and zoomed in past the globe filling
 * the view, cells get coarser towards the poles, where Mercator cells would be tiny.
 */
import type { VectorTile } from '@mapbox/vector-tile';
import type { PbfReader } from 'pbf';

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
export function fillZoom(width: number, height: number): number {
  return Math.log2((Math.PI * Math.hypot(width, height)) / 512);
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
export function gridLevel(zoom: number, lat: number, width: number, height: number): number {
  // Zoom animations can end a hair short (3.9999999999999996 for 4): don't let that drop a level.
  const level = (candidate: number) => Math.min(MAX_LEVEL, Math.max(0, Math.floor(candidate + 1e-9)));
  if (zoom >= FLAT_FROM) return level(zoom);
  const drop = zoomDrop(lat);
  const equatorZoom = zoom + drop;
  const close = equatorZoom >= fillZoom(width, height) + POLAR_COARSEN_FROM;
  return level(equatorZoom - (close ? Math.floor(drop + 1e-9) : 0));
}

/** How closely zoomPastLevel finds a switch: well under a frame of a wheel zoom. */
const SWITCH_ZOOM_PRECISION = 0.01;

/**
 * The lowest zoom, to within SWITCH_ZOOM_PRECISION above it, at which the grid is finer than `level`.
 * @param levelAt The grid level at a zoom, rising (or level) as the zoom does.
 * @returns Infinity if the grid is no finer even at `maxZoom`.
 */
export function zoomPastLevel(levelAt: (zoom: number) => number, level: number, maxZoom: number): number {
  if (levelAt(maxZoom) <= level) return Infinity;
  let below = 0;
  let above = maxZoom;
  while (above - below > SWITCH_ZOOM_PRECISION) {
    const middle = (below + above) / 2;
    if (levelAt(middle) > level) above = middle;
    else below = middle;
  }
  return above;
}

/**
 * GBIF's adhoc tiles (any refinement filter) snap records to geohash cells,
 * finer only every 2–3 zooms (measured: steps at 4, 7, 10, 12, 14). Unless a
 * hex is clearly wider than a cell (≥ ~1.4×), the two grids beat and hex
 * columns come back near-empty in stripes. Those levels use the nearest
 * coarser level that is clear.
 */
const ADHOC_LEVEL: Record<number, number> = { 3: 2, 6: 5, 8: 7, 9: 7, 11: 10, 13: 12, 14: 12 };
/** The level to use for ad hoc tiles: `level`, or the nearest coarser one whose grids do not beat. */
export const adhocLevel = (level: number): number => ADHOC_LEVEL[level] ?? level;

/** The level-`level` tile holding a point. */
export function tileAt([lng, lat]: LngLat, level: number): TileId {
  const tileCount = 2 ** level;
  const phi = (Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI) / 180;
  const tileX = Math.floor(((lng + 180) / 360) * tileCount);
  const tileY = Math.floor(((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * tileCount);
  return { x: ((tileX % tileCount) + tileCount) % tileCount, y: Math.max(0, Math.min(tileCount - 1, tileY)) };
}

/**
 * The tiles covering a view, from points sampled across it (centre first),
 * nearest the centre first. Sampling closer together than a tile is wide on
 * screen means none is skipped.
 */
export function tilesFor(points: LngLat[], level: number): TileId[] {
  const tileCount = 2 ** level;
  const seen = new Map<string, TileId>();
  for (const point of points) {
    const tile = tileAt(point, level);
    seen.set(`${tile.x}/${tile.y}`, tile);
  }
  const centre = points[0] ? tileAt(points[0], level) : { x: 0, y: 0 };
  const dist = (tile: TileId) => {
    const dx = Math.abs(tile.x - centre.x);
    return Math.hypot(Math.min(dx, tileCount - dx), tile.y - centre.y);
  };
  return [...seen.values()].sort((left, right) => dist(left) - dist(right));
}

/** Steps across a tile, as fractions of its width, for the points tilePoints samples. */
const TILE_POINT_STEPS = [0, 0.5, 1];

/** Latitude of a Mercator tile row edge (fractional rows allowed). */
function rowLatitude(row: number, tileCount: number): number {
  return (Math.atan(Math.sinh(Math.PI * (1 - (2 * row) / tileCount))) * 180) / Math.PI;
}

/**
 * A 3 × 3 grid of points over a tile (corners, edge midpoints and centre),
 * kept within the hexes' latitude clip, to test whether any of it is on screen.
 */
export function tilePoints(tile: TileId, level: number): LngLat[] {
  const tileCount = 2 ** level;
  return TILE_POINT_STEPS.flatMap((stepY) =>
    TILE_POINT_STEPS.map((stepX): LngLat => {
      const lat = rowLatitude(tile.y + stepY, tileCount);
      return [((tile.x + stepX) / tileCount) * 360 - 180, Math.max(-MAX_LAT, Math.min(MAX_LAT, lat))];
    }),
  );
}

/** `tile` moved by whole tiles: x wraps at the antimeridian; null when the row falls off the map. */
function offsetTile(tile: TileId, dx: number, dy: number, tileCount: number): TileId | null {
  const row = tile.y + dy;
  if (row < 0 || row >= tileCount) return null;
  return { x: (((tile.x + dx) % tileCount) + tileCount) % tileCount, y: row };
}

/** How many tiles apart two tiles are, a diagonal step counting as one; x wraps at the antimeridian. */
export function tileDistance(from: TileId, to: TileId, level: number): number {
  const tileCount = 2 ** level;
  const across = Math.abs(from.x - to.x);
  return Math.max(Math.min(across, tileCount - across), Math.abs(from.y - to.y));
}

/** A tile's x/y as a key, to compare sets of tiles at one level. */
export const tileCoordinateKey = (tile: TileId) => `${tile.x}/${tile.y}`;

/** The nine (dx, dy) steps to a tile and its eight neighbours. */
const NEIGHBOURHOOD = [-1, 0, 1].flatMap((dy) => [-1, 0, 1].map((dx) => [dx, dy] as const));

/**
 * The tiles bordering a set (sides and corners), not in it: prefetched so a
 * short pan lands on loaded cells. x wraps at the antimeridian; rows stop at the poles.
 */
export function ringAround(tiles: TileId[], level: number): TileId[] {
  const tileCount = 2 ** level;
  const inSet = new Set(tiles.map(tileCoordinateKey));
  const ring = new Map<string, TileId>();
  for (const tile of tiles) {
    for (const [dx, dy] of NEIGHBOURHOOD) {
      const neighbour = offsetTile(tile, dx, dy, tileCount);
      if (neighbour && !inSet.has(tileCoordinateKey(neighbour))) ring.set(tileCoordinateKey(neighbour), neighbour);
    }
  }
  return [...ring.values()];
}

/** The same tiles moved by whole tiles (x wrapping, rows kept on the map): where a view's tiles will be after a pan. */
export function shiftTiles(tiles: TileId[], dx: number, dy: number, level: number): TileId[] {
  const tileCount = 2 ** level;
  const shifted = new Map<string, TileId>();
  for (const tile of tiles) {
    const moved = offsetTile(tile, dx, dy, tileCount);
    if (moved) shifted.set(tileCoordinateKey(moved), moved);
  }
  return [...shifted.values()];
}

/** Clip a lng/lat ring to minLat <= lat <= maxLat (Sutherland–Hodgman); [] if nothing is left. */
export function clipRingLat(ring: LngLat[], minLat: number, maxLat: number): LngLat[] {
  const open =
    ring.length > 1 && ring[0]![0] === ring.at(-1)![0] && ring[0]![1] === ring.at(-1)![1] ? ring.slice(0, -1) : ring;
  const half = (points: LngLat[], inside: (point: LngLat) => boolean, edge: number) => {
    const out: LngLat[] = [];
    points.forEach((vertex, index) => {
      const prev = points[(index + points.length - 1) % points.length]!;
      if (inside(vertex) !== inside(prev)) {
        const ratio = (edge - prev[1]) / (vertex[1] - prev[1]);
        out.push([prev[0] + ratio * (vertex[0] - prev[0]), edge]);
      }
      if (inside(vertex)) out.push(vertex);
    });
    return out;
  };
  const clipped = half(
    half(open, (point) => point[1] >= minLat, minLat),
    (point) => point[1] <= maxLat,
    maxLat,
  );
  return clipped.length >= 3 ? [...clipped, clipped[0]!] : [];
}

/** A key for a cell from its ring: the rounded centre, longitude wrapped, so copies from neighbouring tiles match. */
function cellId(ring: LngLat[], level: number): string {
  const points = ring.slice(0, -1);
  const lng = points.reduce((sum, point) => sum + point[0], 0) / points.length;
  const lat = points.reduce((sum, point) => sum + point[1], 0) / points.length;
  const wrapped = ((((lng + 180) % 360) + 360) % 360) - 180;
  return `${level}:${wrapped.toFixed(5)},${lat.toFixed(5)}`;
}

/**
 * Where a hex's centre falls relative to its tile, in whole tiles: [0, 0] when
 * the centre is in the tile itself. `ring` is in tile units (0…extent).
 */
export function homeOffset(ring: readonly { x: number; y: number }[], extent: number): [number, number] {
  const points =
    ring.length > 1 && ring[0]!.x === ring.at(-1)!.x && ring[0]!.y === ring.at(-1)!.y ? ring.slice(0, -1) : ring;
  const centreX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const centreY = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  return [Math.floor(centreX / extent), Math.floor(centreY / extent)];
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
export function hexesOf(tile: VectorTile, tileId: TileId, level: number): Hex[] {
  const out: Hex[] = [];
  for (const layer of Object.values(tile.layers)) {
    for (let index = 0; index < layer.length; index++) {
      const feature = layer.feature(index);
      if (feature.type !== 3) continue;
      const geometry = feature.toGeoJSON(tileId.x, tileId.y, level).geometry;
      // Polygon features decode to a Polygon, or a MultiPolygon with any other number of rings (none when empty).
      const outer =
        geometry.type === 'Polygon' ? geometry.coordinates[0] : (geometry as GeoJSON.MultiPolygon).coordinates[0]?.[0];
      if (!outer) continue;
      // Cells are computed by their unclipped centre, so a polar cell keeps one id.
      const whole = outer.map((point) => [point[0], point[1]] as LngLat);
      const ring = clipRingLat(whole, -MAX_LAT, MAX_LAT);
      if (!ring.length) continue;
      const [dx, dy] = homeOffset(feature.loadGeometry()[0]!, layer.extent);
      out.push({
        type: 'Feature',
        properties: {
          id: cellId(whole, level),
          total: hexRecords(feature.properties['total']),
          home: dx === 0 && dy === 0,
        },
        geometry: { type: 'Polygon', coordinates: [ring] },
      });
    }
  }
  return out;
}

/** A cell's centre: the mean of its vertices (the ring repeats the first one at the end). */
export function hexCentre(hex: Hex): LngLat {
  const vertices = hex.geometry.coordinates[0]!.slice(0, -1);
  const sum = (index: 0 | 1) => vertices.reduce((total, vertex) => total + (vertex[index] as number), 0);
  return [sum(0) / vertices.length, sum(1) / vertices.length];
}

/** Decode a GBIF density tile (MVT bytes) to hexes. */
export async function decodeHexes(data: ArrayBuffer, tile: TileId, level: number): Promise<Hex[]> {
  if (!data.byteLength) return [];
  const [{ VectorTile }, { PbfReader: Reader }] = await Promise.all([import('@mapbox/vector-tile'), import('pbf')]);
  return hexesOf(new VectorTile(new Reader(data) as PbfReader), tile, level);
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
    for (const hex of hexes) {
      const had = cells.get(hex.properties.id);
      const better =
        !had ||
        (hex.properties.home && !had.properties.home) ||
        (hex.properties.home === had.properties.home && hex.properties.total > had.properties.total);
      if (better) cells.set(hex.properties.id, hex);
    }
  }
  return cells;
}
