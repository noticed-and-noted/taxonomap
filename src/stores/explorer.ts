/**
 * Shared explorer state. Every field lives in the URL (see url-sync.ts), so
 * any view is reproducible from its link and the back button works.
 */
import { atom, computed, type ReadableAtom, type WritableAtom } from 'nanostores';
import { BASEMAP_IDS } from '~/lib/basemaps';
import { parseRange, rangeFilter, rangeLabel, serializeRange, type DateRange } from '~/lib/dates';
import { BASIS_LABELS, CONTINENT_LABELS, distance, IUCN_LABELS, MONTHS } from '~/lib/format';
import type { BasisOfRecord, Continent, IucnCategory, OccurrenceFilter } from '~/lib/gbif';
import type { ScreenBox } from '~/lib/tour';
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
  serialize: (position) => `${position![0].toFixed(4)},${position![1].toFixed(4)}`,
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

/** Set by the map when the browser has no WebGL2, so the map can't draw at all. */
export const $mapUnsupported = atom(false);

/** One-shot camera requests (place search, taxon extent). */
export const $flyTo = atom<FlyRequest | null>(null);

/**
 * Tour and hint hook: MapCanvas finds the busiest hex in view and answers on
 * $busiestHexBox before this returns. 'select' also selects it (its panel
 * stays closed); 'locate' only points at it.
 */
export const $busiestHexRequest = atom<'select' | 'locate' | null>(null);

/** Where the hex picked for $busiestHexRequest sits on screen; null when no cell was loaded. */
export const $busiestHexBox = atom<ScreenBox | null>(null);

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

function filter<T>(definition: FilterDef<T>): Filter {
  return {
    store: definition.store,
    group: definition.group,
    isSet: (value) => definition.isSet(value as T),
    apply: (value) => definition.apply(value as T),
    pills: definition.pills && ((value) => definition.pills!(value as T)),
    clear: () => definition.store.set(definition.cleared),
  };
}

/** One pill for the whole filter: removing it clears the filter. */
const whole =
  <T>(store: WritableAtom<T>, cleared: T, label: (value: T) => string) =>
  (value: T): FilterPill[] => [{ text: label(value), clear: () => store.set(cleared) }];

/** A list filter shows one pill (`label`) or, with `{ each }`, one per item that removes just that item. */
const list = <T>(
  store: WritableAtom<T[]>,
  group: FilterGroupId,
  apply: (values: T[]) => OccurrenceFilter,
  label?: ((values: T[]) => string) | { each: (item: T) => string },
) =>
  filter({
    store,
    group,
    cleared: [],
    isSet: (value) => value.length > 0,
    apply,
    pills:
      label &&
      (typeof label === 'function'
        ? whole(store, [], label)
        : (value) =>
            value.map((item) => ({
              text: label.each(item),
              clear: () => store.set(store.get().filter((existing) => existing !== item)),
            }))),
  });
const flag = (store: WritableAtom<boolean>, group: FilterGroupId, fields: OccurrenceFilter, label: string) =>
  filter({
    store,
    group,
    cleared: false,
    isSet: (value) => value,
    apply: () => fields,
    pills: whole(store, false, () => label),
  });
const nullable = <T>(
  store: WritableAtom<T | null>,
  group: FilterGroupId,
  apply: (value: T) => OccurrenceFilter,
  label: (value: T) => string,
) =>
  filter({
    store,
    group,
    cleared: null,
    isSet: (value) => value !== null,
    apply: (value) => apply(value as T),
    pills: whole(store, null, (value) => label(value as T)),
  });

/**
 * Every filter, in one place: adding one here feeds the occurrence filter,
 * "clear all" and the rail's badge counts.
 */
export const FILTERS: readonly Filter[] = [
  list($taxonKeys, 'what', (taxonKeys) => ({ taxonKeys })),
  flag($exactTaxon, 'what', { exactTaxon: true }, 'Exact taxon only'),
  list($iucn, 'what', (iucn) => ({ iucn }), { each: (code) => IUCN_LABELS[code]! }),
  nullable($dateRange, 'when', (range) => rangeFilter(range), rangeLabel),
  list($months, 'when', (months) => ({ months }), { each: (month) => MONTHS[month - 1]! }),
  list(
    $continents,
    'where',
    (continents) => ({ continents }),
    (values) => values.map((continent) => CONTINENT_LABELS[continent]).join(', '),
  ),
  nullable(
    $maxUncertainty,
    'where',
    (maxUncertaintyM) => ({ maxUncertaintyM }),
    (metres) => `Accuracy ≤ ${distance(metres)}`,
  ),
  list(
    $basisOfRecord,
    'how',
    (basisOfRecord) => ({ basisOfRecord }),
    (values) => values.map((basis) => BASIS_LABELS[basis]).join(', '),
  ),
  flag($hasPhoto, 'how', { hasImage: true }, 'Has photo'),
  flag($hasSound, 'how', { hasSound: true }, 'Has sound'),
];

const filterValues = computed(
  FILTERS.map((filterDef) => filterDef.store),
  (...values: unknown[]) => values,
);

/** The URL filters as one OccurrenceFilter (only the ones that are set). */
export const $occurrenceFilter = computed(filterValues, (values): OccurrenceFilter => {
  const out: OccurrenceFilter = {};
  FILTERS.forEach((filterDef, index) => {
    if (filterDef.isSet(values[index])) Object.assign(out, filterDef.apply(values[index]));
  });
  return out;
});

/** The set filters (other than taxa) as pills, with the rail group each sits in. */
export const $filterPills = computed(filterValues, (values) =>
  FILTERS.flatMap((filterDef, index) =>
    filterDef.pills && filterDef.isSet(values[index])
      ? filterDef
          .pills(values[index])
          .map((pill, pillIndex) => ({ ...pill, id: `${index}-${pillIndex}`, group: filterDef.group }))
      : [],
  ),
);

/** How many selections a set filter adds to its group's badge: one per pill, or per taxon (taxa have no pills). */
function selectionCount(filterDef: Filter, value: unknown): number {
  return filterDef.pills ? filterDef.pills(value).length : (value as readonly number[]).length;
}

export const $groupCounts = computed(filterValues, (values) => {
  const counts: Record<FilterGroupId, number> = { what: 0, when: 0, where: 0, how: 0 };
  FILTERS.forEach((filterDef, index) => {
    if (filterDef.isSet(values[index])) counts[filterDef.group] += selectionCount(filterDef, values[index]);
  });
  return counts;
});

/** Reset every filter, taxa included (one history step). */
export function clearFilters(): void {
  clearHexSelection();
  for (const filterDef of FILTERS) filterDef.clear();
}
