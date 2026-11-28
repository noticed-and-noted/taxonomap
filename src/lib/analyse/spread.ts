/**
 * Spread: where and when a species was first recorded. GBIF's tiles hold one total per cell with no years, so the
 * spread is built from one whole-world tile per year (plus one for every year before the range): a cell's first year
 * is the year its running total reaches `MIN_RECORDS`. Each country's records over all years come from one GraphQL
 * request.
 */
import pLimit from 'p-limit';
import { $gbifStale, countRequest, countryYearCounts, worldTileUrl, type OccurrenceFilter } from '~/lib/gbif';
import { MIN_YEAR } from '~/lib/dates';
import { decodeOffThread } from '~/lib/map/hexDecoder';
import { mergeHexes, type Hex } from '~/lib/map/occGrid';

/** A cell or country counts from the year it has this many records, so one stray record doesn't mark an arrival. */
export const MIN_RECORDS = 2;
/** Hex cells across the world tile: about 200 km wide at the equator. */
const WORLD_HEX_PER_TILE = 200;
/** Requests in flight at once. */
const CONCURRENCY = 6;

/** Counts per place (a cell id or a country code). */
export type PlaceCounts = ReadonlyMap<string, number>;

/** Where a species' records are, cell by cell, and the year each cell was first recorded. */
export interface SpreadCells {
  hexes: ReadonlyMap<string, Hex>;
  /** A cell's first year; the year before the range for a cell recorded before it. */
  firstYears: ReadonlyMap<string, number>;
}

/**
 * The year each place's running total first reaches `MIN_RECORDS`.
 * @param before Counts from every year before `first`; places they already cover get the year `first - 1`.
 * @param byYear Counts for each year from `first`.
 */
export function firstYears(before: PlaceCounts, byYear: ReadonlyMap<number, PlaceCounts>, first: number) {
  const totals = new Map(before);
  const found = new Map<string, number>();
  for (const [place, total] of totals) if (total >= MIN_RECORDS) found.set(place, first - 1);
  const years = [...byYear.keys()].sort((left, right) => left - right);
  for (const year of years) {
    for (const [place, count] of byYear.get(year)!) {
      const total = (totals.get(place) ?? 0) + count;
      totals.set(place, total);
      if (total >= MIN_RECORDS && !found.has(place)) found.set(place, year);
    }
  }
  return found;
}

/**
 * How many places were first recorded in each year of the range, and how many were recorded before each.
 * @returns One entry per year from `first` to `last`.
 */
export function yearlyArrivals(found: ReadonlyMap<string, number>, first: number, last: number) {
  const arrivals = Array<number>(last - first + 1).fill(0);
  let earlier = 0;
  for (const year of found.values()) {
    if (year < first) earlier++;
    else if (year <= last) arrivals[year - first]!++;
  }
  return arrivals.map((added, index) => {
    const before = earlier;
    earlier += added;
    return { year: first + index, added, before };
  });
}

/** The cells to draw for a year: those first recorded in it ("new") and those recorded before it. */
export function spreadCollection(cells: SpreadCells, year: number): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const [id, firstYear] of cells.firstYears) {
    const isNew = firstYear === year;
    if (firstYear > year) continue;
    const hex = cells.hexes.get(id)!;
    features.push({ ...hex, properties: { id, firstYear, state: isNew ? 'new' : 'before' } });
  }
  return { type: 'FeatureCollection', features };
}

/** Records per cell in the world tile for `filter`. */
async function cellCounts(filter: OccurrenceFilter, signal: AbortSignal) {
  countRequest('tile');
  const response = await fetch(worldTileUrl(filter, WORLD_HEX_PER_TILE), { signal });
  if (response.status === 404) return [];
  if (!response.ok) {
    if (response.status === 429 || response.status >= 500) $gbifStale.set(true);
    throw new Error(`Spread tile failed (${response.status})`);
  }
  return decodeOffThread(await response.arrayBuffer(), { x: 0, y: 0 }, 0);
}

/** Records per cell id from a world tile's cells, each cell counted once. */
function cellTotals(cells: Hex[]): PlaceCounts {
  return new Map([...mergeHexes([cells]).values()].map((hex) => [hex.properties.id, hex.properties.total]));
}

/** The world tiles for the years before the range and for each year in it, a few at a time. */
async function cellsByYear(filter: OccurrenceFilter, [first, last]: readonly [number, number], signal: AbortSignal) {
  const limit = pLimit(CONCURRENCY);
  const years = Array.from({ length: last - first + 1 }, (_unused, index) => first + index);
  const [before, ...perYear] = await Promise.all([
    limit(() => cellCounts({ ...filter, year: [MIN_YEAR, first - 1] }, signal)),
    ...years.map((year) => limit(() => cellCounts({ ...filter, year: [year, year] }, signal))),
  ]);
  return { before: before!, byYear: new Map(years.map((year, index) => [year, perYear[index]!])) };
}

/** Each cell's first year in the range, for a filter without years. */
export async function loadSpreadCells(filter: OccurrenceFilter, range: readonly [number, number], signal: AbortSignal) {
  const { before, byYear } = await cellsByYear(filter, range, signal);
  const hexes = mergeHexes([before, ...byYear.values()]);
  const yearTotals = new Map([...byYear].map(([year, cells]) => [year, cellTotals(cells)]));
  return { hexes, firstYears: firstYears(cellTotals(before), yearTotals, range[0]) } satisfies SpreadCells;
}

/** A country's records of the species: how many, and the year of the first (null when none has a year). */
export interface CountryRecords {
  code: string;
  count: number;
  firstYear: number | null;
}

/** Every country's records matching a filter, over all years whatever the filter's own (ISO codes). */
export async function loadCountryRecords(filter: OccurrenceFilter, signal: AbortSignal): Promise<CountryRecords[]> {
  const { year: _years, ...allYears } = filter;
  const counts = await countryYearCounts(allYears, { signal });
  return [...counts].map(([code, { count, years }]) => ({
    code,
    count,
    firstYear: years.size ? Math.min(...years.keys()) : null,
  }));
}
