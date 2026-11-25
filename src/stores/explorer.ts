/**
 * The explorer's URL state. Every atom here lives in the URL (see url-sync.ts), so
 * any view is reproducible from its link and the back button works. The filter list
 * is in filters.ts; the atoms islands use to talk to the map are in map-messages.ts.
 */
import { computed } from 'nanostores';
import { BASEMAP_IDS } from '~/lib/basemaps';
import { parseRange, serializeRange, type DateRange } from '~/lib/dates';
import type { BasisOfRecord, Continent, IucnCategory } from '~/lib/gbif';
import { $hexGeometry } from './map-messages';
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

/** Most taxa the What filter accepts (keeps URLs and requests short). */
export const MAX_TAXA = 10;

/** Allowed "max coordinate uncertainty" steps, in metres. */
export const UNCERTAINTY_STEPS_M = [10, 100, 1000, 10000] as const;

/** `hex`: the selected cell's results; `results`: every record the filters match. */
export const PANELS = ['none', 'hex', 'results', 'filters'] as const;
export type Panel = (typeof PANELS)[number];

export interface MapView {
  lng: number;
  lat: number;
  zoom: number;
}

export const DEFAULT_VIEW: MapView = { lng: 10, lat: 25, zoom: 1.6 };

/** Whether two views are the same once rounded for the URL (2/2/1 dp). */
export function sameView(left: MapView, right: MapView): boolean {
  return (
    left.lng.toFixed(2) === right.lng.toFixed(2) &&
    left.lat.toFixed(2) === right.lat.toFixed(2) &&
    left.zoom.toFixed(1) === right.zoom.toFixed(1)
  );
}

/** "lng,lat,zoom" with 2/2/1 dp. */
const viewCodec: UrlCodec<MapView> = {
  key: 'view',
  default: DEFAULT_VIEW,
  history: 'replace',
  scope: 'map',
  parse(raw) {
    const [lng, lat, zoom] = raw.split(',').map(Number);
    if (![lng, lat, zoom].every((value) => Number.isFinite(value))) return undefined;
    return {
      lng: Math.max(-180, Math.min(180, lng as number)),
      lat: Math.max(-85, Math.min(85, lat as number)),
      zoom: Math.max(0, Math.min(22, zoom as number)),
    };
  },
  serialize: (view) => `${view.lng.toFixed(2)},${view.lat.toFixed(2)},${view.zoom.toFixed(1)}`,
  equals: sameView,
};

const dateRangeCodec: UrlCodec<DateRange | null> = {
  key: 'when',
  default: null,
  scope: 'map',
  // The slider and the date menu commit on release / Apply, so each change is a deliberate step.
  history: 'push',
  parse: parseRange,
  // Never asked for the default (null): it is left out of the URL.
  serialize: (range) => serializeRange(range!),
};

/**
 * Taxa to show, of any rank (records of any of them). "taxon=212" links from
 * before multi-select still parse as a one-item list.
 */
export const $taxonKeys = urlAtom(codecs.intSet('taxon', { min: 0, limit: MAX_TAXA }, { scope: 'map' }));
/** The taxon when exactly one is selected (the tree and species pages follow it), else null. */
export const $taxonKey = computed($taxonKeys, (keys) => (keys.length === 1 ? keys[0]! : null));
export const $mapView = urlAtom(viewCodec);
/** A map view as its `view` URL parameter. */
export const viewParam = (view: MapView): string => viewCodec.serialize(view);
/** The When date range: a rolling preset or fixed dates (see lib/dates.ts). */
export const $dateRange = urlAtom(dateRangeCodec);
export const $basisOfRecord = urlAtom(codecs.setOf('basis', BASIS_OF_RECORD, { scope: 'map' }));
/** Only records filed at exactly the chosen taxa (e.g. gray wolf without domestic dogs). */
export const $exactTaxon = urlAtom(codecs.bool('exact', { scope: 'map' }));
export const $hasPhoto = urlAtom(codecs.bool('photo', { scope: 'map' }));
export const $hasSound = urlAtom(codecs.bool('sound', { scope: 'map' }));
export const $months = urlAtom(codecs.intSet('months', { min: 1, max: 12 }, { scope: 'map' }));
/** Months only combine with a range in whole years: Any time, "Last N years" or a years range. */
export const monthsAllowed = (range: DateRange | null): boolean =>
  !range || ('preset' in range ? range.preset.endsWith('y') : range.unit === 'y');
// Drop months the moment the range stops being in years, so no hidden filter stays applied.
$dateRange.subscribe((range) => {
  if (!monthsAllowed(range) && $months.get().length) $months.set([]);
});
export const $continents = urlAtom(codecs.setOf('continent', CONTINENTS, { scope: 'map' }));
export const $maxUncertainty = urlAtom({
  ...codecs.int('uncert', null, { scope: 'map' }),
  parse: (raw) => (UNCERTAINTY_STEPS_M as readonly number[]).find((metres) => String(metres) === raw),
});
export const $iucn = urlAtom(codecs.setOf('iucn', IUCN_CATEGORIES, { scope: 'map' }));
export type HexPoint = readonly [lng: number, lat: number, level?: number] | null;

/**
 * Selected hex, stored as the clicked point and its grid level ("lng,lat,level",
 * 4 dp). Hex ids are not stable across levels, so MapCanvas re-resolves the
 * cell under this point at that level (the view's, in links without one) and
 * publishes its geometry to $hexGeometry.
 */
const hexCodec: UrlCodec<HexPoint> = {
  key: 'hex',
  default: null,
  scope: 'map',
  parse(raw) {
    const [lng, lat, level] = raw.split(',').map(Number);
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lat as number) > 90) return undefined;
    if (level === undefined) return [lng as number, lat as number];
    if (!Number.isInteger(level) || level < 0) return undefined;
    return [lng as number, lat as number, level];
  },
  serialize(position) {
    const [lng, lat, level] = position!;
    return [lng.toFixed(4), lat.toFixed(4), ...(level === undefined ? [] : [level])].join(',');
  },
};

export const $selectedHex = urlAtom(hexCodec);
export const $panel = urlAtom(codecs.enumOf('panel', PANELS, 'none', { scope: 'map' }));
/** The record open in the cell's (or near me's) record list. Replaced, not pushed: stepping through rows adds no history. */
export const $openRecord = urlAtom(codecs.int('record', null, { history: 'replace', scope: 'map' }));
export const $basemap = urlAtom(codecs.enumOf('base', BASEMAP_IDS, 'plain', { history: 'replace', scope: 'map' }));

/** Clear the hex selection and anything that depends on it. */
export function clearHexSelection(): void {
  $selectedHex.set(null);
  $hexGeometry.set(null);
  $openRecord.set(null);
  if ($panel.get() === 'hex') $panel.set('none');
}
