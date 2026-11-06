/**
 * A species page's numbers from the charts cube, in cube mode: the record count, records per year and
 * per month, and the genus's other species by records. Top countries and datasets aren't in any cube, so
 * the page greys them out. Counts from a sample are scaled.
 */
import type { NameUsage } from '~/lib/gbif';
import { countKey, namedTotals } from './tree';
import { CUBE_RANKS, type CubeRank, type CubeTaxon } from './route';
import type { CubeSet } from './reader';

const MONTHS = 12;

/** A species page's counts. */
export interface SpeciesCounts {
  count: number;
  /** [year, records], oldest first. */
  years: [number, number][];
  /** Records per calendar month, January first. */
  months: number[];
}

/** A taxon's rank as the cubes name it, or null for one they don't hold (a subspecies, say). */
export function cubeRankOf(usage: Pick<NameUsage, 'rank'>): CubeRank | null {
  const rank = usage.rank.toLowerCase() as CubeRank;
  return CUBE_RANKS.includes(rank) ? rank : null;
}

/** The name the cubes key a taxon on. */
export const cubeNameOf = (usage: Pick<NameUsage, 'canonicalName' | 'scientificName'>) =>
  usage.canonicalName ?? usage.scientificName;

/**
 * A species page's taxon as the cubes name it, with its kingdom (for names used in two), or undefined
 * for a rank they don't hold.
 */
export function cubeTaxonOf(page: {
  rank: NameUsage['rank'];
  canonicalName: string;
  classification: readonly { name: string; rank: NameUsage['rank'] }[];
}): (CubeTaxon & { kingdom?: string }) | undefined {
  const rank = cubeRankOf(page);
  if (!rank) return undefined;
  const kingdom =
    rank === 'kingdom' ? page.canonicalName : page.classification.find((ref) => ref.rank === 'KINGDOM')?.name;
  return { rank, taxon: page.canonicalName, ...(kingdom && { kingdom }) };
}

/** A taxon's record count, years and months; all zero for a rank the cubes don't hold. */
export async function speciesCounts(cubes: CubeSet, usage: NameUsage): Promise<SpeciesCounts> {
  const rank = cubeRankOf(usage);
  const rows = rank ? await cubes.chartRows({ rank, taxon: cubeNameOf(usage) }) : [];
  const years = new Map<number, number>();
  const months = Array<number>(MONTHS).fill(0);
  let count = 0;
  for (const row of rows) {
    if (rank !== 'kingdom' && usage.kingdom && row.kingdom !== usage.kingdom) continue;
    const records = Number(row.records);
    count += records;
    if (row.year !== null) years.set(row.year, (years.get(row.year) ?? 0) + records);
    if (row.month) months[row.month - 1]! += records;
  }
  const scaled = (records: number) => Math.round(records * cubes.scale);
  return {
    count: scaled(count),
    years: [...years].sort(([left], [right]) => left - right).map(([year, records]) => [year, scaled(records)]),
    months: months.map(scaled),
  };
}

/**
 * The genus's other species, most recorded first.
 * @param children the genus's species from GBIF's taxonomy (names and keys; counting is the cubes')
 * @returns at most `limit`, leaving out the page's own species and any without records
 */
export async function siblingCounts(
  cubes: CubeSet,
  usage: NameUsage,
  children: readonly Pick<NameUsage, 'key' | 'canonicalName' | 'scientificName'>[],
  limit: number,
): Promise<{ key: number; scientificName: string; count: number }[]> {
  if (!usage.genus) return [];
  const totals = await namedTotals(cubes, 'species', children.map(cubeNameOf), usage.genus);
  return children
    .map((child) => ({
      key: child.key,
      scientificName: cubeNameOf(child),
      count: totals.get(countKey(usage.kingdom ?? null, cubeNameOf(child))) ?? 0,
    }))
    .filter((sibling) => sibling.key !== usage.key && sibling.count > 0)
    .sort((left, right) => right.count - left.count)
    .slice(0, limit);
}
