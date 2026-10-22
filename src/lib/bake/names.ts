import { getSpecies, getVernacularNames, occurrenceFacets } from '~/lib/gbif/server';
import type { NameRow, NamesSnapshot } from '~/lib/data/types';
import { CODE_BY_RANK } from '~/lib/data/ranks';
import { isDev } from '~/lib/env';
import { resolveInatIds } from '~/lib/photos/taxon-photos';
import { englishName } from '~/lib/species/names';
import { listAllByRank, lookupLimit, once, rethrowUnlessMissing, snapshotMeta, type NamedUsage } from './cache';

const DEFAULT_INDEX_SIZE = 6000;
const DEV_INDEX_SIZE = 300;
const HIGHER_RANK_FIELDS = ['kingdomKey', 'phylumKey', 'classKey', 'orderKey', 'familyKey'] as const;
const HIGHER_RANK_FACET_LIMIT = 3000;
const BULK_NAMED_RANKS = ['KINGDOM', 'PHYLUM', 'CLASS', 'ORDER'] as const;
const FAMILIES_IN_INDEX = 400;
const DEV_FAMILIES_IN_INDEX = 40;
/** Higher taxa with fewer records than this are not worth a search suggestion. */
const MIN_HIGHER_TAXON_RECORDS = 1000;
const INAT_LOOKUP_CHUNK = 300;

/**
 * Groups naturalists search by common name. The top species of each group
 * (by occurrence count) are added to the global top list.
 */
const SPECIES_GROUPS: { key: number; label: string; share: number }[] = [
  { key: 212, label: 'Birds', share: 0.3 },
  { key: 359, label: 'Mammals', share: 0.08 },
  { key: 131, label: 'Amphibians', share: 0.03 },
  { key: 11592253, label: 'Lizards & snakes', share: 0.03 },
  { key: 11418114, label: 'Turtles', share: 0.01 },
  { key: 789, label: 'Dragonflies', share: 0.03 },
  { key: 797, label: 'Butterflies & moths', share: 0.08 },
  { key: 194, label: 'Conifers', share: 0.01 },
  { key: 1354, label: 'Oaks, birches & allies', share: 0.01 },
];

/**
 * Index size. Each species costs two small, disk-cached GBIF requests
 * (detail + vernacular names), shared with the species pages.
 */
function indexSize(): number {
  const fromEnv = Number(process.env['NAME_INDEX_SIZE']);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  return isDev() ? DEV_INDEX_SIZE : DEFAULT_INDEX_SIZE;
}

/** Species keys with their record counts: the global top list plus the top of each group. */
async function topSpeciesKeys(total: number): Promise<Map<number, number>> {
  const counts = new Map<number, number>();
  const globalShare = 1 - SPECIES_GROUPS.reduce((remaining, group) => remaining + group.share, 0);
  const add = (rows: { name: string; count: number }[] | undefined, limit: number) => {
    let added = 0;
    for (const row of rows ?? []) {
      if (added >= limit) break;
      const key = Number(row.name);
      if (!counts.has(key)) added++;
      counts.set(key, row.count);
    }
  };
  const global = await occurrenceFacets({}, ['speciesKey'], { facetLimit: Math.ceil(total * globalShare) });
  add(global.facets['speciesKey'], Number.POSITIVE_INFINITY);
  for (const group of SPECIES_GROUPS) {
    const want = Math.ceil(total * group.share);
    // Over-fetch so overlap with the global list still yields `want` new keys.
    const result = await occurrenceFacets({ taxonKey: group.key }, ['speciesKey'], { facetLimit: want * 2 });
    add(result.facets['speciesKey'], want);
  }
  return counts;
}

/** Record counts for the kingdoms down to the most-recorded families. */
async function higherRankCounts(): Promise<{ counts: Map<number, number>; familyKeys: number[] }> {
  const facets = await occurrenceFacets({}, HIGHER_RANK_FIELDS, { facetLimit: HIGHER_RANK_FACET_LIMIT });
  const counts = new Map<number, number>();
  for (const field of HIGHER_RANK_FIELDS) {
    for (const facet of facets.facets[field] ?? []) counts.set(Number(facet.name), facet.count);
  }
  const familyCount = isDev() ? DEV_FAMILIES_IN_INDEX : FAMILIES_IN_INDEX;
  const familyKeys = (facets.facets['familyKey'] ?? []).slice(0, familyCount).map((facet) => Number(facet.name));
  return { counts, familyKeys };
}

/**
 * Usages by key, with their common names, for kingdoms to orders (bulk listed) and the given
 * families (fetched individually, cached).
 */
async function higherRankUsages(familyKeys: readonly number[]): Promise<Map<number, NamedUsage>> {
  const usages = new Map<number, NamedUsage>();
  for (const usage of await listAllByRank(BULK_NAMED_RANKS)) usages.set(usage.key, usage);
  const limit = lookupLimit();
  await Promise.all(
    familyKeys.map((key) =>
      limit(async () => {
        try {
          const [usage, vernaculars] = await Promise.all([getSpecies(key), getVernacularNames(key)]);
          usages.set(key, { ...usage, vernacularNames: vernaculars.results });
        } catch (error) {
          rethrowUnlessMissing(error);
        }
      }),
    ),
  );
  return usages;
}

/** The usage's English name, by the same rule as everywhere else. */
function commonNameOf(usage: NamedUsage): string | null {
  return englishName(usage.vernacularNames ?? []);
}

/** Name-index rows for kingdoms down to the busiest families. */
async function higherRanks(): Promise<NameRow[]> {
  const { counts, familyKeys } = await higherRankCounts();
  const usages = await higherRankUsages(familyKeys);
  const rows: NameRow[] = [];
  for (const [key, count] of counts) {
    const usage = usages.get(key);
    const rank = usage && CODE_BY_RANK[usage.rank];
    if (!usage || !rank || count < MIN_HIGHER_TAXON_RECORDS) continue;
    rows.push([key, rank, usage.canonicalName ?? usage.scientificName, commonNameOf(usage), count]);
  }
  return rows;
}

/**
 * iNaturalist's taxon for each species, so the browser skips the search that finds it.
 * A chunk that fails is left without IDs; the browser finds those itself.
 */
async function inatIds(rows: readonly NameRow[]): Promise<Map<number, number>> {
  const ids = new Map<number, number>();
  for (let offset = 0; offset < rows.length; offset += INAT_LOOKUP_CHUNK) {
    const chunk = rows
      .slice(offset, offset + INAT_LOOKUP_CHUNK)
      .map((row) => ({ key: row[0], rank: 'SPECIES' as const, name: row[2] }));
    try {
      for (const [key, id] of await resolveInatIds(chunk)) ids.set(key, id);
    } catch (error) {
      console.warn(`iNaturalist IDs skipped for species ${offset}-${offset + chunk.length}:`, error);
    }
  }
  return ids;
}

/** Name-index rows for the given species, with iNaturalist IDs where found. Species GBIF doesn't know are skipped. */
async function speciesRows(counts: Map<number, number>): Promise<NameRow[]> {
  const limit = lookupLimit();
  const rows = await Promise.all(
    [...counts].map(([key, count]) =>
      limit(async (): Promise<NameRow | null> => {
        try {
          const [usage, vernaculars] = await Promise.all([getSpecies(key), getVernacularNames(key)]);
          return [key, 'S', usage.canonicalName ?? usage.scientificName, englishName(vernaculars.results), count];
        } catch (error) {
          return rethrowUnlessMissing(error);
        }
      }),
    ),
  );
  const named = rows.filter((row): row is NameRow => row !== null);
  const ids = await inatIds(named);
  return named.map((row): NameRow =>
    ids.has(row[0]) ? [row[0], row[1], row[2], row[3], row[4], ids.get(row[0])!] : row,
  );
}

/** The search index of taxon names: higher ranks plus the most-recorded species, busiest first. */
export function bakeNames(): Promise<NamesSnapshot> {
  return once('names', async () => {
    const [higher, species] = await Promise.all([higherRanks(), topSpeciesKeys(indexSize()).then(speciesRows)]);
    const names = [...higher, ...species].sort((left, right) => right[4] - left[4]);
    return { ...snapshotMeta(), names };
  });
}

/** Common-name lookup from the baked name index (build time). */
export async function bakedCommonNames(): Promise<(key: number) => string | null> {
  const { names } = await bakeNames();
  const commonNames = new Map(names.filter((row) => row[3]).map((row) => [row[0], row[3] as string]));
  return (key) => commonNames.get(key) ?? null;
}
