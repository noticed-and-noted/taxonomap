/**
 * The selected hex as the cell panel sees it: a cube cell when the cube setting is on and the cubes can
 * answer for it, and its records as GBIF's search would list them, found by key.
 */
import { occurrencesByKeys, type Occurrence, type OccurrenceFilter } from '~/lib/gbif';
import { $cubesOn, $openCubes } from '~/stores/cubes';
import type { HexGeometry } from '~/stores/explorer';
import { lookupTaxon } from '~/stores/taxon';
import { cubeCellFor, recordPage, type CubeCell } from './cell';

/**
 * The selected hex as a cube cell, or null when GBIF should answer for it.
 * @throws when the taxon lookup fails
 */
export function selectedCubeCell(
  hexGeometry: Pick<HexGeometry, 'cell'>,
  filter: OccurrenceFilter,
): Promise<CubeCell | null> {
  const cubes = $cubesOn.get() ? $openCubes.get() : null;
  return cubeCellFor(hexGeometry.cell, filter, cubes, lookupTaxon);
}

/**
 * A page of a cube cell's records: their keys from the records index, then the records themselves from
 * GBIF in one lookup by key, in the index's order.
 * @returns the page's records and how many the cell lists in all
 * @throws Error when the cubes can't be read, GbifRequestError when GBIF can't answer
 */
export async function cubeRecords(
  cubeCell: CubeCell,
  speciesKey: number | null,
  page: { offset: number; limit: number },
  signal?: AbortSignal,
): Promise<{ results: Occurrence[]; count: number }> {
  const { keys, total } = await recordPage(cubeCell, speciesKey, page, signal);
  return { results: await occurrencesByKeys(keys, signal), count: total };
}
