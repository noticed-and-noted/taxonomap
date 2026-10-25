/**
 * Where a record sits on the map: its point or, when iNaturalist obscured the
 * coordinates, the grid square the record could be anywhere in.
 */
import { INATURALIST_DATASET_KEY, type Occurrence } from '~/lib/gbif';

/** iNaturalist hides an obscured record somewhere in a square this many degrees on a side. */
const OBSCURED_CELL_DEGREES = 0.2;
/** iNaturalist's wording on an obscured record, whether the observer or a threatened-taxon rule asked for it. */
const OBSCURED = /coordinate uncertainty increased/i;

/**
 * The record's place to draw on the map.
 * @returns The point, the obscured square for an obscured iNaturalist record, or null without coordinates.
 */
export function recordPlace(occurrence: Occurrence): GeoJSON.Point | GeoJSON.Polygon | null {
  const { decimalLongitude: lng, decimalLatitude: lat } = occurrence;
  if (lng === undefined || lat === undefined) return null;
  const isObscured =
    occurrence.datasetKey === INATURALIST_DATASET_KEY && OBSCURED.test(occurrence.informationWithheld ?? '');
  if (!isObscured) return { type: 'Point', coordinates: [lng, lat] };
  return { type: 'Polygon', coordinates: [obscuredCell(lng, lat)] };
}

// iNaturalist moves the public point at random within the square holding the true one, so snapping it
// to the grid finds that square: the same one iNaturalist draws on its own map.
function obscuredCell(lng: number, lat: number): [number, number][] {
  const west = Math.floor(lng / OBSCURED_CELL_DEGREES) * OBSCURED_CELL_DEGREES;
  const south = Math.floor(lat / OBSCURED_CELL_DEGREES) * OBSCURED_CELL_DEGREES;
  const east = west + OBSCURED_CELL_DEGREES;
  const north = south + OBSCURED_CELL_DEGREES;
  return [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south],
  ];
}
