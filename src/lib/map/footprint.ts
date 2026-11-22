/**
 * A record's footprint: the true shape of its place (a grid square, a survey plot) when the source
 * gives one as Darwin Core's `footprintWKT`.
 */
import type { Occurrence } from '~/lib/gbif';

const WKT_POLYGON = /^\s*(MULTIPOLYGON|POLYGON)\s*(\(.*\))\s*$/is;
const NUMBER = String.raw`[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?`;
/** A position's longitude and latitude, dropping any height or measure after them. */
const POSITION = new RegExp(String.raw`(${NUMBER})\s+(${NUMBER})(?:\s+${NUMBER})*`, 'g');
/** A projected system, in metres, that would need reprojecting; GBIF doesn't reproject footprints. */
const PROJECTED_SRS = /PROJCS|PROJCRS/i;
const WGS84_SRS = /\b4326\b|WGS\s*84/i;
/** A closed ring needs three corners plus the first again. */
const MIN_RING_POSITIONS = 4;

type Ring = [number, number][];

/**
 * The record's footprint, when it is a polygon in WGS84 longitude and latitude.
 * @returns The polygon, or null without one, in another system, or when the WKT doesn't parse.
 */
export function footprintArea(occurrence: Occurrence): GeoJSON.Polygon | GeoJSON.MultiPolygon | null {
  if (!occurrence.footprintWKT || !isWgs84(occurrence.footprintSRS)) return null;
  const match = WKT_POLYGON.exec(occurrence.footprintWKT);
  if (!match) return null;
  const nested = parseNested(match[2]!);
  if (match[1]!.toUpperCase() === 'POLYGON') return isPolygon(nested) ? { type: 'Polygon', coordinates: nested } : null;
  const isMultiPolygon = Array.isArray(nested) && nested.length > 0 && nested.every(isPolygon);
  return isMultiPolygon ? { type: 'MultiPolygon', coordinates: nested as Ring[][] } : null;
}

/** Whether a footprint SRS means plain longitude and latitude; Darwin Core reads an empty one as WGS84. */
function isWgs84(srs: string | undefined): boolean {
  if (!srs?.trim()) return true;
  return WGS84_SRS.test(srs) && !PROJECTED_SRS.test(srs);
}

/** WKT's parenthesised lists as nested arrays: "((1 2, 3 4))" is [[[1, 2], [3, 4]]]; null if malformed. */
function parseNested(body: string): unknown {
  const json = body
    .replace(POSITION, (_position, lng: string, lat: string) => `[${Number(lng)},${Number(lat)}]`)
    .replaceAll('(', '[')
    .replaceAll(')', ']');
  try {
    return JSON.parse(json);
  } catch {
    // Malformed WKT from a publisher: the record falls back to its uncertainty circle.
    return null;
  }
}

/** Whether nested arrays form a polygon: closed rings of in-range longitude and latitude. */
function isPolygon(rings: unknown): rings is Ring[] {
  return Array.isArray(rings) && rings.length > 0 && rings.every(isRing);
}

/** Whether an array is a closed ring of positions. */
function isRing(ring: unknown): ring is Ring {
  return Array.isArray(ring) && ring.length >= MIN_RING_POSITIONS && ring.every(isLngLat);
}

/** Whether a position is a longitude and latitude on the globe. */
function isLngLat(position: unknown): boolean {
  if (!Array.isArray(position) || position.length !== 2) return false;
  const [lng, lat] = position as number[];
  return Math.abs(lng!) <= 180 && Math.abs(lat!) <= 90;
}
