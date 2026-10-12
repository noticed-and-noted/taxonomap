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
  const r = snapRadiusKm(radiusKm);
  const c = roundLatLng(lat, lng);
  const dLat = r / 110.574;
  const dLng = r / (111.32 * Math.max(Math.cos((c.lat * Math.PI) / 180), 1e-6));
  const pts: string[] = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * 2 * Math.PI;
    pts.push(`${round(c.lng + dLng * Math.cos(a), 3)} ${round(c.lat + dLat * Math.sin(a), 3)}`);
  }
  pts.push(pts[0] as string);
  return `POLYGON((${pts.join(',')}))`;
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
