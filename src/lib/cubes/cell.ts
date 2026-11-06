/**
 * An area answered from the cubes: a clicked hex (one cell) or Near me's circle (the cells inside it),
 * its cell-cube rows, and a page of its records from the records index. Only types come from the
 * reader, so this loads with the panel without pulling in the Parquet code.
 */
import type { OccurrenceFilter } from '~/lib/gbif';
import { cellNumber, descendantRange, mergeRanges, RECORD_RESOLUTION, resolutionOf } from './cellBits';
import { listedRecords } from './cellSummary';
import { matchesQuery } from './match';
import type { CellRow, CubeSet, RecordRow } from './reader';
import { cubeQueryFor, type CubeQuery, type TaxonLookup } from './route';

/** Cells the cubes answer for, all at one resolution, and the slice of them the map's filters pick. */
export interface CubeArea {
  cubes: CubeSet;
  query: CubeQuery;
  cells: readonly bigint[];
  resolution: number;
}

/**
 * The cube area for a selected hex, or null when there's none to read: no cubes open, a hex from
 * GBIF's tiles (no H3 cell), or a taxon the cubes don't hold.
 * @param cellId the hex's H3 cell, as hex text
 * @param lookup the app's taxon lookup (lookupTaxon)
 */
export async function cubeCellFor(
  cellId: string | undefined,
  filter: OccurrenceFilter,
  cubes: CubeSet | null,
  lookup: TaxonLookup,
): Promise<CubeArea | null> {
  const cell = cellId === undefined ? null : cellNumber(cellId);
  if (!cubes || cell === null) return null;
  const query = await cubeQueryFor(filter, lookup);
  return query && { cubes, query, cells: [cell], resolution: resolutionOf(cell) };
}

/** Every cell-cube row of an area's cells. */
export async function areaRows({ cubes, cells, resolution }: CubeArea): Promise<CellRow[]> {
  return (await Promise.all(cells.map((cell) => cubes.cellRows(cell, resolution)))).flat();
}

/** One page of an area's records: GBIF keys in the index's order, and how many there are in all. */
export interface RecordPage {
  keys: number[];
  total: number;
}

/**
 * A page of the area's records under the map's filters (and one species, if given), from the records
 * index. Row groups are read in order until the page is full; ones already read are kept by the reader.
 * @throws DOMException when `signal` aborts
 */
export async function recordPage(
  area: CubeArea,
  speciesKey: number | null,
  page: { offset: number; limit: number },
  signal?: AbortSignal,
): Promise<RecordPage> {
  const total = listedRecords(await areaRows(area), area.query, speciesKey);
  const collector = pageCollector(area, speciesKey, page);
  for (const range of mergeRanges(area.cells.map((cell) => descendantRange(cell, RECORD_RESOLUTION)))) {
    for await (const rows of area.cubes.recordRows(range)) {
      signal?.throwIfAborted();
      if (collector.take(rows)) return { keys: collector.keys, total };
    }
  }
  return { keys: collector.keys, total };
}

/** Gathers a page's keys from row groups in order: `take` adds a group's matching rows, true once full. */
function pageCollector({ query }: CubeArea, speciesKey: number | null, page: { offset: number; limit: number }) {
  const keys: number[] = [];
  let skipped = 0;
  const matches = (row: RecordRow) =>
    matchesQuery(row, query) && (speciesKey === null || row.specieskey === speciesKey);
  return {
    keys,
    take(rows: readonly RecordRow[]) {
      for (const row of rows) {
        if (!matches(row) || skipped++ < page.offset) continue;
        keys.push(Number(row.gbifid));
        if (keys.length === page.limit) return true;
      }
      return false;
    },
  };
}
