/**
 * Sums over the charts cube, which counts every record (with or without coordinates) by taxon and the
 * filters: records per year for the time slider, and a taxon's total for the search preview. Counts
 * from a sample are scaled to estimate the whole snapshot.
 */
import { matchesFilters } from './match';
import type { ChartRow, CubeSet } from './reader';
import type { CubeQuery, CubeTaxon } from './route';

/** Every charts-cube row of the query's taxa. */
async function rowsFor(cubes: CubeSet, taxa: readonly CubeTaxon[]): Promise<ChartRow[]> {
  return (await Promise.all(taxa.map((taxon) => cubes.chartRows(taxon)))).flat();
}

/**
 * Records per year under the query's filters, leaving out its year range (the slider shows every year).
 * @returns [year, records] pairs, oldest first
 */
export async function yearCounts(cubes: CubeSet, query: CubeQuery): Promise<[number, number][]> {
  const filters = { ...query, year: null };
  const years = new Map<number, number>();
  for (const row of await rowsFor(cubes, query.taxa)) {
    if (row.year === null || !matchesFilters(row, filters)) continue;
    years.set(row.year, (years.get(row.year) ?? 0) + Number(row.records));
  }
  return [...years]
    .sort(([left], [right]) => left - right)
    .map(([year, records]): [number, number] => [year, Math.round(records * cubes.scale)]);
}

/** All of a taxon's records, scaled to the whole snapshot. */
export async function taxonTotal(cubes: CubeSet, taxon: CubeTaxon): Promise<number> {
  const rows = await rowsFor(cubes, [taxon]);
  return Math.round(rows.reduce((total, row) => total + Number(row.records), 0) * cubes.scale);
}
