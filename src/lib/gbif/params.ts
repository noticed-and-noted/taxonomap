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

export function round(value: number, dp: number): number {
  const f = 10 ** dp;
  // Add 0 to normalise -0 to 0.
  return Math.round(value * f) / f + 0;
}

export function roundBbox(bbox: BBox, dp = 2): BBox {
  const [w, s, e, n] = bbox;
  return [round(w, dp), round(s, dp), round(e, dp), round(n, dp)];
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
  const [w, s, e, n] = roundBbox(bbox);
  return `POLYGON((${w} ${s},${e} ${s},${e} ${n},${w} ${n},${w} ${s}))`;
}

/**
 * Approximate a circle as a 24-sided CCW polygon. Coordinates are rounded to
 * 3 dp (~100 m) so nearby users share cache entries.
 */
export function circleToWkt(lat: number, lng: number, radiusKm: number, sides = 24): string {
  const ring = circleRing(lat, lng, radiusKm, sides).map(([x, y]) => `${round(x, 3)} ${round(y, 3)}`);
  return `POLYGON((${ring.join(',')}))`;
}

/** Closed counter-clockwise ring [lng, lat][] for a (snapped, rounded) circle. */
export function circleRing(lat: number, lng: number, radiusKm: number, sides = 24): [number, number][] {
  const r = snapRadiusKm(radiusKm);
  const c = roundLatLng(lat, lng);
  const dLat = r / 110.574;
  const dLng = r / (111.32 * Math.max(Math.cos((c.lat * Math.PI) / 180), 1e-6));
  const pts: [number, number][] = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * 2 * Math.PI;
    pts.push([c.lng + dLng * Math.cos(a), c.lat + dLat * Math.sin(a)]);
  }
  pts.push(pts[0] as [number, number]);
  return pts;
}

function isPresent(v: ParamValue): v is string | number | boolean {
  return v !== undefined && v !== null && v !== '';
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
    for (const v of clean) parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
  }
  return parts.join('&');
}

export function buildUrl(base: string, path: string, params?: Params): string {
  const qs = toQueryString(params);
  return `${base}${path}${qs ? `?${qs}` : ''}`;
}

/** GBIF range syntax: "1990,2000", or a single year. */
export function yearRangeParam(range: readonly [number, number] | null | undefined): string | undefined {
  if (!range) return undefined;
  const [a, b] = range;
  return a === b ? String(a) : `${Math.min(a, b)},${Math.max(a, b)}`;
}

export type LngLat = readonly [lng: number, lat: number];

function signedArea(ring: readonly LngLat[]): number {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const p = ring[i] as LngLat;
    const q = ring[i + 1] as LngLat;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/**
 * WKT for a single polygon ring: rounded to 4 dp (~10 m), consecutive
 * duplicates removed, closed, and wound counter-clockwise as GBIF requires.
 */
export function polygonToWkt(ring: readonly LngLat[], dp = 4): string {
  const pts: LngLat[] = [];
  for (const [x, y] of ring) {
    const p: LngLat = [round(x, dp), round(y, dp)];
    const last = pts[pts.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) pts.push(p);
  }
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) pts.push(first);
  if (signedArea(pts) < 0) pts.reverse();
  return `POLYGON((${pts.map(([x, y]) => `${x} ${y}`).join(',')}))`;
}
