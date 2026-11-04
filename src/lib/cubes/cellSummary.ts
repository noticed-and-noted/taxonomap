/**
 * A clicked cell's panel from its cell-cube rows, with no request: the record count, records per month,
 * the classes and the top species, under the map's taxon and year filter. Counts come out in the shape
 * GBIF's facets have, so the panel names and shows them as it does GBIF's.
 */
import type { NamedFacetCount } from '~/lib/gbif/graphql';
import type { CellRow, TaxonPathRow } from './reader';
import type { CubeQuery } from './route';

const MONTHS = 12;

/** Whether a row falls under the query's taxon and years. */
export function matchesQuery(row: TaxonPathRow, query: CubeQuery): boolean {
  if (query.rank !== 'life' && row[query.rank] !== query.taxon) return false;
  if (!query.year) return true;
  const [from, to] = query.year;
  return row.year !== null && row.year >= from && row.year <= to;
}

/** Counts by key, largest first, the first `limit` of them, scaled up for a sample. */
function topCounts(totals: Map<string, { count: number; label: string }>, limit: number, scale: number) {
  return [...totals.entries()]
    .sort(([, left], [, right]) => right.count - left.count)
    .slice(0, limit)
    .map(([name, { count, label }]): NamedFacetCount => ({ name, count: Math.round(count * scale), label }));
}

/** Adds a row's records to a key's total. */
function addTo(totals: Map<string, { count: number; label: string }>, key: string, label: string, records: number) {
  const total = totals.get(key);
  if (total) total.count += records;
  else totals.set(key, { count: records, label });
}

/** What the panel shows for a cell. */
export interface CellSummary {
  count: number;
  /** Records per calendar month, January first. */
  months: number[];
  /** Records per class, as a classKey facet (keys from `classKeyOf`, the class name as its label). */
  classes: NamedFacetCount[];
  /** Records per species, as a speciesKey facet. */
  species: NamedFacetCount[];
}

/**
 * Summarise a cell's rows under a query.
 * @param scale what to multiply counts by (above 1 for a sample)
 * @param classKeyOf a class name's GBIF key
 * @param limits how many classes and species to keep, most recorded first
 */
export function summariseCell(
  rows: readonly CellRow[],
  query: CubeQuery,
  scale: number,
  classKeyOf: (name: string) => number,
  limits: { classes: number; species: number },
): CellSummary {
  const months = Array<number>(MONTHS).fill(0);
  const classes = new Map<string, { count: number; label: string }>();
  let count = 0;
  for (const row of rows) {
    if (!matchesQuery(row, query)) continue;
    const records = Number(row.records);
    count += records;
    if (row.month) months[row.month - 1]! += records;
    if (row.class) addTo(classes, String(classKeyOf(row.class)), row.class, records);
  }
  return {
    count: Math.round(count * scale),
    months: months.map((records) => Math.round(records * scale)),
    classes: topCounts(classes, limits.classes, scale),
    species: speciesCounts(rows, query, scale, { limit: limits.species }),
  };
}

/**
 * Records per species in a cell under a query, most recorded first, as a speciesKey facet.
 * @param options `limit` on rows, and `className` to keep one class's species
 */
export function speciesCounts(
  rows: readonly CellRow[],
  query: CubeQuery,
  scale: number,
  options: { limit: number; className?: string },
): NamedFacetCount[] {
  const species = new Map<string, { count: number; label: string }>();
  for (const row of rows) {
    if (row.specieskey === null || !row.species || !matchesQuery(row, query)) continue;
    if (options.className !== undefined && row.class !== options.className) continue;
    addTo(species, String(row.specieskey), row.species, Number(row.records));
  }
  return topCounts(species, options.limit, scale);
}

/** The records a cell holds under a query (and for one species), unscaled: the rows the records index lists. */
export function listedRecords(rows: readonly CellRow[], query: CubeQuery, speciesKey: number | null): number {
  return rows
    .filter((row) => matchesQuery(row, query) && (speciesKey === null || row.specieskey === speciesKey))
    .reduce((total, row) => total + Number(row.records), 0);
}
