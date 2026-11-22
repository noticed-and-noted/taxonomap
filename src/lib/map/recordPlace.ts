/**
 * Where a record sits on the map: its point, and the area it could be anywhere in when the source says.
 * That area is the source's footprint, else its uncertainty circle; when iNaturalist obscured the
 * coordinates it is the grid square instead, and the point, being random, is left off.
 */
import { exactCircleRing } from '~/lib/gbif/params';
import { INATURALIST_DATASET_KEY, type Occurrence } from '~/lib/gbif';
import { footprintArea } from './footprint';

export type RecordArea = GeoJSON.Polygon | GeoJSON.MultiPolygon;

/** A record's place to draw: either part may be missing, but not both. */
export interface RecordPlace {
  point: GeoJSON.Point | null;
  area: RecordArea | null;
}

/** iNaturalist hides an obscured record somewhere in a square this many degrees on a side. */
const OBSCURED_CELL_DEGREES = 0.2;
/** iNaturalist's wording on an obscured record, whether the observer or a threatened-taxon rule asked for it. */
const OBSCURED = /coordinate uncertainty increased/i;
/** Narrower than this, the record's dot already covers its uncertainty circle at any zoom it shows. */
const MIN_CIRCLE_METRES = 50;
const METRES_PER_KM = 1000;

/**
 * The record's place to draw on the map.
 * @returns Its point and area, or null without coordinates.
 */
export function recordPlace(occurrence: Occurrence): RecordPlace | null {
  const { decimalLongitude: lng, decimalLatitude: lat } = occurrence;
  if (lng === undefined || lat === undefined) return null;

  if (isObscured(occurrence)) return { point: null, area: { type: 'Polygon', coordinates: [obscuredCell(lng, lat)] } };

  const area = footprintArea(occurrence) ?? uncertaintyCircle(lng, lat, occurrence.coordinateUncertaintyInMeters);
  return { point: { type: 'Point', coordinates: [lng, lat] }, area };
}

/** Whether iNaturalist moved the record's point at random within a grid square. */
function isObscured(occurrence: Occurrence): boolean {
  return occurrence.datasetKey === INATURALIST_DATASET_KEY && OBSCURED.test(occurrence.informationWithheld ?? '');
}

/** The circle the record could be anywhere in, or null when its uncertainty is unknown or too small to see. */
function uncertaintyCircle(lng: number, lat: number, metres: number | undefined): GeoJSON.Polygon | null {
  if (!metres || metres < MIN_CIRCLE_METRES) return null;
  return { type: 'Polygon', coordinates: [exactCircleRing(lat, lng, metres / METRES_PER_KM)] };
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
