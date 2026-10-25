/**
 * Request parameter normalisation. Equal requests must produce byte-identical
 * URLs so that in-flight dedupe, the LRU, the Service Worker and any edge
 * cache all hit.
 */

export type ParamValue = string | number | boolean | null | undefined;
export type Params = Record<string, ParamValue | readonly ParamValue[]>;

export const RADIUS_STEPS_KM = [1, 2, 5, 10, 25, 50] as const;
export type RadiusKm = (typeof RADIUS_STEPS_KM)[number];

/** Rounds to a number of decimal places, never returning -0. */
export function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  // Add 0 to normalise -0 to 0.
  return Math.round(value * factor) / factor + 0;
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

/**
 * Approximate a circle as a 24-sided CCW polygon. Coordinates are rounded to
 * 3 dp (~100 m) so nearby users share cache entries.
 */
export function circleToWkt(lat: number, lng: number, radiusKm: number, sides = 24): string {
  return polygonToWkt(circleRing(lat, lng, radiusKm, sides), 3);
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

const ANTIMERIDIAN = 180;
const FULL_TURN = 360;

/** The part of a convex ring on one side of a meridian (Sutherland–Hodgman against one edge). */
function clipAtLng(ring: readonly LngLat[], edge: number, keepWest: boolean): LngLat[] {
  const isKept = ([pointLng]: LngLat) => (keepWest ? pointLng <= edge : pointLng >= edge);
  const clipped: LngLat[] = [];
  ring.forEach((current, index) => {
    const previous = ring[(index + ring.length - 1) % ring.length]!;
    if (isKept(current) !== isKept(previous)) {
      const share = (edge - previous[0]) / (current[0] - previous[0]);
      clipped.push([edge, previous[1] + share * (current[1] - previous[1])]);
    }
    if (isKept(current)) clipped.push(current);
  });
  return clipped;
}

/**
 * A ring moved onto -180..180, and cut in two where it crosses the
 * antimeridian: GBIF rejects longitudes past ±180, so map cells drawn across
 * that line or on a wrapped world copy need this.
 */
function wrapRing(ring: readonly LngLat[]): LngLat[][] {
  if (ring.length === 0) return [[]];
  const lngs = ring.map(([pointLng]) => pointLng);
  const shift = -Math.round((Math.min(...lngs) + Math.max(...lngs)) / 2 / FULL_TURN) * FULL_TURN;
  const shifted = ring.map(([pointLng, pointLat]): LngLat => [pointLng + shift, pointLat]);
  const isPastEast = Math.max(...lngs) + shift > ANTIMERIDIAN;
  if (!isPastEast && Math.min(...lngs) + shift >= -ANTIMERIDIAN) return [shifted];
  const edge = isPastEast ? ANTIMERIDIAN : -ANTIMERIDIAN;
  const overhang = clipAtLng(shifted, edge, !isPastEast).map(([pointLng, pointLat]): LngLat => [
    pointLng - Math.sign(edge) * FULL_TURN,
    pointLat,
  ]);
  return [clipAtLng(shifted, edge, isPastEast), overhang];
}

/** A ring rounded, with consecutive duplicates removed, closed, and wound counter-clockwise. */
function tidyRing(ring: readonly LngLat[], decimals: number): LngLat[] {
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
  return points;
}

/**
 * WKT for a convex polygon ring: rounded to 4 dp (~10 m), consecutive
 * duplicates removed, closed, and wound counter-clockwise as GBIF requires.
 * A ring crossing the antimeridian becomes a MULTIPOLYGON of its two halves.
 */
export function polygonToWkt(ring: readonly LngLat[], decimals = 4): string {
  const parts = wrapRing(ring).map(
    (part) =>
      `((${tidyRing(part, decimals)
        .map(([pointLng, pointLat]) => `${pointLng} ${pointLat}`)
        .join(',')}))`,
  );
  return parts.length === 1 ? `POLYGON${parts[0]}` : `MULTIPOLYGON(${parts.join(',')})`;
}
