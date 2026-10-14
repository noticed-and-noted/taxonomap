/**
 * Shared explorer state. Every field lives in the URL (see url-sync.ts), so
 * any view is reproducible from its link and the back button works.
 */
import { atom, computed } from 'nanostores';
import { BASEMAP_IDS } from '~/lib/basemaps';
import type { BasisOfRecord, Continent, IucnCategory, LicenceEnum, OccurrenceFilter, TileFilter } from '~/lib/gbif';
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

export const CONTINENTS: readonly Continent[] = [
  'AFRICA',
  'ANTARCTICA',
  'ASIA',
  'EUROPE',
  'NORTH_AMERICA',
  'OCEANIA',
  'SOUTH_AMERICA',
];

/** Most to least threatened. */
export const IUCN_CATEGORIES: readonly IucnCategory[] = ['EX', 'EW', 'CR', 'EN', 'VU', 'NT', 'LC', 'DD'];

export const LICENCES: readonly LicenceEnum[] = ['CC0_1_0', 'CC_BY_4_0', 'CC_BY_NC_4_0'];

/** Allowed "max coordinate uncertainty" steps, in metres. */
/** Most taxa the What filter accepts (keeps URLs and requests short). */
export const MAX_TAXA = 10;

export const UNCERTAINTY_STEPS_M = [10, 100, 1000, 10000] as const;

export const PANELS = ['none', 'hex', 'filters'] as const;
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
  // The map persists across pages, so its view travels with navigation.
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

/**
 * Taxa to show, of any rank (records of any of them). "taxon=212" links from
 * before multi-select still parse as a one-item list.
 */
export const $taxonKeys = urlAtom(codecs.intSet('taxon', { min: 0, limit: MAX_TAXA }, { scope: 'global' }));
/** The taxon when exactly one is selected (the tree and species pages follow it), else null. */
export const $taxonKey = computed($taxonKeys, (keys) => (keys.length === 1 ? (keys[0] ?? null) : null));
export const $mapView = urlAtom(viewCodec);
export const $yearRange = urlAtom(yearsCodec);
export const $basisOfRecord = urlAtom(codecs.setOf('basis', BASIS_OF_RECORD, { scope: 'global' }));
export const $hasPhoto = urlAtom(codecs.bool('photo', { scope: 'global' }));
export const $hasSound = urlAtom(codecs.bool('sound', { scope: 'global' }));
export const $months = urlAtom(codecs.intSet('months', { min: 1, max: 12 }, { scope: 'global' }));
export const $continents = urlAtom(codecs.setOf('continent', CONTINENTS, { scope: 'global' }));
export const $maxUncertainty = urlAtom({
  ...codecs.int('uncert', null, { scope: 'global' }),
  parse: (raw) => (UNCERTAINTY_STEPS_M as readonly number[]).find((m) => String(m) === raw),
});
export const $licences = urlAtom(codecs.setOf('licence', LICENCES, { scope: 'global' }));
export const $iucn = urlAtom(codecs.setOf('iucn', IUCN_CATEGORIES, { scope: 'global' }));
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

const nonEmpty = <T>(v: readonly T[]) => (v.length ? v : undefined);

export const $occurrenceFilter = computed(
  [
    $taxonKeys,
    $yearRange,
    $basisOfRecord,
    $hasPhoto,
    $hasSound,
    $months,
    $continents,
    $maxUncertainty,
    $licences,
    $iucn,
  ],
  (taxa, year, basis, photo, sound, months, continents, uncert, licences, iucn): OccurrenceFilter => ({
    taxonKeys: nonEmpty(taxa),
    year,
    basisOfRecord: nonEmpty(basis),
    hasImage: photo || undefined,
    hasSound: sound || undefined,
    months: nonEmpty(months),
    continents: nonEmpty(continents),
    maxUncertaintyM: uncert ?? undefined,
    licences: nonEmpty(licences),
    iucn: nonEmpty(iucn),
  }),
);

/** Reset every filter, taxa included (one history step). */
export function clearFilters(): void {
  clearHexSelection();
  $taxonKeys.set([]);
  $yearRange.set(null);
  $basisOfRecord.set([]);
  $hasPhoto.set(false);
  $hasSound.set(false);
  $months.set([]);
  $continents.set([]);
  $maxUncertainty.set(null);
  $licences.set([]);
  $iucn.set([]);
}

export const $tileFilter = computed($occurrenceFilter, (f): TileFilter => ({ ...f }));
