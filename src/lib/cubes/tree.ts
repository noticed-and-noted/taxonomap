/**
 * Record counts for the tree of life from the charts cube, in cube mode: whole ranks at once for the
 * baked top levels (kingdom to order, a few small files), and a node's children when it's opened (a
 * genus's species in one read, as their names sort together). Counts from a sample are scaled.
 */
import type { ChartRow, CubeSet } from './reader';
import type { CubeRank } from './route';

/** The tree's rank codes as the cubes' ranks. */
export const CUBE_RANK_OF = {
  K: 'kingdom',
  P: 'phylum',
  C: 'class',
  O: 'order',
  F: 'family',
  G: 'genus',
  S: 'species',
} as const satisfies Record<string, CubeRank>;

/** The last character a name can sort before, so a range from "Turdus " to "Turdus ￿" holds its species. */
const LAST_CHARACTER = '￿';

/** A count's key: the same name can be used in two kingdoms. */
export const countKey = (kingdom: string | null, name: string) => `${kingdom ?? ''}\u0000${name}`;

/** Records per kingdom and name, scaled. */
function totalsOf(rows: readonly ChartRow[], scale: number): Map<string, number> {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const key = countKey(row.kingdom, row.taxon);
    totals.set(key, (totals.get(key) ?? 0) + Number(row.records));
  }
  for (const [key, total] of totals) totals.set(key, Math.round(total * scale));
  return totals;
}

/** Records of every taxon at a rank, by kingdom and name. */
export async function rankTotals(cubes: CubeSet, rank: CubeRank): Promise<Map<string, number>> {
  return totalsOf(await cubes.chartRowsBetween(rank, '', LAST_CHARACTER), cubes.scale);
}

/**
 * Records of some taxa at one rank (a node's children), by kingdom and name.
 * @param genus for species, their genus: its species are read in one go
 */
export async function namedTotals(
  cubes: CubeSet,
  rank: CubeRank,
  names: readonly string[],
  genus?: string,
): Promise<Map<string, number>> {
  if (rank === 'species' && genus) {
    return totalsOf(await cubes.chartRowsBetween(rank, `${genus} `, `${genus} ${LAST_CHARACTER}`), cubes.scale);
  }
  const rows = await Promise.all(names.map((taxon) => cubes.chartRows({ rank, taxon })));
  return totalsOf(rows.flat(), cubes.scale);
}
