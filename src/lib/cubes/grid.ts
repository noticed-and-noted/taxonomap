/**
 * The cubes' H3 grid on the app's map: which resolution a grid level shows, which colour level its counts
 * read against, the view's bounds, and H3 cells as the same hex features GBIF's tiles become.
 */
import { cellToBoundary } from 'h3-js';
import type { Map as MlMap } from 'maplibre-gl';
import type { Hex } from '~/lib/map/occGrid';
import type { Bounds } from './ranges';
import { WORLD_MAX_ZOOM } from './route';

/** The resolutions the cubes are cut at, coarsest first. */
export const CUBE_RESOLUTIONS = [2, 3, 4, 5] as const;
export type CubeResolution = (typeof CUBE_RESOLUTIONS)[number];

/**
 * The grid level (see gridLevel in occGrid.ts) each resolution's counts are coloured as. GBIF's cells
 * grow 4× in area per level down and H3's 7× per resolution, so these keep the legend's bins in step:
 * the cells are about the size of GBIF's at that level.
 */
const COLOUR_LEVELS: Record<CubeResolution, number> = { 2: 2, 3: 4, 4: 5, 5: 6 };

/** Hexes are clipped this far from the poles, as GBIF's are (see occGrid.ts). */
const MAX_LAT = 85;
const HALF_TURN = 180;

/** The H3 resolution for a grid level: about the size of GBIF's cells there. */
export function resolutionForLevel(level: number): CubeResolution {
  const finest = CUBE_RESOLUTIONS.at(-1)!;
  return CUBE_RESOLUTIONS.find((resolution) => COLOUR_LEVELS[resolution] >= level) ?? finest;
}

/** The grid level a resolution's counts are coloured as. */
export function colourLevel(resolution: CubeResolution): number {
  return COLOUR_LEVELS[resolution];
}

/**
 * What the canvas shows, from its corners and edge midpoints, or null for the whole world (zoomed out, or
 * wider than ranges can cover).
 */
export function viewBounds(map: MlMap): Bounds | null {
  const canvas = map.getCanvas();
  const [width, height] = [canvas.clientWidth, canvas.clientHeight];
  if (map.getZoom() < WORLD_MAX_ZOOM || !width || !height) return null;
  const points = [
    [0, 0],
    [width, 0],
    [0, height],
    [width, height],
    [width / 2, 0],
    [width / 2, height],
  ].map(([pixelX, pixelY]) => map.unproject([pixelX!, pixelY!]));
  const lngs = points.map((point) => point.lng);
  const lats = points.map((point) => point.lat);
  const [west, east] = [Math.min(...lngs), Math.max(...lngs)];
  if (east - west >= HALF_TURN) return null;
  return [west, Math.max(-MAX_LAT, Math.min(...lats)), east, Math.min(MAX_LAT, Math.max(...lats))];
}

/** A cell's outline as [lng, lat], unwrapped past ±180 when it straddles the antimeridian, as GBIF's are. */
function outline(cell: string): GeoJSON.Position[] {
  const ring = cellToBoundary(cell, true);
  const longitudes = ring.map(([lng]) => lng!);
  const straddles = Math.max(...longitudes) - Math.min(...longitudes) > HALF_TURN;
  return ring.map(([lng, lat]) => [
    straddles && lng! < 0 ? lng! + 2 * HALF_TURN : lng!,
    Math.max(-MAX_LAT, Math.min(MAX_LAT, lat!)),
  ]);
}

/** An H3 cell and its record count as a map hex, keyed by the cell so redraws update in place. */
export function cellToHex(cell: string, total: number): Hex {
  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [outline(cell)] },
    properties: { id: cell, total, home: true, h3: cell },
  };
}
