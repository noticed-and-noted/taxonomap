/**
 * Shared plumbing for the bake modules (Node only): per-build memoisation, the disk snapshots
 * `pnpm bake` leaves behind, and the helpers the bakers have in common.
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import pLimit from 'p-limit';
import {
  GbifNotFoundError,
  listByRank,
  occurrenceFacets,
  speciesCountsUnder,
  type NameUsage,
  type VernacularName,
} from '~/lib/gbif/server';

/** How many GBIF lookups the bakers run at once. */
const LOOKUP_CONCURRENCY = 5;
const RANK_PAGE_SIZE = 1000;

/** A backbone name usage, with its vernacular names when the listing included them. */
export type NamedUsage = NameUsage & { vernacularNames?: VernacularName[] };

const memo = new Map<string, Promise<unknown>>();
let isReadingFiles = true;
/** Directory of the snapshots `pnpm bake` writes (`BAKE_DIR`, default `.cache/baked`). */
export const bakeDir = () => process.env['BAKE_DIR'] ?? '.cache/baked';

const bakedFile = (key: string) => join(bakeDir(), `${key}.json`);

/**
 * One snapshot, memoised per run. `pnpm bake` runs `bake` and saves the result; a build only
 * reads the file it left (baked/<key>.json) and never fetches, so the site's external requests
 * all happen in the bake.
 * @param missing What a build gets when the bake saved no file; the browser fetches that data live.
 */
export function once<T>(key: string, bake: () => Promise<T>, missing: T): Promise<T> {
  let pending = memo.get(key) as Promise<T> | undefined;
  if (!pending) {
    pending = isReadingFiles ? readBaked(key, missing) : bake();
    memo.set(key, pending);
  }
  return pending;
}

async function readBaked<T>(key: string, missing: T): Promise<T> {
  return isBaked(key) ? (JSON.parse(await readFile(bakedFile(key), 'utf8')) as T) : missing;
}

/** Whether a build has this snapshot from the bake; a bake has every snapshot it makes. */
export function isBaked(key: string): boolean {
  return !isReadingFiles || existsSync(bakedFile(key));
}

/** Switch to baking: forget memoised results and ignore baked files, so snapshots are fetched afresh. */
export function startFreshBake(): void {
  isReadingFiles = false;
  memo.clear();
  bakeProgress.clear();
}

/** Requests to each service ("GBIF", "iNaturalist") queued and finished, for the `pnpm bake` progress bar. */
export const bakeProgress = new Map<string, { queued: number; done: number }>();

const GBIF = 'GBIF';

/**
 * Counts `count` more requests to `service` as queued.
 * @returns Call it once as each of them finishes.
 */
export function queueRequests(service: string, count = 1): () => void {
  const counter = bakeProgress.get(service) ?? { queued: 0, done: 0 };
  bakeProgress.set(service, counter);
  counter.queued += count;
  return () => {
    counter.done++;
  };
}

/** Runs one GBIF request, counted in `bakeProgress`. */
async function countedGbif<T>(task: () => Promise<T>): Promise<T> {
  const finish = queueRequests(GBIF);
  try {
    return await task();
  } finally {
    finish();
  }
}

/** A queue running LOOKUP_CONCURRENCY lookups at once, counted in `bakeProgress`. */
export function lookupLimit(): <T>(task: () => Promise<T>) => Promise<T> {
  const limit = pLimit(LOOKUP_CONCURRENCY);
  return (task) => countedGbif(() => limit(task));
}

/** `occurrenceFacets`, counted in `bakeProgress`. */
export const countedFacets: typeof occurrenceFacets = (...args) => countedGbif(() => occurrenceFacets(...args));

/** `speciesCountsUnder`, counted in `bakeProgress`. */
export const countedSpeciesCounts: typeof speciesCountsUnder = (...args) =>
  countedGbif(() => speciesCountsUnder(...args));

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
      const page = await countedGbif(() => listByRank(rank, offset, RANK_PAGE_SIZE));
      usages.push(...page.results);
      if (page.endOfRecords || page.results.length === 0) break;
    }
  }
  return usages;
}
