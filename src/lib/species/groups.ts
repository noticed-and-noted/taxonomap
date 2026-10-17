/**
 * Species in an area grouped by class, for the cell and Near me tables.
 * The baked data has no species → class mapping, so each class is queried:
 *   classes            → 1 facet request (callers fold it into one they make anyway)
 *   species per class  → 1 facet request per class, 2 at a time (classKey AND the filter)
 *                         (skipped for a class whose facet the caller already has)
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
  classKey: number;
  image?: UsableImage;
  /** Name not known yet (see resolveNames). */
  unnamed?: true;
}

// Bursts of parallel searches trip GBIF's rate limit.
const CONCURRENCY = 2;

let classNames: Promise<Map<number, { name: string; common?: string }>> | undefined;
function classNameMap() {
  classNames ??= loadSnapshot('tree').then(
    (t) =>
      new Map(
        (t?.nodes ?? []).filter((n) => n.r === 'C').map((n) => [n.k, { name: n.n, ...(n.c && { common: n.c }) }]),
      ),
  );
  return classNames;
}

/** Name a classKey facet (tree snapshot first, cached detail call otherwise). */
export async function namedClasses(counts: readonly FacetCount[]): Promise<ClassGroup[]> {
  const names = await classNameMap();
  return Promise.all(
    counts.map(async (c): Promise<ClassGroup> => {
      const key = Number(c.name);
      let n = names.get(key);
      if (!n) {
        const u = await getSpecies(key).catch(() => null);
        n = { name: u?.canonicalName ?? u?.scientificName ?? `Class ${key}` };
      }
      return { key, name: n.name, ...(n.common && { common: n.common }), records: c.count };
    }),
  );
}

/**
 * Top species of each of the leading classes, most-recorded first, named from
 * the baked index (see nameFromRecords for the rest). `known` holds speciesKey
 * facets the caller already fetched, by classKey; those classes are not queried.
 */
export async function speciesInClasses(
  filter: OccurrenceFilter,
  classes: readonly ClassGroup[],
  opts: { maxClasses?: number; perClass?: number; signal?: AbortSignal; known?: Map<number, FacetCount[]> } = {},
): Promise<SpeciesRow[]> {
  const { maxClasses = 8, perClass = 30, signal, known } = opts;
  const limit = pLimit(CONCURRENCY);
  const pages = await Promise.all(
    classes.slice(0, maxClasses).map(async (c) => {
      const counts =
        known?.get(c.key) ??
        (await limit(async () => {
          signal?.throwIfAborted();
          const r = await occurrenceFacets({ ...filter, classKey: c.key }, ['speciesKey'], {
            facetLimit: perClass,
            ...(signal && { signal }),
          });
          return r.facets['speciesKey'] ?? [];
        }));
      return counts.map((f) => ({ key: Number(f.name), records: f.count, classKey: c.key }));
    }),
  );
  const rows = pages.flat().sort((a, b) => b.records - a.records);
  if (!rows.length) return [];

  // Wait for the whole index: without it nearly every row misses.
  const idx = await loadNameIndex();
  signal?.throwIfAborted();
  const sci = new Map<number, string>();
  const common = new Map<number, string>();
  for (const r of rows) {
    const n = idx?.get(r.key);
    if (n) sci.set(r.key, n.scientificName);
    if (n?.commonName) common.set(r.key, n.commonName);
  }
  return rows.map((r) => {
    const commonName = common.get(r.key);
    const name = sci.get(r.key);
    return {
      ...r,
      scientificName: name ?? `Species ${r.key}`,
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
  const misses = rows.filter((r) => r.unnamed).map((r) => r.key);
  if (!misses.length) return rows;
  const res = await searchOccurrences({ speciesKeys: misses.slice(0, 150) }, { limit: 300 }, signal).catch(() => null);
  const sci = new Map<number, string>();
  for (const o of res?.results ?? []) if (o.speciesKey !== undefined && o.species) sci.set(o.speciesKey, o.species);
  if (!sci.size) return rows;
  return rows.map((r) => {
    const name = r.unnamed && sci.get(r.key);
    if (!name) return r;
    const { unnamed: _, ...named } = r;
    return { ...named, scientificName: name };
  });
}

/** Names for species keys (cached detail lookups, a few at a time). */
export async function resolveNames(keys: readonly number[], signal?: AbortSignal): Promise<Map<number, string>> {
  const limit = pLimit(CONCURRENCY);
  const names = new Map<number, string>();
  await Promise.all(
    keys.map((k) =>
      limit(async () => {
        // Skip the rest once superseded.
        if (signal?.aborted) return;
        try {
          const u = await getSpecies(k, signal);
          names.set(k, u.canonicalName ?? u.scientificName);
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
    keys.map((k) =>
      limit(async () => {
        if (signal?.aborted) return;
        const v = await getVernacularNames(k, 300, signal).catch(() => null);
        const name = v && englishName(v.results);
        if (name) names.set(k, name);
      }),
    ),
  );
  return names;
}

/**
 * Each species' lead photo (see leadPhotos), so a row shows the same photo
 * as the first one on the page it links to. Also supplies species names.
 */
export function photosForKeys(
  keys: readonly number[],
  signal?: AbortSignal,
): Promise<{ images: Map<number, UsableImage>; names: Map<number, string> }> {
  return leadPhotos(
    keys.map((key) => ({ key, rank: 'SPECIES' as const })),
    { ...(signal && { signal }) },
  );
}
