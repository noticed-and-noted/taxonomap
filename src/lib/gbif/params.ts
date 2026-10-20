/**
 * Request parameter normalisation. Equal requests must produce byte-identical
 * URLs so that in-flight dedupe, the LRU, the Service Worker and any edge
 * cache all hit.
 */

export type ParamValue = string | number | boolean | null | undefined;
export type Params = Record<string, ParamValue | readonly ParamValue[]>;

export type BBox = readonly [west: number, south: number, east: number, north: number];

export const RADIUS_STEPS_KM = [1, 2, 5, 10, 25, 50] as const;
export type RadiusKm = (typeof RADIUS_STEPS_KM)[number];

/** Rounds to a number of decimal places, never returning -0. */
export function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  // Add 0 to normalise -0 to 0.
  return Math.round(value * factor) / factor + 0;
}

/** Rounds each edge of a [west, south, east, north] box. */
export function roundBbox(bbox: BBox, decimals = 2): BBox {
  const [west, south, east, north] = bbox;
  return [round(west, decimals), round(south, decimals), round(east, decimals), round(north, decimals)];
}

/** Snap to the nearest allowed radius step (ties go to the larger step). */
export function snapRadiusKm(km: number): RadiusKm {
  let best: RadiusKm = RADIUS_STEPS_KM[0];
  for (const step of RADIUS_STEPS_KM) {
    if (Math.abs(step - km) <= Math.abs(best - km)) best = step;
  }
  return best;
}

/** Round user geolocation before it is used anywhere (privacy rule). */
export function roundLatLng(lat: number, lng: number): { lat: number; lng: number } {
  return { lat: round(lat, 3), lng: round(lng, 3) };
}

/** Counter-clockwise WKT polygon for a bbox (GBIF requires CCW rings). */
export function bboxToWkt(bbox: BBox): string {
  const [west, south, east, north] = roundBbox(bbox);
  return `POLYGON((${west} ${south},${east} ${south},${east} ${north},${west} ${north},${west} ${south}))`;
}

/**
 * Approximate a circle as a 24-sided CCW polygon. Coordinates are rounded to
 * 3 dp (~100 m) so nearby users share cache entries.
 */
export function circleToWkt(lat: number, lng: number, radiusKm: number, sides = 24): string {
  const ring = circleRing(lat, lng, radiusKm, sides).map(
    ([pointLng, pointLat]) => `${round(pointLng, 3)} ${round(pointLat, 3)}`,
  );
  return `POLYGON((${ring.join(',')}))`;
}

/** Closed counter-clockwise ring [lng, lat][] for a (snapped, rounded) circle. */
export function circleRing(lat: number, lng: number, radiusKm: number, sides = 24): [number, number][] {
  const radius = snapRadiusKm(radiusKm);
  const centre = roundLatLng(lat, lng);
  const deltaLat = radius / 110.574;
  const deltaLng = radius / (111.32 * Math.max(Math.cos((centre.lat * Math.PI) / 180), 1e-6));
  const points: [number, number][] = [];
  for (let index = 0; index < sides; index++) {
    const angle = (index / sides) * 2 * Math.PI;
    points.push([centre.lng + deltaLng * Math.cos(angle), centre.lat + deltaLat * Math.sin(angle)]);
  }
  points.push(points[0] as [number, number]);
  return points;
}

function isPresent(value: ParamValue): value is string | number | boolean {
  return value !== undefined && value !== null && value !== '';
}

/**
 * Stable query string: keys sorted, empty values dropped, repeated values
 * de-duplicated and sorted (GBIF treats repeated params as an unordered set).
 */
export function toQueryString(params: Params = {}): string {
  const parts: string[] = [];
  for (const key of Object.keys(params).sort()) {
    const raw = params[key];
    const values = (Array.isArray(raw) ? raw : [raw]) as ParamValue[];
    const clean = [...new Set(values.filter(isPresent).map(String))].sort();
    for (const value of clean) parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  }
  return parts.join('&');
}

/** `base + path` with the query string from `params`, if there is one. */
export function buildUrl(base: string, path: string, params?: Params): string {
  const queryString = toQueryString(params);
  return `${base}${path}${queryString ? `?${queryString}` : ''}`;
}

/** GBIF range syntax: "1990,2000", or a single year. */
export function yearRangeParam(range: readonly [number, number] | null | undefined): string | undefined {
  if (!range) return undefined;
  const [low, high] = range;
  return low === high ? String(low) : `${Math.min(low, high)},${Math.max(low, high)}`;
}

export type LngLat = readonly [lng: number, lat: number];

function signedArea(ring: readonly LngLat[]): number {
  let area = 0;
  for (let index = 0; index < ring.length - 1; index++) {
    const current = ring[index] as LngLat;
    const next = ring[index + 1] as LngLat;
    area += current[0] * next[1] - next[0] * current[1];
  }
  return area / 2;
}

/**
 * WKT for a single polygon ring: rounded to 4 dp (~10 m), consecutive
 * duplicates removed, closed, and wound counter-clockwise as GBIF requires.
 */
export function polygonToWkt(ring: readonly LngLat[], decimals = 4): string {
  const points: LngLat[] = [];
  for (const [pointLng, pointLat] of ring) {
    const point: LngLat = [round(pointLng, decimals), round(pointLat, decimals)];
    const last = points[points.length - 1];
    if (!last || last[0] !== point[0] || last[1] !== point[1]) points.push(point);
  }
  const first = points[0];
  const last = points[points.length - 1];
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) points.push(first);
  if (signedArea(points) < 0) points.reverse();
  return `POLYGON((${points.map(([pointLng, pointLat]) => `${pointLng} ${pointLat}`).join(',')}))`;
}
