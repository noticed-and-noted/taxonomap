/**
 * A clicked hex answered from the cubes: whether it can be (a hex drawn from the cubes, under filters the
 * cubes hold), and a page of its records from the records index. Only types come from the reader, so
 * this loads with the panel without pulling in the Parquet code.
 */
import type { OccurrenceFilter } from '~/lib/gbif';
import { cellNumber, descendantRange, resolutionOf } from './cellBits';
import { listedRecords, matchesQuery } from './cellSummary';
import type { CubeSet } from './reader';
import { cubeQueryFor, type CubeQuery, type TaxonLookup } from './route';

/** The records index's cells: the cubes' finest resolution. */
const RECORD_RESOLUTION = 5;

/** A cell the cubes can answer for, and the slice of them the map's filters pick. */
export interface CubeCell {
  cubes: CubeSet;
  query: CubeQuery;
  cell: bigint;
  resolution: number;
}

/**
 * The cube cell for a selected hex, or null when GBIF should answer: no cubes open, a hex from GBIF's
 * tiles (no H3 cell), or filters the cubes don't hold.
 * @param cellId the hex's H3 cell, as hex text
 * @param lookup the app's taxon lookup (lookupTaxon)
 */
export async function cubeCellFor(
  cellId: string | undefined,
  filter: OccurrenceFilter,
  cubes: CubeSet | null,
  lookup: TaxonLookup,
): Promise<CubeCell | null> {
  const cell = cellId === undefined ? null : cellNumber(cellId);
  if (!cubes || cell === null) return null;
  // A clicked cell is never the whole world, so the zoom doesn't limit it.
  const query = await cubeQueryFor(filter, Infinity, lookup);
  return query && { cubes, query, cell, resolution: resolutionOf(cell) };
}

/** One page of a cell's records: GBIF keys in the index's order, and how many there are in all. */
export interface RecordPage {
  keys: number[];
  total: number;
}

/**
 * A page of the cell's records under the map's filters (and one species, if given), from the records
 * index. Row groups are read in order until the page is full; ones already read are kept by the reader.
 * @throws DOMException when `signal` aborts
 */
export async function recordPage(
  { cubes, query, cell, resolution }: CubeCell,
  speciesKey: number | null,
  page: { offset: number; limit: number },
  signal?: AbortSignal,
): Promise<RecordPage> {
  const total = listedRecords(await cubes.cellRows(cell, resolution), query, speciesKey);
  const keys: number[] = [];
  let skipped = 0;
  for await (const rows of cubes.recordRows(descendantRange(cell, RECORD_RESOLUTION))) {
    signal?.throwIfAborted();
    for (const row of rows) {
      if (!matchesQuery(row, query) || (speciesKey !== null && row.specieskey !== speciesKey)) continue;
      if (skipped++ < page.offset) continue;
      keys.push(Number(row.gbifid));
      if (keys.length === page.limit) return { keys, total };
    }
  }
  return { keys, total };
}
