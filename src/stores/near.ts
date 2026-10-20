/**
 * "What's near me" state. The location is always rounded to 3 dp (~100 m)
 * before it is stored, shown in the URL or sent anywhere.
 */
import { RADIUS_STEPS_KM, roundLatLng, type RadiusKm } from '~/lib/gbif/params';
import { codecs, urlAtom, type UrlCodec } from './url-sync';

export type LatLng = { lat: number; lng: number } | null;

const atCodec: UrlCodec<LatLng> = {
  key: 'at',
  default: null,
  scope: 'map',
  parse(raw) {
    const [lat, lng] = raw.split(',').map(Number);
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      Math.abs(lat as number) > 90 ||
      Math.abs(lng as number) > 180
    ) {
      return undefined;
    }
    return roundLatLng(lat as number, lng as number);
  },
  // Never asked for the default (null): it is left out of the URL.
  serialize: (position) => `${position!.lat.toFixed(3)},${position!.lng.toFixed(3)}`,
};

const radiusCodec: UrlCodec<RadiusKm> = {
  key: 'r',
  default: 2,
  scope: 'map',
  history: 'replace',
  parse: (raw) =>
    (RADIUS_STEPS_KM as readonly number[]).includes(Number(raw)) ? (Number(raw) as RadiusKm) : undefined,
  serialize: (radius) => String(radius),
};

/** "Near me" mode on the map page (`?near=1`). */
export const $nearMode = urlAtom(codecs.bool('near', { scope: 'map' }));
export const $nearAt = urlAtom(atCodec);
export const $nearRadius = urlAtom(radiusCodec);
/** Only species recorded in the current calendar month (any year). */
export const $nearThisMonth = urlAtom(codecs.bool('month', { history: 'replace', scope: 'map' }));
export const $nearTab = urlAtom(codecs.enumOf('tab', ['species', 'recent'] as const, 'species', { scope: 'map' }));

/** Set the location, rounding first (privacy rule). */
export function setNearLocation(lat: number, lng: number): void {
  $nearAt.set(roundLatLng(lat, lng));
}

/** Leave near-me mode, dropping its params from the URL (one history step). */
export function exitNearMode(): void {
  $nearMode.set(false);
  $nearAt.set(null);
  $nearRadius.set(radiusCodec.default);
  $nearThisMonth.set(false);
  $nearTab.set('species');
}

/** Map zoom that frames a radius comfortably. */
export function zoomForRadius(km: number): number {
  return Math.max(6, Math.min(14, 13.6 - Math.log2(km)));
}
