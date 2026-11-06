/**
 * A species page's mini-map from the map cube, in cube mode: the taxon's coarsest cells worldwide, as
 * shapes in the mini-map's web-mercator canvas (zoom 1, two tiles a side). Loads h3-js, so the page
 * imports it only in cube mode.
 */
import { cellToBoundary } from 'h3-js';
import { colourLevel } from './grid';
import type { CubeSet } from './reader';
import type { CubeTaxon } from './route';

/** The resolution the mini-map draws: the coarsest, so the world fits in one small read. */
const MINI_MAP_RESOLUTION = 2;
const HALF_TURN = 180;
const MAX_LAT = 85.0511;

/** One cell to draw: its outline in canvas pixels and its (scaled) records. */
export interface MiniMapShape {
  points: [number, number][];
  total: number;
}

/** A longitude and latitude in a square web-mercator canvas `size` pixels across. */
function project([lat, lng]: number[], size: number): [number, number] {
  const clamped = (Math.max(-MAX_LAT, Math.min(MAX_LAT, lat!)) * Math.PI) / HALF_TURN;
  const pixelX = ((lng! + HALF_TURN) / (2 * HALF_TURN)) * size;
  const pixelY = ((1 - Math.log(Math.tan(Math.PI / 4 + clamped / 2)) / Math.PI) / 2) * size;
  return [pixelX, pixelY];
}

/** A cell's outline, unwrapped past ±180 when it straddles the antimeridian. */
function outline(cell: string): number[][] {
  const ring = cellToBoundary(cell);
  const straddles = Math.max(...ring.map(([, lng]) => lng!)) - Math.min(...ring.map(([, lng]) => lng!)) > HALF_TURN;
  return ring.map(([lat, lng]) => [lat!, straddles && lng! < 0 ? lng! + 2 * HALF_TURN : lng!]);
}

/**
 * A taxon's cells worldwide as mini-map shapes, and the colour level to bin their counts at.
 * @param kingdom keeps to one kingdom's rows, for a name used in two
 * @param size the canvas's width and height in pixels
 */
export async function miniMapShapes(cubes: CubeSet, taxon: CubeTaxon, kingdom: string | undefined, size: number) {
  const rows = await cubes.mapRows(taxon, MINI_MAP_RESOLUTION, null);
  const totals = new Map<string, number>();
  for (const row of rows) {
    if (taxon.rank !== 'kingdom' && kingdom && row.kingdom !== kingdom) continue;
    const cell = row.cell.toString(16);
    totals.set(cell, (totals.get(cell) ?? 0) + Number(row.records));
  }
  const shapes = [...totals].map(([cell, total]): MiniMapShape => ({
    points: outline(cell).map((point) => project(point, size)),
    total: Math.round(total * cubes.scale),
  }));
  return { shapes, level: colourLevel(MINI_MAP_RESOLUTION) };
}
