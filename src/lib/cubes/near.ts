/**
 * Near me's circle in the cubes: the finest cells (resolution 5, about 8 km across) whose centres fall
 * inside it, and always the pin's own cell. The cubes hold no finer place, so a circle smaller than a
 * cell counts the whole cell around the pin. h3-js loads only when Near me asks.
 */
import type { OccurrenceFilter } from '~/lib/gbif';
import type { CubeArea } from './cell';
import type { CubeSet } from './reader';
import { cubeQueryFor, type TaxonLookup } from './route';

/** The cube cells Near me reads: the finest the cubes hold. */
export const NEAR_RESOLUTION = 5;
/** Centre-to-centre spacing of resolution-5 cells, near enough: rings needed = radius / this. */
const CELL_SPACING_KM = 14;

/** Near me's circle, and the month it may be limited to. */
export interface NearCircle {
  lat: number;
  lng: number;
  radiusKm: number;
  month?: number | undefined;
}

/** The resolution-5 cells inside a circle: those whose centre is in it, and the pin's own. */
export async function circleCells({ lat, lng, radiusKm }: NearCircle): Promise<bigint[]> {
  const { cellToLatLng, greatCircleDistance, gridDisk, latLngToCell } = await import('h3-js');
  const pinCell = latLngToCell(lat, lng, NEAR_RESOLUTION);
  const rings = Math.ceil(radiusKm / CELL_SPACING_KM) + 1;
  const inside = gridDisk(pinCell, rings).filter(
    (cell) => cell === pinCell || greatCircleDistance(cellToLatLng(cell), [lat, lng], 'km') <= radiusKm,
  );
  return inside.map((cell) => BigInt(`0x${cell}`));
}

/**
 * Near me's circle as a cube area, under the map's filters (and its month, if set).
 * @returns null when a taxon is one the cubes don't hold
 */
export async function nearArea(
  circle: NearCircle,
  filter: OccurrenceFilter,
  cubes: CubeSet,
  lookup: TaxonLookup,
): Promise<CubeArea | null> {
  const [cells, query] = await Promise.all([circleCells(circle), cubeQueryFor(filter, lookup)]);
  if (!query) return null;
  const months = circle.month ? [circle.month] : query.months;
  return { cubes, query: { ...query, months }, cells, resolution: NEAR_RESOLUTION };
}
