/**
 * Species in an area, and the classes (groups) they fall in, for the cell and Near me tables.
 * The baked data has no species → class mapping, so a group's species are queried when picked:
 *   classes            → 1 facet request (callers fold it into one they make anyway)
 *   top species        → 1 facet request, AND'd with classKey for one group
 *                         (skipped when the caller's request already had the facet)
 *   names              → baked index, then the facet's own names (GBIF's GraphQL API names
 *                         each value); the table calls `resolveNames` for any still missing
 *                         (cached detail lookups, 2 at a time)
 *   common names       → baked index (iNaturalist's names, baked), then iNaturalist's taxa,
 *                         which the photo lookups fetch anyway; `commonNames` for rows that get
 *                         no photo lookup, with GBIF's names for species iNaturalist doesn't name
 *   photos             → the table calls `photosForKeys` for rows in view: each species'
 *                         lead photo, iNaturalist taxa batched 30 a request (also supplies names)
 * Every step takes an AbortSignal so a superseded load stops sending requests.
 */
import pLimit from 'p-limit';
import { loadSnapshot } from '~/lib/data/load';
import { loadNameIndex } from '~/lib/data/name-index';
import {
  getSpecies,
  namedOccurrenceFacets,
  vernacularNamesByTaxon,
  type NamedFacetCount,
  type OccurrenceFilter,
  type UsableImage,
  type VernacularName,
} from '~/lib/gbif';
import { inatNames, type LeadPhotos, leadPhotos } from '~/lib/photos/taxon-photos';
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

/** Name a classKey facet (tree snapshot first, then the facet's own name, then a cached detail call). */
export async function namedClasses(counts: readonly NamedFacetCount[]): Promise<ClassGroup[]> {
  const names = await classNameMap();
  return Promise.all(
    counts.map(async (facet): Promise<ClassGroup> => {
      const key = Number(facet.name);
      const name: { name: string; common?: string } =
        names.get(key) ?? (facet.label ? { name: facet.label } : await classNameFromGbif(key));
      return { key, name: name.name, ...(name.common && { common: name.common }), records: facet.count };
    }),
  );
}

/** A class's name from its GBIF detail record, for the rare class the facet left unnamed. */
async function classNameFromGbif(key: number): Promise<{ name: string }> {
  const usage = await getSpecies(key).catch(() => null);
  return { name: usage?.canonicalName ?? usage?.scientificName ?? `Class ${key}` };
}

/**
 * Top species for a filter (add `classKey` for one group), most-recorded first, named
 * from the baked index, then by the facet itself. One facet request, or none when the
 * caller already has the speciesKey facet (`known`).
 */
export async function topSpecies(
  filter: OccurrenceFilter,
  options: { limit?: number; signal?: AbortSignal; known?: readonly NamedFacetCount[] } = {},
): Promise<SpeciesRow[]> {
  const { limit = 200, signal, known } = options;
  signal?.throwIfAborted();
  const counts =
    known ??
    (await namedOccurrenceFacets(filter, ['speciesKey'], { facetLimit: limit, ...(signal && { signal }) })).facets[
      'speciesKey'
    ] ??
    [];
  if (!counts.length) return [];

  // Wait for the whole index: its names match the species pages', and it has common names.
  const nameIndex = await loadNameIndex();
  signal?.throwIfAborted();
  return counts.map((facet): SpeciesRow => {
    const key = Number(facet.name);
    const indexed = nameIndex?.get(key);
    const name = indexed?.scientificName ?? facet.label;
    return {
      key,
      records: facet.count,
      scientificName: name ?? `Species ${key}`,
      ...(indexed?.commonName && { commonName: indexed.commonName }),
      ...(!name && { unnamed: true as const }),
    };
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
 * English common names: iNaturalist's (none when remembered from before, else one batched GBIF
 * record search and one iNaturalist request per 30), then `gbifCommonNames` for the keys
 * iNaturalist doesn't name. Keys with no English name are left out.
 */
export async function commonNames(keys: readonly number[], signal?: AbortSignal): Promise<Map<number, string>> {
  if (signal?.aborted) return new Map();
  const fromInat = await inatNames(
    keys.map((key) => ({ key, rank: 'SPECIES' as const })),
    { ...(signal && { signal }) },
  ).catch(() => new Map<number, string | null>());
  const names = new Map([...fromInat].flatMap(([key, name]): [number, string][] => (name ? [[key, name]] : [])));
  const unnamed = keys.filter((key) => !names.has(key));
  if (!unnamed.length) return names;
  return new Map([...names, ...(await gbifCommonNames(unnamed, signal))]);
}

/**
 * GBIF's English common names, picked by `englishName()` from one batched GraphQL
 * request: the fallback for taxa iNaturalist doesn't name. Keys with no English name are left out.
 */
export async function gbifCommonNames(keys: readonly number[], signal?: AbortSignal): Promise<Map<number, string>> {
  const names = new Map<number, string>();
  if (signal?.aborted || !keys.length) return names;
  // Rows without a common name still show their scientific name.
  const vernaculars = await vernacularNamesByTaxon(keys, signal).catch(() => new Map<number, VernacularName[]>());
  for (const [key, taxonNames] of vernaculars) {
    const name = englishName(taxonNames, key);
    if (name) names.set(key, name);
  }
  return names;
}

/**
 * Each species' lead photo (see leadPhotos), so a row shows the same photo
 * as the first one on the page it links to. Also supplies species names, and
 * iNaturalist's common names (to `onCommonNames` as soon as they are known).
 */
export function photosForKeys(
  keys: readonly number[],
  signal?: AbortSignal,
  onCommonNames?: (commonNames: ReadonlyMap<number, string>) => void,
): Promise<LeadPhotos> {
  return leadPhotos(
    keys.map((key) => ({ key, rank: 'SPECIES' as const })),
    { ...(signal && { signal }), ...(onCommonNames && { onCommonNames }) },
  );
}
