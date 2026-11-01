/**
 * iNaturalist's taxa for the baked name index (Node only): each species' taxon, found once and
 * then reused by ID, and the English names of the higher taxa above them. Names come from the
 * taxa themselves (`preferred_common_name`), fetched 30 to a request by ID, so the higher ranks
 * cost no name searches: a species' taxon lists its ancestors' IDs.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { NamesSnapshot } from '~/lib/data/types';
import { getTaxa, inatCommonName, type InatTaxon, TAXA_BATCH } from '~/lib/photos/inat';
import { resolveInatIds } from '~/lib/photos/taxon-photos';
import { bakeDir, queueRequests } from './cache';

const INAT = 'iNaturalist';
const INAT_LOOKUP_CHUNK = 300;

/** iNaturalist rank levels of the ranks above species the index names. */
export const INAT_RANK_LEVEL = { K: 70, P: 60, C: 50, O: 40, F: 30, G: 20 } as const;

/** A species to find on iNaturalist: its GBIF key and scientific name. */
export interface SpeciesToMatch {
  key: number;
  name: string;
}

/**
 * The iNaturalist IDs the last `pnpm bake` found. Matches are stable and iNaturalist allows about one
 * request a second, so a re-bake only looks up species without one. `INAT_IDS_REFRESH=1` looks up all.
 */
async function previousInatIds(): Promise<Map<number, number>> {
  if (process.env['INAT_IDS_REFRESH'] === '1') return new Map();
  try {
    const { names } = JSON.parse(await readFile(join(bakeDir(), 'names.json'), 'utf8')) as NamesSnapshot;
    return new Map(names.flatMap((row): [number, number][] => (row[5] ? [[row[0], row[5]]] : [])));
  } catch {
    // No earlier bake, or one we can't read: look every species up.
    return new Map();
  }
}

/** Splits `items` into chunks of INAT_LOOKUP_CHUNK, the most one call holds in iNaturalist's taxon cache at once. */
function chunks<Item>(items: readonly Item[]): Item[][] {
  const groups: Item[][] = [];
  for (let offset = 0; offset < items.length; offset += INAT_LOOKUP_CHUNK) {
    groups.push(items.slice(offset, offset + INAT_LOOKUP_CHUNK));
  }
  return groups;
}

/** IDs for the species the last bake didn't match. A chunk that fails is left without; the browser finds those itself. */
async function matchNewSpecies(species: readonly SpeciesToMatch[], ids: Map<number, number>): Promise<void> {
  const unmatched = chunks(species.filter((entry) => !ids.has(entry.key)));
  // Counted per chunk, all queued up front, so the progress bar shows how far through it is.
  const finishChunk = queueRequests(INAT, unmatched.length);
  for (const chunk of unmatched) {
    try {
      const found = await resolveInatIds(chunk.map(({ key, name }) => ({ key, rank: 'SPECIES' as const, name })));
      for (const [key, id] of found) ids.set(key, id);
    } catch (error) {
      console.warn(`iNaturalist IDs skipped for ${chunk.length} species:`, error);
    } finally {
      finishChunk();
    }
  }
}

/**
 * iNaturalist's taxa by ID, TAXA_BATCH to a request, counted in the progress bar.
 * A chunk that fails is left out, so its taxa keep GBIF's names.
 */
async function taxaById(ids: Iterable<number>): Promise<Map<number, InatTaxon>> {
  const groups = chunks([...new Set(ids)]);
  const finishChunk = queueRequests(INAT, groups.length);
  const taxa = new Map<number, InatTaxon>();
  for (const group of groups) {
    try {
      for (const [id, taxon] of await getTaxa(group)) taxa.set(id, taxon);
    } catch (error) {
      console.warn(
        `iNaturalist taxa skipped for ${group.length} IDs (${Math.ceil(group.length / TAXA_BATCH)} requests):`,
        error,
      );
    } finally {
      finishChunk();
    }
  }
  return taxa;
}

/** Each species' iNaturalist ID, and its taxon (with its English name) where that could be fetched. */
export interface InatSpecies {
  ids: Map<number, number>;
  taxa: Map<number, InatTaxon>;
}

/**
 * iNaturalist's taxon for each species, by GBIF key, so the browser skips the search that finds it
 * and every species takes iNaturalist's name. Species iNaturalist has no match for are left out;
 * an ID whose taxon couldn't be fetched is kept, just without a name.
 */
export async function inatSpeciesTaxa(species: readonly SpeciesToMatch[]): Promise<InatSpecies> {
  const allIds = await previousInatIds();
  await matchNewSpecies(species, allIds);
  const ids = new Map(
    species.flatMap((entry): [number, number][] => {
      const id = allIds.get(entry.key);
      return id === undefined ? [] : [[entry.key, id]];
    }),
  );
  const byId = await taxaById(ids.values());
  const taxa = new Map<number, InatTaxon>();
  for (const [key, id] of ids) {
    const taxon = byId.get(id);
    if (taxon) taxa.set(key, taxon);
  }
  return { ids, taxa };
}

/** Key for a higher taxon by rank level and scientific name, as both GBIF and iNaturalist name it. */
export const higherTaxonKey = (level: number, scientificName: string) => `${level}:${scientificName.toLowerCase()}`;

/**
 * English names of the taxa above the given species, keyed by `higherTaxonKey`: each species'
 * ancestors, fetched by ID. A GBIF taxon takes the name of the iNaturalist taxon with its rank and
 * scientific name; groups the two rank differently keep GBIF's names.
 */
export async function inatHigherNames(species: readonly InatTaxon[]): Promise<Map<string, string>> {
  const ancestorIds = new Set<number>();
  for (const taxon of species) for (const ancestorId of taxon.ancestor_ids ?? []) ancestorIds.add(ancestorId);
  for (const taxon of species) ancestorIds.delete(taxon.id);
  const names = new Map<string, string>();
  for (const ancestor of (await taxaById(ancestorIds)).values()) {
    const name = inatCommonName(ancestor);
    if (name) names.set(higherTaxonKey(ancestor.rank_level, ancestor.name), name);
  }
  return names;
}
