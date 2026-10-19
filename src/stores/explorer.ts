/**
 * Shared explorer state. Every field lives in the URL (see url-sync.ts), so
 * any view is reproducible from its link and the back button works.
 */
import { atom, computed, type ReadableAtom, type WritableAtom } from 'nanostores';
import { BASEMAP_IDS } from '~/lib/basemaps';
import { parseRange, rangeFilter, rangeLabel, serializeRange, type DateRange } from '~/lib/dates';
import { BASIS_LABELS, CONTINENT_LABELS, distance, IUCN_LABELS, MONTHS } from '~/lib/format';
import type { BasisOfRecord, Continent, IucnCategory, OccurrenceFilter } from '~/lib/gbif';
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

export const PANELS = ['none', 'hex', 'filters'] as const;
export type Panel = (typeof PANELS)[number];

export interface MapView {
  lng: number;
  lat: number;
  zoom: number;
}

export const DEFAULT_VIEW: MapView = { lng: 10, lat: 25, zoom: 1.6 };

/** Whether two views are the same once rounded for the URL (2/2/1 dp). */
export function sameView(a: MapView, b: MapView): boolean {
  return (
    a.lng.toFixed(2) === b.lng.toFixed(2) &&
    a.lat.toFixed(2) === b.lat.toFixed(2) &&
    a.zoom.toFixed(1) === b.zoom.toFixed(1)
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
    if (![lng, lat, zoom].every((n) => Number.isFinite(n))) return undefined;
    return {
      lng: Math.max(-180, Math.min(180, lng as number)),
      lat: Math.max(-85, Math.min(85, lat as number)),
      zoom: Math.max(0, Math.min(22, zoom as number)),
    };
  },
  serialize: (v) => `${v.lng.toFixed(2)},${v.lat.toFixed(2)},${v.zoom.toFixed(1)}`,
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
  serialize: (v) => serializeRange(v!),
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
export const viewParam = (v: MapView): string => viewCodec.serialize(v);
/** The When date range: a rolling preset or fixed dates (see lib/dates.ts). */
export const $dateRange = urlAtom(dateRangeCodec);
export const $basisOfRecord = urlAtom(codecs.setOf('basis', BASIS_OF_RECORD, { scope: 'map' }));
/** Only records filed at exactly the chosen taxa (e.g. gray wolf without domestic dogs). */
export const $exactTaxon = urlAtom(codecs.bool('exact', { scope: 'map' }));
export const $hasPhoto = urlAtom(codecs.bool('photo', { scope: 'map' }));
export const $hasSound = urlAtom(codecs.bool('sound', { scope: 'map' }));
export const $months = urlAtom(codecs.intSet('months', { min: 1, max: 12 }, { scope: 'map' }));
/** Months only combine with a range in whole years: Any time, "Last N years" or a years range. */
export const monthsAllowed = (r: DateRange | null): boolean =>
  !r || ('preset' in r ? r.preset.endsWith('y') : r.unit === 'y');
// Drop months the moment the range stops being in years, so no hidden filter stays applied.
$dateRange.subscribe((r) => {
  if (!monthsAllowed(r) && $months.get().length) $months.set([]);
});
export const $continents = urlAtom(codecs.setOf('continent', CONTINENTS, { scope: 'map' }));
export const $maxUncertainty = urlAtom({
  ...codecs.int('uncert', null, { scope: 'map' }),
  parse: (raw) => (UNCERTAINTY_STEPS_M as readonly number[]).find((m) => String(m) === raw),
});
export const $iucn = urlAtom(codecs.setOf('iucn', IUCN_CATEGORIES, { scope: 'map' }));
export type HexPoint = readonly [lng: number, lat: number] | null;

/**
 * Selected hex, stored as the clicked point ("lng,lat", 4 dp). Hex ids are
 * not stable across zooms, so MapCanvas re-resolves the cell under this point
 * at the URL's zoom and publishes its geometry to $hexGeometry.
 */
const hexCodec: UrlCodec<HexPoint> = {
  key: 'hex',
  default: null,
  scope: 'map',
  parse(raw) {
    const [lng, lat] = raw.split(',').map(Number);
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lat as number) > 90) return undefined;
    return [lng as number, lat as number];
  },
  serialize: (v) => `${v![0].toFixed(4)},${v![1].toFixed(4)}`,
};

export const $selectedHex = urlAtom(hexCodec);
export const $panel = urlAtom(codecs.enumOf('panel', PANELS, 'none', { scope: 'map' }));
export const $basemap = urlAtom(codecs.enumOf('base', BASEMAP_IDS, 'plain', { history: 'replace', scope: 'map' }));

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

/** The hex grid level on the map (lib/map/occGrid.ts): set by zooming, never by panning. The colour bins follow it. */
export const $gridLevel = atom(0);

/** Hex tile loading for the current burst, published by the map (`total` 0: nothing counted yet). */
export const $mapLoad = atom<{ loading: boolean; done: number; total: number }>({ loading: true, done: 0, total: 0 });

/** One-shot camera requests (place search, taxon extent). */
export const $flyTo = atom<FlyRequest | null>(null);

/** Clear the hex selection and anything that depends on it. */
export function clearHexSelection(): void {
  $selectedHex.set(null);
  $hexGeometry.set(null);
  if ($panel.get() === 'hex') $panel.set('none');
}

/* ---- Filters ---- */

/** The filter rail's groups (see components/vue/filterGroups.ts for labels and icons). */
export type FilterGroupId = 'what' | 'when' | 'where' | 'how';

/**
 * One URL-synced filter: the rail group it sits in, when it counts as set,
 * the OccurrenceFilter fields it contributes, its cleared value, and its
 * pills when set (none for taxa, which have their own chips).
 */
interface FilterDef<T> {
  store: WritableAtom<T>;
  group: FilterGroupId;
  cleared: T;
  isSet: (value: T) => boolean;
  apply: (value: T) => OccurrenceFilter;
  pills?: ((value: T) => FilterPill[]) | undefined;
}

/** A removable pill for (part of) a set filter. */
export interface FilterPill {
  text: string;
  clear: () => void;
}

/** A FilterDef with its value type erased, so filters of every type share one list. */
export interface Filter {
  store: ReadableAtom<unknown>;
  group: FilterGroupId;
  isSet: (value: unknown) => boolean;
  apply: (value: unknown) => OccurrenceFilter;
  pills?: ((value: unknown) => FilterPill[]) | undefined;
  clear: () => void;
}

function filter<T>(d: FilterDef<T>): Filter {
  return {
    store: d.store,
    group: d.group,
    isSet: (v) => d.isSet(v as T),
    apply: (v) => d.apply(v as T),
    pills: d.pills && ((v) => d.pills!(v as T)),
    clear: () => d.store.set(d.cleared),
  };
}

/** One pill for the whole filter: removing it clears the filter. */
const whole =
  <T>(store: WritableAtom<T>, cleared: T, label: (v: T) => string) =>
  (v: T): FilterPill[] => [{ text: label(v), clear: () => store.set(cleared) }];

/** A list filter shows one pill (`label`) or, with `{ each }`, one per item that removes just that item. */
const list = <T>(
  store: WritableAtom<T[]>,
  group: FilterGroupId,
  apply: (v: T[]) => OccurrenceFilter,
  label?: ((v: T[]) => string) | { each: (item: T) => string },
) =>
  filter({
    store,
    group,
    cleared: [],
    isSet: (v) => v.length > 0,
    apply,
    pills:
      label &&
      (typeof label === 'function'
        ? whole(store, [], label)
        : (v) =>
            v.map((item) => ({
              text: label.each(item),
              clear: () => store.set(store.get().filter((x) => x !== item)),
            }))),
  });
const flag = (store: WritableAtom<boolean>, group: FilterGroupId, fields: OccurrenceFilter, label: string) =>
  filter({
    store,
    group,
    cleared: false,
    isSet: (v) => v,
    apply: () => fields,
    pills: whole(store, false, () => label),
  });
const nullable = <T>(
  store: WritableAtom<T | null>,
  group: FilterGroupId,
  apply: (v: T) => OccurrenceFilter,
  label: (v: T) => string,
) =>
  filter({
    store,
    group,
    cleared: null,
    isSet: (v) => v !== null,
    apply: (v) => apply(v as T),
    pills: whole(store, null, (v) => label(v as T)),
  });

/**
 * Every filter, in one place: adding one here feeds the occurrence filter,
 * "clear all" and the rail's badge counts.
 */
export const FILTERS: readonly Filter[] = [
  list($taxonKeys, 'what', (taxonKeys) => ({ taxonKeys })),
  flag($exactTaxon, 'what', { exactTaxon: true }, 'Exact taxon only'),
  list($iucn, 'what', (iucn) => ({ iucn }), { each: (c) => IUCN_LABELS[c]! }),
  nullable($dateRange, 'when', (r) => rangeFilter(r), rangeLabel),
  list($months, 'when', (months) => ({ months }), { each: (m) => MONTHS[m - 1]! }),
  list(
    $continents,
    'where',
    (continents) => ({ continents }),
    (v) => v.map((c) => CONTINENT_LABELS[c]).join(', '),
  ),
  nullable(
    $maxUncertainty,
    'where',
    (maxUncertaintyM) => ({ maxUncertaintyM }),
    (m) => `Accuracy ≤ ${distance(m)}`,
  ),
  list(
    $basisOfRecord,
    'how',
    (basisOfRecord) => ({ basisOfRecord }),
    (v) => v.map((b) => BASIS_LABELS[b]).join(', '),
  ),
  flag($hasPhoto, 'how', { hasImage: true }, 'Has photo'),
  flag($hasSound, 'how', { hasSound: true }, 'Has sound'),
];

const filterValues = computed(
  FILTERS.map((f) => f.store),
  (...values: unknown[]) => values,
);

/** The URL filters as one OccurrenceFilter (only the ones that are set). */
export const $occurrenceFilter = computed(filterValues, (values): OccurrenceFilter => {
  const out: OccurrenceFilter = {};
  FILTERS.forEach((f, i) => {
    if (f.isSet(values[i])) Object.assign(out, f.apply(values[i]));
  });
  return out;
});

/** The set filters (other than taxa) as pills, with the rail group each sits in. */
export const $filterPills = computed(filterValues, (values) =>
  FILTERS.flatMap((f, i) =>
    f.pills && f.isSet(values[i]) ? f.pills(values[i]).map((p, j) => ({ ...p, id: `${i}-${j}`, group: f.group })) : [],
  ),
);

/** Filters set per rail group: one per pill (so each IUCN category), or one for taxa. */
export const $groupCounts = computed(filterValues, (values) => {
  const counts: Record<FilterGroupId, number> = { what: 0, when: 0, where: 0, how: 0 };
  FILTERS.forEach((f, i) => {
    if (f.isSet(values[i])) counts[f.group] += f.pills ? f.pills(values[i]).length : 1;
  });
  return counts;
});

/** Reset every filter, taxa included (one history step). */
export function clearFilters(): void {
  clearHexSelection();
  for (const f of FILTERS) f.clear();
}
