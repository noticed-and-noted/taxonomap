/**
 * Shared plumbing for the bake modules (Node only): per-build memoisation, the disk snapshots
 * `pnpm bake` leaves behind, and the helpers the bakers have in common.
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GbifNotFoundError, listByRank, type NameUsage, type VernacularName } from '~/lib/gbif/server';

/** How many GBIF lookups the bakers run at once. */
export const LOOKUP_CONCURRENCY = 5;
const RANK_PAGE_SIZE = 1000;

/** A backbone name usage, with its vernacular names when the listing included them. */
export type NamedUsage = NameUsage & { vernacularNames?: VernacularName[] };

const memo = new Map<string, Promise<unknown>>();
let isReadingFiles = true;
// The default is only used outside the tests, which always set BAKE_DIR.
/* v8 ignore next */
/** Directory of the snapshots `pnpm bake` writes (`BAKE_DIR`, default `.cache/baked`). */
export const bakeDir = () => process.env['BAKE_DIR'] ?? '.cache/baked';

/**
 * Memoised per build. A file left by `pnpm bake` (baked/<key>.json) is used
 * instead of asking GBIF, so a build needs no GBIF requests once data is baked.
 */
export function once<T>(key: string, callback: () => Promise<T>): Promise<T> {
  let pending = memo.get(key) as Promise<T> | undefined;
  if (!pending) {
    const file = join(bakeDir(), `${key}.json`);
    pending =
      isReadingFiles && existsSync(file) ? readFile(file, 'utf8').then((text) => JSON.parse(text) as T) : callback();
    memo.set(key, pending);
  }
  return pending;
}

/** Forget memoised results and ignore baked files, so the next bake asks GBIF afresh. */
export function startFreshBake(): void {
  isReadingFiles = false;
  memo.clear();
}

/** Skip taxa GBIF doesn't know; any other failure fails the build, so a GBIF outage can't deploy a smaller site. */
export function rethrowUnlessMissing(error: unknown): null {
  if (error instanceof GbifNotFoundError) return null;
  throw error;
}

/** Version and timestamp stamped on every snapshot. */
export const snapshotMeta = () => ({ v: 1 as const, generated: new Date().toISOString() });

/** Every accepted backbone usage of the given ranks, paging through GBIF's listing. */
export async function listAllByRank(ranks: readonly Parameters<typeof listByRank>[0][]): Promise<NamedUsage[]> {
  const usages: NamedUsage[] = [];
  for (const rank of ranks) {
    for (let offset = 0; ; offset += RANK_PAGE_SIZE) {
      const page = await listByRank(rank, offset, RANK_PAGE_SIZE);
      usages.push(...page.results);
      if (page.endOfRecords || page.results.length === 0) break;
    }
  }
  return usages;
}
