/**
 * Shared explorer state. Every field lives in the URL (see url-sync.ts), so
 * any view is reproducible from its link and the back button works.
 */
import { atom, computed } from 'nanostores';
import { BASEMAP_IDS } from '~/lib/basemaps';
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

export const PANELS = ['none', 'hex', 'filters', 'compare'] as const;
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
  // The map persists across pages, so its view travels with navigation
  // (the tree's "only the map view" scope depends on it).
  scope: 'global',
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
  // The slider commits on release, so each change is a deliberate step.
  history: 'push',
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
export type HexPoint = readonly [lng: number, lat: number] | null;

/**
 * Selected hex, stored as the clicked point ("lng,lat", 4 dp). Hex ids are
 * not stable across zooms, so MapCanvas re-resolves the cell under this point
 * at the URL's zoom and publishes its geometry to $hexGeometry.
 */
const hexCodec: UrlCodec<HexPoint> = {
  key: 'hex',
  default: null,
  parse(raw) {
    const [lng, lat] = raw.split(',').map(Number);
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lat as number) > 90) return undefined;
    return [lng as number, lat as number];
  },
  serialize: (v) => (v ? `${v[0].toFixed(4)},${v[1].toFixed(4)}` : ''),
};

export const $selectedHex = urlAtom(hexCodec);
export const $panel = urlAtom(codecs.enumOf('panel', PANELS, 'none'));
/** Compare mode: overlay a second species, or swipe between two year ranges. */
export const $compareMode = urlAtom(codecs.enumOf('compare', ['off', 'species', 'years'] as const, 'off'));
/** Second taxon for species comparison (shown in blue; the main taxon in orange). */
export const $taxonB = urlAtom(codecs.int('taxonB', null));
/** Second year range for the swipe comparison. */
export const $yearRangeB = urlAtom({ ...yearsCodec, key: 'yearsB', scope: 'page' as const });
export const $basemap = urlAtom(codecs.enumOf('base', BASEMAP_IDS, 'plain', { history: 'replace' }));
/** Show individual (clustered) records for the selected hex. */
export const $showRecords = urlAtom(codecs.bool('pts'));
/** Selected occurrence record (shown in the panel). */
export const $selectedRecord = urlAtom(codecs.int('rec', null));

/* ---- Ephemeral (not in the URL): derived from URL state or one-shot requests ---- */

export interface HexGeometry {
  /** Outer ring, lng/lat. */
  ring: [number, number][];
  /** CCW WKT for GBIF geometry filters. */
  wkt: string;
  /** Count shown on the tile (before live refinement). */
  tileTotal: number;
}

/** Geometry of the selected hex, published by MapCanvas. */
export const $hexGeometry = atom<HexGeometry | null>(null);

export type FlyRequest =
  | { kind: 'bounds'; bbox: readonly [number, number, number, number]; maxZoom?: number }
  | { kind: 'point'; lng: number; lat: number; zoom: number };

/** What a click on the map does: select a hex (explorer) or drop a pin (near me). */
export const $mapMode = atom<'explore' | 'pin'>('explore');

/** Current map bounds [west, south, east, north], published by MapCanvas. */
export const $mapBounds = atom<readonly [number, number, number, number] | null>(null);

/** One-shot camera requests (place search, taxon extent). */
export const $flyTo = atom<FlyRequest | null>(null);

/** Clear the hex selection and anything that depends on it. */
export function clearHexSelection(): void {
  $selectedHex.set(null);
  $showRecords.set(false);
  $selectedRecord.set(null);
  $hexGeometry.set(null);
  if ($panel.get() === 'hex') $panel.set('none');
}

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
