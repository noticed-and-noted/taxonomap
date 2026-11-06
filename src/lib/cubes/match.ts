/**
 * Whether a cube row falls under a query: its taxa (any of them) and the filters every cube holds.
 * The map, the cell panel, the records list and Near me all filter rows with these.
 */
import type { FilterRow, TaxonPathRow } from './reader';
import type { CubeFilters, CubeTaxon } from './route';

/** Whether a row falls under the years, months, record types and media asked for. */
export function matchesFilters(row: FilterRow, filters: CubeFilters): boolean {
  if (filters.year) {
    const [from, to] = filters.year;
    if (row.year === null || row.year < from || row.year > to) return false;
  }
  if (filters.months && (row.month === null || !filters.months.includes(row.month))) return false;
  if (filters.basis && (row.basisofrecord === null || !filters.basis.includes(row.basisofrecord))) return false;
  return !filters.media || (row.media & filters.media) !== 0;
}

/** Whether the filters need the cubes' month, record type or media columns (else the lean map cube will do). */
export function needsFilterColumns(filters: CubeFilters): boolean {
  return !!(filters.months || filters.basis || filters.media);
}

/** Whether a row with a full taxon path falls under any of the taxa. */
export function matchesTaxa(row: TaxonPathRow, taxa: readonly CubeTaxon[]): boolean {
  return taxa.some(({ rank, taxon }) => rank === 'life' || row[rank] === taxon);
}

/** Whether a row with a full taxon path falls under the whole query. */
export function matchesQuery(row: TaxonPathRow & FilterRow, query: CubeFilters & { taxa: readonly CubeTaxon[] }) {
  return matchesTaxa(row, query.taxa) && matchesFilters(row, query);
}
