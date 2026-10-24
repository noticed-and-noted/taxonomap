import type { TreeNodeRow, TreeSnapshot } from '~/lib/data/types';
import { CODE_BY_RANK } from '~/lib/data/ranks';
import { englishName } from '~/lib/species/names';
import { countedFacets, countedSpeciesCounts, listAllByRank, once, snapshotMeta, type NamedUsage } from './cache';

const TREE_RANKS = ['KINGDOM', 'PHYLUM', 'CLASS', 'ORDER'] as const;
const TREE_FIELDS = ['kingdomKey', 'phylumKey', 'classKey', 'orderKey'] as const;
const TREE_FACET_LIMITS = { kingdomKey: 20, phylumKey: 400, classKey: 2000, orderKey: 5000 };
const SPECIES_COUNT_FACET_LIMIT = 20_000;

/** Record counts by taxon key for every tree rank, from one occurrence facet request. */
async function recordCounts(): Promise<Map<number, number>> {
  const occurrences = await countedFacets({}, TREE_FIELDS, { limits: TREE_FACET_LIMITS });
  const records = new Map<number, number>();
  for (const field of TREE_FIELDS) {
    for (const facet of occurrences.facets[field] ?? []) records.set(Number(facet.name), facet.count);
  }
  return records;
}

/** Species counts by taxon key under each kingdom (one facet request per kingdom). */
async function speciesCounts(kingdoms: readonly NamedUsage[]): Promise<Map<number, number>> {
  const species = new Map<number, number>();
  for (const kingdom of kingdoms) {
    const counts = await countedSpeciesCounts(kingdom.key, SPECIES_COUNT_FACET_LIMIT);
    for (const [key, count] of counts) species.set(key, count);
  }
  return species;
}

/** The key of a usage's parent in the tree: phylum → kingdom, class → phylum, order → class (or phylum). */
function parentKeyOf(usage: NamedUsage): number | undefined {
  if (usage.rank === 'PHYLUM') return usage.kingdomKey;
  if (usage.rank === 'CLASS') return usage.phylumKey;
  if (usage.rank === 'ORDER') return usage.classKey ?? usage.phylumKey;
  return undefined;
}

/** A compact tree row for a usage, or null for ranks outside the tree and taxa with no records or species. */
function toTreeRow(usage: NamedUsage, records: ReadonlyMap<number, number>, species: ReadonlyMap<number, number>) {
  const rank = (TREE_RANKS as readonly string[]).includes(usage.rank) ? CODE_BY_RANK[usage.rank] : undefined;
  const recordCount = records.get(usage.key) ?? 0;
  const speciesCount = species.get(usage.key) ?? (recordCount > 0 ? 1 : 0);
  if (!rank || (recordCount === 0 && speciesCount === 0)) return null;

  const parent = parentKeyOf(usage);
  const common = englishName(usage.vernacularNames ?? [], usage.key);
  const row: TreeNodeRow = {
    k: usage.key,
    n: usage.canonicalName ?? usage.scientificName,
    r: rank,
    o: recordCount,
    s: speciesCount,
    ...(common && { c: common }),
    ...(parent !== undefined && { p: parent }),
  };
  return row;
}

/**
 * Upper four ranks with record and species counts. Requests: one occurrence
 * facet request, ~6 paged name listings (shared with the name index), and one
 * species-count facet per kingdom. Orders with very few species may fall
 * outside the species facet limit; they get a floor of 1.
 */
export function bakeTree(): Promise<TreeSnapshot> {
  return once('tree', async () => {
    const records = await recordCounts();
    const usages = await listAllByRank(TREE_RANKS);
    const species = await speciesCounts(usages.filter((usage) => usage.rank === 'KINGDOM'));

    const nodes = usages.flatMap((usage) => toTreeRow(usage, records, species) ?? []);
    // Drop nodes whose parent is missing (e.g. unplaced taxa without counts).
    const keys = new Set(nodes.map((node) => node.k));
    return { ...snapshotMeta(), nodes: nodes.filter((node) => node.p === undefined || keys.has(node.p)) };
  });
}
