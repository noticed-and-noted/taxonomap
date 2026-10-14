/**
 * Species in an area grouped by class, for the cell and Near me tables.
 * The baked data has no species → class mapping, so each class is queried:
 *   classes            → 1 facet request (callers fold it into one they make anyway)
 *   species per class  → 1 facet request per class, 2 at a time (classKey AND the filter)
 *   names              → baked index, then one batched record search for misses;
 *                         the table calls `resolveNames` for any it still needs to show
 *                         (cached detail lookups, 2 at a time)
 *   photos             → the table calls `photosForKeys` for rows in view (also supplies names)
 * Every step takes an AbortSignal so a superseded load stops sending requests.
 */
import { loadSnapshot } from '~/lib/data/load';
import { loadNameIndex } from '~/lib/data/name-index';
import pLimit from 'p-limit';
import {
  findImages,
  getSpecies,
  occurrenceFacets,
  searchOccurrences,
  type FacetCount,
  type OccurrenceFilter,
  type UsableImage,
} from '~/lib/gbif';

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

/** Top species of each of the leading classes, most-recorded first, named where cheap. */
export async function speciesInClasses(
  filter: OccurrenceFilter,
  classes: readonly ClassGroup[],
  opts: { maxClasses?: number; perClass?: number; signal?: AbortSignal } = {},
): Promise<SpeciesRow[]> {
  const { maxClasses = 8, perClass = 30, signal } = opts;
  const limit = pLimit(CONCURRENCY);
  const pages = await Promise.all(
    classes.slice(0, maxClasses).map((c) =>
      limit(() => {
        signal?.throwIfAborted();
        return occurrenceFacets({ ...filter, classKey: c.key }, ['speciesKey'], {
          facetLimit: perClass,
          ...(signal && { signal }),
        }).then((r) =>
          (r.facets['speciesKey'] ?? []).map((f) => ({ key: Number(f.name), records: f.count, classKey: c.key })),
        );
      }),
    ),
  );
  const rows = pages.flat().sort((a, b) => b.records - a.records);
  if (!rows.length) return [];

  // Wait for the whole index: without it nearly every row misses.
  const idx = await loadNameIndex();
  signal?.throwIfAborted();
  const sci = new Map<number, string>();
  const common = new Map<number, string>();
  for (const r of rows) {
    const row = idx?.get(r.key);
    if (row) sci.set(r.key, row[2]);
    if (row?.[3]) common.set(r.key, row[3]);
  }
  // Records carry their species name: one search covers most misses.
  const misses = rows.filter((r) => !sci.has(r.key)).map((r) => r.key);
  if (misses.length) {
    const res = await searchOccurrences({ speciesKeys: misses.slice(0, 150) }, { limit: 300 }, signal).catch(
      () => null,
    );
    for (const o of res?.results ?? []) if (o.speciesKey !== undefined && o.species) sci.set(o.speciesKey, o.species);
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

/** Names for species keys (cached detail lookups, a few at a time). */
export async function resolveNames(keys: readonly number[], signal?: AbortSignal): Promise<Map<number, string>> {
  const limit = pLimit(CONCURRENCY);
  const names = new Map<number, string>();
  await Promise.all(
    keys.map((k) =>
      limit(() => {
        // Skip the rest once superseded. No signal on the request itself: identical
        // in-flight requests are shared, and another caller may be awaiting it.
        if (signal?.aborted) return undefined;
        return getSpecies(k)
          .then((u) => names.set(k, u.canonicalName ?? u.scientificName))
          .catch(() => undefined);
      }),
    ),
  );
  return names;
}

/**
 * One photo per species where one exists. A batched search returns records in
 * no useful order, so a few well-photographed species can fill every result
 * (a robin took 54 of 100); each further round asks only for the species still
 * missing, up to `rounds` searches.
 */
export async function photosForKeys(
  keys: readonly number[],
  signal?: AbortSignal,
  rounds = 3,
): Promise<{ images: Map<number, UsableImage>; names: Map<number, string> }> {
  const images = new Map<number, UsableImage>();
  const names = new Map<number, string>();
  let left = [...keys];
  for (let i = 0; i < rounds && left.length && !signal?.aborted; i++) {
    const res = await findImages({ speciesKeys: left }, { limit: 50, ...(signal && { signal }) }).catch(() => null);
    if (!res) break;
    for (const [k, n] of res.names) names.set(k, n);
    for (const img of res.images) {
      const k = img.speciesKey;
      if (k !== undefined && left.includes(k) && !images.has(k)) images.set(k, img);
    }
    const before = left.length;
    left = left.filter((k) => !images.has(k));
    // Nothing new: what's left has no photos we can use.
    if (left.length === before) break;
  }
  return { images, names };
}
