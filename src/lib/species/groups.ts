/**
 * Species in an area, and the classes (groups) they fall in, for the cell and Near me tables.
 * The baked data has no species → class mapping, so a group's species are queried when picked:
 *   classes            → 1 facet request (callers fold it into one they make anyway)
 *   top species        → 1 facet request, AND'd with classKey for one group
 *                         (skipped when the caller's request already had the facet)
 *   names              → baked index; then `nameFromRecords`, one batched record search
 *                         for misses, run after the rows are shown; the table calls
 *                         `resolveNames` for any it still needs (cached detail lookups, 2 at a time)
 *                         and `commonNames` for rows in view without a common name
 *   photos             → the table calls `photosForKeys` for rows in view: each species'
 *                         lead photo, iNaturalist taxa batched 30 a request (also supplies names)
 * Every step takes an AbortSignal so a superseded load stops sending requests.
 */
import { loadSnapshot } from '~/lib/data/load';
import { loadNameIndex } from '~/lib/data/name-index';
import pLimit from 'p-limit';
import {
  getSpecies,
  getVernacularNames,
  occurrenceFacets,
  searchOccurrences,
  type FacetCount,
  type OccurrenceFilter,
  type UsableImage,
} from '~/lib/gbif';
import { leadPhotos } from '~/lib/photos/taxon-photos';
import { englishName } from './names';

export interface ClassGroup {
  key: number;
  name: string;
  common?: string;
  records: number;
}

export interface SpeciesRow {
  key: number;
  scientificName: string;
  commonName?: string;
  records: number;
  image?: UsableImage;
  /** Name not known yet (see resolveNames). */
  unnamed?: true;
}

// Bursts of parallel searches trip GBIF's rate limit.
const CONCURRENCY = 2;

let classNames: Promise<Map<number, { name: string; common?: string }>> | undefined;
function classNameMap() {
  classNames ??= loadSnapshot('tree').then(
    (snapshot) =>
      new Map(
        (snapshot?.nodes ?? [])
          .filter((node) => node.r === 'C')
          .map((node) => [node.k, { name: node.n, ...(node.c && { common: node.c }) }]),
      ),
  );
  return classNames;
}

/** Name a classKey facet (tree snapshot first, cached detail call otherwise). */
export async function namedClasses(counts: readonly FacetCount[]): Promise<ClassGroup[]> {
  const names = await classNameMap();
  return Promise.all(
    counts.map(async (facet): Promise<ClassGroup> => {
      const key = Number(facet.name);
      let name = names.get(key);
      if (!name) {
        const usage = await getSpecies(key).catch(() => null);
        name = { name: usage?.canonicalName ?? usage?.scientificName ?? `Class ${key}` };
      }
      return { key, name: name.name, ...(name.common && { common: name.common }), records: facet.count };
    }),
  );
}

/**
 * Top species for a filter (add `classKey` for one group), most-recorded first, named
 * from the baked index (see nameFromRecords for the rest). One facet request, or none
 * when the caller already has the speciesKey facet (`known`).
 */
export async function topSpecies(
  filter: OccurrenceFilter,
  options: { limit?: number; signal?: AbortSignal; known?: readonly FacetCount[] } = {},
): Promise<SpeciesRow[]> {
  const { limit = 200, signal, known } = options;
  signal?.throwIfAborted();
  const counts =
    known ??
    (await occurrenceFacets(filter, ['speciesKey'], { facetLimit: limit, ...(signal && { signal }) })).facets[
      'speciesKey'
    ] ??
    [];
  const rows = counts.map((facet) => ({ key: Number(facet.name), records: facet.count }));
  if (!rows.length) return [];

  // Wait for the whole index: without it nearly every row misses.
  const nameIndex = await loadNameIndex();
  signal?.throwIfAborted();
  const scientificNames = new Map<number, string>();
  const common = new Map<number, string>();
  for (const row of rows) {
    const name = nameIndex?.get(row.key);
    if (name) scientificNames.set(row.key, name.scientificName);
    if (name?.commonName) common.set(row.key, name.commonName);
  }
  return rows.map((row) => {
    const commonName = common.get(row.key);
    const name = scientificNames.get(row.key);
    return {
      ...row,
      scientificName: name ?? `Species ${row.key}`,
      ...(commonName && { commonName }),
      ...(!name && { unnamed: true as const }),
    };
  });
}

/**
 * Names for rows the index missed, from one batched record search (records
 * carry their species name). Returns `rows` itself when it names none.
 */
export async function nameFromRecords(rows: SpeciesRow[], signal?: AbortSignal): Promise<SpeciesRow[]> {
  const misses = rows.filter((row) => row.unnamed).map((row) => row.key);
  if (!misses.length) return rows;
  const response = await searchOccurrences({ speciesKeys: misses.slice(0, 150) }, { limit: 300 }, signal).catch(
    () => null,
  );
  const scientificNames = new Map<number, string>();
  for (const occurrence of response?.results ?? [])
    if (occurrence.speciesKey !== undefined && occurrence.species)
      scientificNames.set(occurrence.speciesKey, occurrence.species);
  if (!scientificNames.size) return rows;
  return rows.map((row) => {
    const name = row.unnamed && scientificNames.get(row.key);
    if (!name) return row;
    const { unnamed: _unused, ...named } = row;
    return { ...named, scientificName: name };
  });
}

/** Names for species keys (cached detail lookups, a few at a time). */
export async function resolveNames(keys: readonly number[], signal?: AbortSignal): Promise<Map<number, string>> {
  const limit = pLimit(CONCURRENCY);
  const names = new Map<number, string>();
  await Promise.all(
    keys.map((key) =>
      limit(async () => {
        // Skip the rest once superseded.
        if (signal?.aborted) return;
        try {
          const usage = await getSpecies(key, signal);
          names.set(key, usage.canonicalName ?? usage.scientificName);
        } catch {
          /* unnamed */
        }
      }),
    ),
  );
  return names;
}

/**
 * English common names, picked as the species page picks them (same cached
 * request), a few at a time. Keys with no English name are left out.
 */
export async function commonNames(keys: readonly number[], signal?: AbortSignal): Promise<Map<number, string>> {
  const limit = pLimit(CONCURRENCY);
  const names = new Map<number, string>();
  await Promise.all(
    keys.map((key) =>
      limit(async () => {
        if (signal?.aborted) return;
        const vernaculars = await getVernacularNames(key, signal).catch(() => null);
        const name = vernaculars && englishName(vernaculars.results);
        if (name) names.set(key, name);
      }),
    ),
  );
  return names;
}

/**
 * Each species' lead photo (see leadPhotos), so a row shows the same photo
 * as the first one on the page it links to. Also supplies species names.
 * `names` (scientific, by key) lets a species GBIF holds no iNaturalist record of be found by name.
 */
export function photosForKeys(
  keys: readonly number[],
  signal?: AbortSignal,
  names: ReadonlyMap<number, string> = new Map(),
): Promise<{ images: Map<number, UsableImage>; names: Map<number, string> }> {
  return leadPhotos(
    keys.map((key) => ({ key, rank: 'SPECIES' as const, ...(names.has(key) && { name: names.get(key)! }) })),
    { ...(signal && { signal }) },
  );
}
