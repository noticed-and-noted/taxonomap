/**
 * Shared explorer state. Every field lives in the URL (see url-sync.ts), so
 * any view is reproducible from its link and the back button works.
 */
import { computed } from 'nanostores';
import type { BasisOfRecord, OccurrenceFilter, TileFilter } from '~/lib/gbif';
import { codecs, urlAtom, type UrlCodec } from './url-sync';

export const BASIS_OF_RECORD: readonly BasisOfRecord[] = [
  'HUMAN_OBSERVATION',
  'PRESERVED_SPECIMEN',
  'MACHINE_OBSERVATION',
  'MATERIAL_SAMPLE',
  'FOSSIL_SPECIMEN',
  'LIVING_SPECIMEN',
  'MATERIAL_CITATION',
  'OCCURRENCE',
];

export const PANELS = ['none', 'hex', 'filters', 'layers', 'compare'] as const;
export type Panel = (typeof PANELS)[number];

export interface MapView {
  lng: number;
  lat: number;
  zoom: number;
}

export const DEFAULT_VIEW: MapView = { lng: 10, lat: 25, zoom: 1.6 };

/** "lng,lat,zoom" with 2/2/1 dp. */
const viewCodec: UrlCodec<MapView> = {
  key: 'view',
  default: DEFAULT_VIEW,
  history: 'replace',
  scope: 'page',
  parse(raw) {
    const [lng, lat, zoom] = raw.split(',').map(Number);
    if (![lng, lat, zoom].every((n) => Number.isFinite(n))) return undefined;
    return {
      lng: Math.max(-180, Math.min(180, lng as number)),
      lat: Math.max(-85, Math.min(85, lat as number)),
      zoom: Math.max(0, Math.min(22, zoom as number)),
    };
  },
  serialize: (v) => `${v.lng.toFixed(2)},${v.lat.toFixed(2)},${v.zoom.toFixed(1)}`,
  equals: (a, b) =>
    a.lng.toFixed(2) === b.lng.toFixed(2) &&
    a.lat.toFixed(2) === b.lat.toFixed(2) &&
    a.zoom.toFixed(1) === b.zoom.toFixed(1),
};

export type YearRange = readonly [number, number] | null;

const yearsCodec: UrlCodec<YearRange> = {
  key: 'years',
  default: null,
  scope: 'global',
  history: 'replace',
  parse(raw) {
    const m = /^(\d{4})-(\d{4})$/.exec(raw);
    if (!m) return undefined;
    const a = Number(m[1]);
    const b = Number(m[2]);
    return [Math.min(a, b), Math.max(a, b)];
  },
  serialize: (v) => (v ? `${v[0]}-${v[1]}` : ''),
};

export const $taxonKey = urlAtom(codecs.int('taxon', null, { scope: 'global' }));
export const $mapView = urlAtom(viewCodec);
export const $yearRange = urlAtom(yearsCodec);
export const $basisOfRecord = urlAtom(codecs.setOf('basis', BASIS_OF_RECORD, { scope: 'global' }));
export const $hasPhoto = urlAtom(codecs.bool('photo', { scope: 'global' }));
export const $country = urlAtom(codecs.string('country', { pattern: /^[A-Z]{2}$/, scope: 'global' }));
/** Selected hex cell id ("z/x/y/i" or similar; set by MapCanvas in Phase 2). */
export const $selectedHex = urlAtom(codecs.string('hex', { pattern: /^[\w./:-]{1,64}$/ }));
export const $panel = urlAtom(codecs.enumOf('panel', PANELS, 'none'));

export const $occurrenceFilter = computed(
  [$taxonKey, $yearRange, $basisOfRecord, $hasPhoto, $country],
  (taxonKey, year, basis, photo, country): OccurrenceFilter => ({
    taxonKey: taxonKey ?? undefined,
    year,
    basisOfRecord: basis.length ? basis : undefined,
    hasImage: photo || undefined,
    country: country ?? undefined,
  }),
);

export const $tileFilter = computed($occurrenceFilter, (f): TileFilter => ({ ...f }));
