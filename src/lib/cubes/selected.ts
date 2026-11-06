/**
 * The selected hex (or Near me's circle) as the panels see it in cube mode: a cube area, its records as
 * GBIF's search would list them (found by key), and species counts for the records tab's search. Cube mode never falls back
 * to GBIF's searches. The year chart and search previews count from the charts cube.
 */
import { occurrencesByKeys, type Occurrence, type OccurrenceFilter } from '~/lib/gbif';
import { $cubesOn, openedCubes } from '~/stores/cubes';
import type { HexGeometry } from '~/stores/explorer';
import { lookupTaxonRank } from '~/stores/taxon';
import { areaRows, cubeCellFor, recordPage, type CubeArea } from './cell';
import { speciesCounts } from './cellSummary';
import { taxonTotal, yearCounts } from './charts';
import { nearArea, type NearCircle } from './near';
import { CUBE_RANKS, cubeQueryFor, type CubeRank } from './route';

/**
 * The selected hex as a cube area in cube mode, or null outside it, where GBIF answers for it.
 * @throws Error in cube mode when the cubes can't answer for the hex (not open yet, or a taxon they lack)
 */
export async function selectedCubeArea(
  hexGeometry: Pick<HexGeometry, 'cell'>,
  filter: OccurrenceFilter,
): Promise<CubeArea | null> {
  if (!$cubesOn.get()) return null;
  const area = await cubeCellFor(hexGeometry.cell, filter, await openedCubes(), lookupTaxonRank);
  if (!area) throw new Error('The cube demo has no data for this hex');
  return area;
}

/**
 * Near me's circle as a cube area in cube mode, or null outside it, where GBIF answers for it.
 * @throws Error in cube mode when the cubes can't answer (not open, or a taxon they lack)
 */
export async function nearCubeArea(circle: NearCircle, filter: OccurrenceFilter): Promise<CubeArea | null> {
  if (!$cubesOn.get()) return null;
  const area = await nearArea(circle, filter, await openedCubes(), lookupTaxonRank);
  if (!area) throw new Error('The cube demo has no data for this taxon');
  return area;
}

/**
 * Records per year for the time slider in cube mode, or null outside it.
 * @throws Error in cube mode when the cubes can't answer (not open, or a taxon they lack)
 */
export async function cubeYearCounts(filter: OccurrenceFilter): Promise<[number, number][] | null> {
  if (!$cubesOn.get()) return null;
  const [cubes, query] = await Promise.all([openedCubes(), cubeQueryFor(filter, lookupTaxonRank)]);
  if (!query) throw new Error('The cube demo has no data for this taxon');
  return yearCounts(cubes, query);
}

/**
 * A taxon's records for the search preview in cube mode, or null outside it (or for a rank the cubes
 * don't hold, which the preview then leaves without a count).
 */
export async function cubeTaxonTotal(taxon: { scientificName: string; rank: string }): Promise<number | null> {
  const rank = taxon.rank.toLowerCase() as CubeRank;
  if (!$cubesOn.get() || !CUBE_RANKS.includes(rank)) return null;
  return taxonTotal(await openedCubes(), { rank, taxon: taxon.scientificName });
}

/**
 * A page of a cube area's records: their keys from the records index, then the records themselves from
 * GBIF in one lookup by key, in the index's order.
 * @returns the page's records and how many the area lists in all
 * @throws Error when the cubes can't be read, GbifRequestError when GBIF can't answer
 */
export async function cubeRecords(
  area: CubeArea,
  speciesKey: number | null,
  page: { offset: number; limit: number },
  signal?: AbortSignal,
): Promise<{ results: Occurrence[]; count: number }> {
  const { keys, total } = await recordPage(area, speciesKey, page, signal);
  return { results: await occurrencesByKeys(keys, signal), count: total };
}

/**
 * Records of each of the given species in a cube area, scaled for a sample: the records tab's species
 * search, for species outside the listed ones.
 * @returns counts by species key, for the species with records there
 */
export async function speciesInArea(area: CubeArea, keys: readonly number[]): Promise<Map<number, number>> {
  const wanted = new Set(keys);
  const rows = (await areaRows(area)).filter((row) => row.specieskey !== null && wanted.has(row.specieskey));
  const counts = speciesCounts(rows, area.query, area.cubes.scale, { limit: keys.length });
  return new Map(counts.map((facet) => [Number(facet.name), facet.count]));
}
