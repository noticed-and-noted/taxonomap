/**
 * Confirms each species' iNaturalist ID the way its about page finds it: through GBIF's copy of
 * iNaturalist's records. One SQL download settles species with a single ID; species with several
 * (the page takes the first record's) and everything, if SQL can't work, go through batches.
 */
import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import pLimit from 'p-limit';
import { INATURALIST_DATASET_KEY } from '~/lib/gbif/server';
import { requestSqlDownload, sqlDownloadStatus, type GbifCredentials } from '~/lib/gbif/sql-download';
import { inatRecords } from '~/lib/photos/taxon-photos';
import { MINUTE } from '~/lib/util/time';
import { chunks } from '../inat';
import { readCheckpoint, writeCheckpoint } from './checkpoint';
import { zipEntryLines } from './sources';

const IDS_SQL = (extra = '') => `SELECT specieskey, taxonid, COUNT(*)
  FROM occurrence
  WHERE datasetkey = '${INATURALIST_DATASET_KEY}'${extra}
  GROUP BY specieskey, taxonid`;

const POLL_INTERVAL_MS = MINUTE;
const FINISHED_FAILED = new Set(['CANCELLED', 'FAILED', 'KILLED', 'FILE_ERASED']);
const BATCH_SIZE = 50;
const BATCH_CONCURRENCY = 3;
const SAVE_EVERY_BATCHES = 20;
const BATCH_ATTEMPTS = 5;
const BACKOFF_MS = MINUTE / 2;

/** The variables holding GBIF credentials. */
export const CREDENTIAL_VARIABLES = ['GBIF_USERNAME', 'GBIF_PASSWORD'] as const;

/** GBIF credentials from the environment, or null when they aren't set. */
export function credentialsFromEnv(): GbifCredentials | null {
  const username = process.env['GBIF_USERNAME'];
  const password = process.env['GBIF_PASSWORD'];
  return username && password ? { username, password } : null;
}

/** A plain positive whole number as an ID, or null: the column can hold anything a publisher sent. */
function parseInatId(text: string | undefined): number | null {
  return text && /^\d+$/.test(text) && Number(text) > 0 ? Number(text) : null;
}

/** What the SQL result says about each species. */
export interface SettledRows {
  /** Species with exactly one iNaturalist ID. */
  single: Map<number, number>;
  /** Species with several: the about page takes the first record's, so don't guess. */
  several: Set<number>;
  /** Rows whose ID is null or not numeric. */
  invalidRows: number;
}

/** Sorts the result's TSV lines (species key, taxon ID, count) into species settled and not. */
export function settleRows(lines: Iterable<string>): SettledRows {
  const idsBySpecies = new Map<number, Set<number>>();
  let invalidRows = 0;
  for (const line of lines) {
    const [speciesKey, taxonId] = line.split('\t');
    const key = parseInatId(speciesKey);
    if (!key) continue;
    const id = parseInatId(taxonId);
    if (id) idsBySpecies.set(key, (idsBySpecies.get(key) ?? new Set()).add(id));
    else invalidRows++;
  }
  const settled: SettledRows = { single: new Map(), several: new Set(), invalidRows };
  for (const [key, ids] of idsBySpecies) {
    if (ids.size === 1) settled.single.set(key, [...ids][0]!);
    else settled.several.add(key);
  }
  return settled;
}

/** A download's state as saved, so a run can resume or report it. */
interface SavedDownload {
  key: string;
  requestedAt: number;
  finishedAt?: number;
  doi?: string;
  link?: string;
}

/** Polls a download until it has finished. */
async function awaitDownload(saved: SavedDownload): Promise<SavedDownload> {
  for (;;) {
    const { status, downloadLink, doi } = await sqlDownloadStatus(saved.key);
    if (status === 'SUCCEEDED' && downloadLink) {
      return { ...saved, link: downloadLink, finishedAt: saved.finishedAt ?? Date.now(), ...(doi && { doi }) };
    }
    if (FINISHED_FAILED.has(status)) throw new Error(`GBIF download ${saved.key} ended as ${status}`);
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

/** The result's lines, fetching its zip into `downloadsDir` first. */
async function downloadedLines(saved: SavedDownload, downloadsDir: string): Promise<string[]> {
  const zipPath = join(downloadsDir, `${saved.key}.zip`);
  const response = await fetch(saved.link!);
  if (!response.ok || !response.body) throw new Error(`GBIF download ${saved.key} answered ${response.status}`);
  await pipeline(Readable.fromWeb(response.body as WebReadableStream), createWriteStream(zipPath));
  const lines: string[] = [];
  // The entry's name follows the download's key, so ask unzip for every data file in it.
  for await (const line of zipEntryLines(zipPath, '*')) lines.push(line);
  return lines;
}

/** Runs a query as a saved, resumable download. */
async function runDownload(
  name: string,
  sql: string,
  credentials: GbifCredentials,
  downloadsDir: string,
): Promise<{ saved: SavedDownload; lines: string[] }> {
  const previous = await readCheckpoint<SavedDownload | null>(name, null);
  const requested = previous ?? { key: await requestSqlDownload(sql, credentials), requestedAt: Date.now() };
  await writeCheckpoint(name, requested);
  const saved = await awaitDownload(requested);
  await writeCheckpoint(name, saved);
  return { saved, lines: await downloadedLines(saved, downloadsDir) };
}

/**
 * The small test: a query for known species. It shows whether the column holds plain numeric IDs,
 * and how it compares with the IDs in `knownIds`.
 * @returns Whether the route can work, and the comparison.
 */
export async function testSqlRoute(
  knownIds: ReadonlyMap<number, number>,
  credentials: GbifCredentials,
  downloadsDir: string,
) {
  const keys = [...knownIds.keys()].join(',');
  const { lines } = await runDownload('sql-test', IDS_SQL(` AND specieskey IN (${keys})`), credentials, downloadsDir);
  const { single, several, invalidRows } = settleRows(lines);
  const agree = [...single].filter(([key, id]) => knownIds.get(key) === id).length;
  const isUsable = single.size + several.size > 0 && invalidRows <= single.size;
  return { isUsable, known: knownIds.size, single: single.size, several: several.size, invalidRows, agree };
}

/** The full query's outcome, with how long GBIF took and the DOI GBIF's terms require citing. */
export async function runFullSqlDownload(credentials: GbifCredentials, downloadsDir: string) {
  const { saved, lines } = await runDownload('sql-full', IDS_SQL(), credentials, downloadsDir);
  const minutesTaken = saved.finishedAt ? (saved.finishedAt - saved.requestedAt) / MINUTE : undefined;
  return { settled: settleRows(lines), doi: saved.doi, minutesTaken };
}

/**
 * Splits a batch GBIF answers badly (a null in its facet has broken a whole batch), so one species
 * can't cost the other 49. A species that still fails is left without an ID, and so without a row.
 */
async function splitBatch(keys: readonly number[]): Promise<Map<number, number> | null> {
  if (keys.length === 1) {
    console.warn(`Species ${keys[0]} left out: GBIF's answer for it can't be read`);
    return new Map();
  }
  const middle = Math.ceil(keys.length / 2);
  const halves = await Promise.all([batchIds(keys.slice(0, middle)), batchIds(keys.slice(middle))]);
  return halves[0] && halves[1] ? new Map([...halves[0], ...halves[1]]) : null;
}

/** One batch's IDs, backing off between tries (GBIF answers 429 under load); null when every try failed. */
async function batchIds(keys: readonly number[]): Promise<Map<number, number> | null> {
  for (let attempt = 1; attempt <= BATCH_ATTEMPTS; attempt++) {
    try {
      const records = await inatRecords(keys, {});
      return new Map([...records].flatMap(([key, { taxonId }]) => (taxonId ? [[key, taxonId] as const] : [])));
    } catch (error) {
      if (error instanceof TypeError) return splitBatch(keys);
      console.warn(`Batch of ${keys.length} failed (attempt ${attempt}):`, String(error));
      await new Promise((resolve) => setTimeout(resolve, attempt * BACKOFF_MS));
    }
  }
  return null;
}

/**
 * Each species' ID from its first iNaturalist record, in batches, as its about page finds it.
 * Progress is saved, so a run can resume.
 * @returns GBIF key → iNaturalist ID, null for species with no record; species whose batch kept failing are left out.
 */
export async function confirmByBatch(keys: readonly number[]): Promise<Map<number, number | null>> {
  const saved = await readCheckpoint<[number, number | null][]>('batch-ids', []);
  const confirmed = new Map(saved);
  const missing = keys.filter((key) => !confirmed.has(key)).sort((left, right) => left - right);
  const groups = chunks(missing, BATCH_SIZE);
  const limit = pLimit(BATCH_CONCURRENCY);
  let finished = 0;
  await Promise.all(
    groups.map((group) =>
      limit(async () => {
        const ids = await batchIds(group);
        if (ids) for (const key of group) confirmed.set(key, ids.get(key) ?? null);
        if (++finished % SAVE_EVERY_BATCHES === 0) {
          await writeCheckpoint('batch-ids', [...confirmed]);
          console.warn(`  batches ${finished}/${groups.length}`);
        }
      }),
    ),
  );
  await writeCheckpoint('batch-ids', [...confirmed]);
  return new Map(keys.flatMap((key) => (confirmed.has(key) ? [[key, confirmed.get(key)!] as const] : [])));
}
