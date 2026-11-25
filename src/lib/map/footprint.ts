/**
 * A record's footprint: the true shape of its place (a grid square, a survey plot) when the source
 * gives one as Darwin Core's `footprintWKT`.
 */
import type { Occurrence } from '~/lib/gbif';

/** A polygon or multipolygon, with or without a Z, M or ZM tag (the heights and measures are dropped). */
const WKT_POLYGON = /^\s*(?<shape>MULTIPOLYGON|POLYGON)\s*(?:ZM|Z|M)?\s*(?<body>\(.*\))\s*$/is;
const NUMBER = String.raw`[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?`;
/** A position's longitude and latitude, dropping any height or measure after them. */
const POSITION = new RegExp(String.raw`(${NUMBER})\s+(${NUMBER})(?:\s+${NUMBER})*`, 'g');
/** A projected system, in metres, that would need reprojecting; GBIF doesn't reproject footprints. */
const PROJECTED_SRS = /PROJCS|PROJCRS/i;
/**
 * Longitude and latitude on WGS84 or a datum within a metre or so of it (ETRS89, NAD83), however written:
 * "EPSG:4326", an OGC URN ending "::4258", or WKT naming the datum.
 */
const LNG_LAT_SRS = /\b(?:4326|4258|4269)\b|WGS\s*84|ETRS\s*89|NAD\s*83/i;
/** A closed ring needs three corners plus the first again. */
const MIN_RING_POSITIONS = 4;

type Ring = [number, number][];

/**
 * The record's footprint, when it is a polygon in longitude and latitude.
 * @returns The polygon, or null without one, in another system, or when the WKT doesn't parse.
 */
export function footprintArea(occurrence: Occurrence): GeoJSON.Polygon | GeoJSON.MultiPolygon | null {
  if (!occurrence.footprintWKT || !isLngLatSrs(occurrence.footprintSRS)) return null;

  const { shape, body } = WKT_POLYGON.exec(occurrence.footprintWKT)?.groups ?? {};
  if (!shape || !body) return null;

  const coordinates = parseNested(body);
  if (shape.toUpperCase() === 'POLYGON') return isPolygon(coordinates) ? { type: 'Polygon', coordinates } : null;
  return isMultiPolygon(coordinates) ? { type: 'MultiPolygon', coordinates } : null;
}

/** Whether a footprint SRS means plain longitude and latitude; Darwin Core reads an empty one as WGS84. */
function isLngLatSrs(srs: string | undefined): boolean {
  if (!srs?.trim()) return true;
  return LNG_LAT_SRS.test(srs) && !PROJECTED_SRS.test(srs);
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

/** Whether nested arrays form a multipolygon: one or more polygons. */
function isMultiPolygon(polygons: unknown): polygons is Ring[][] {
  return Array.isArray(polygons) && polygons.length > 0 && polygons.every(isPolygon);
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
