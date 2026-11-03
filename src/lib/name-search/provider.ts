/**
 * Name search from the static files on our own origin, in place of the live GBIF providers. A query
 * reads at most MAX_FILES_PER_QUERY files per lookup; a prefix wider than that is answered from the
 * baked top-taxa list, as alphabetical files can't rank it by record count.
 */
import { matchHit, normalise } from '~/lib/data/name-index';
import type { NameHit, NameSearchProvider } from '~/lib/gbif/names';
import { loadSearchFile } from './files';
import {
  filePath,
  fileSpan,
  filesForPrefix,
  LOOKUPS,
  MANIFEST_PATH,
  MAX_FILES_PER_QUERY,
  MAX_HITS,
  RANK_CODES,
  sortKey,
  topFileFor,
  type Lookup,
  type NameColumns,
  type SearchManifest,
  type SearchRankCode,
  type TopColumns,
} from './format';

/** Which rows of which files answer a query. */
interface SearchPlan {
  reads: { lookup: Lookup; prefix: string; files: number[] }[];
  /** The top-taxa file to read, when the query is too wide for a lookup's files. */
  topFile?: number;
}

/** The numbers of the files `prefix` spans in a lookup, or null when that's too many to read. */
function readableFiles(firstKeys: readonly string[], prefix: string): number[] | null {
  const range = filesForPrefix(firstKeys, prefix);
  if (fileSpan(range) > MAX_FILES_PER_QUERY) return null;
  return Array.from({ length: fileSpan(range) }, (_unused, offset) => range.from + offset);
}

/**
 * The query word spanning the fewest common-name files, so "jay blue" finds "Blue Jay" and
 * "common bl" isn't sent through every "Common" name.
 */
function narrowestWord(firstKeys: readonly string[], words: readonly string[]): string {
  const span = (word: string) => fileSpan(filesForPrefix(firstKeys, word));
  return words.reduce((narrowest, word) => (span(word) < span(narrowest) ? word : narrowest));
}

/** Decides which files answer a normalised query, without fetching any. */
export function planSearch(manifest: SearchManifest, query: string): SearchPlan {
  const plan: SearchPlan = { reads: [] };
  for (const lookup of LOOKUPS) {
    const files = readableFiles(manifest[lookup], query);
    if (files) plan.reads.push({ lookup, prefix: query, files });
    else plan.topFile = topFileFor(manifest.top, query);
  }
  const words = query.split(' ');
  if (words.length > 1) {
    const prefix = narrowestWord(manifest.common, words);
    const files = readableFiles(manifest.common, prefix);
    if (files) plan.reads.push({ lookup: 'common', prefix, files });
  }
  return plan;
}

/** One row as a hit. */
function toHit(columns: NameColumns, row: number): NameHit {
  const commonName = columns.commons[row];
  const count = columns.counts[row];
  return {
    key: columns.keys[row]!,
    scientificName: columns.names[row]!,
    rank: RANK_CODES[columns.ranks[row] as SearchRankCode],
    ...(commonName && { commonName }),
    ...(count && { count }),
    source: 'static',
  };
}

/** The hits a lookup's file holds under `prefix`. */
export function rowsUnderPrefix(columns: NameColumns, lookup: Lookup, prefix: string): NameHit[] {
  const hits: NameHit[] = [];
  for (let row = 0; row < columns.keys.length; row++) {
    if (sortKey(columns, lookup, row).startsWith(prefix)) hits.push(toHit(columns, row));
  }
  return hits;
}

/** The hits a top-taxa file holds for exactly `prefix`. */
export function topRowsFor(columns: TopColumns, prefix: string): NameHit[] {
  const position = columns.prefixes.indexOf(prefix);
  if (position === -1) return [];
  const end = columns.starts[position + 1] ?? columns.keys.length;
  const hits: NameHit[] = [];
  for (let row = columns.starts[position]!; row < end; row++) hits.push(toHit(columns, row));
  return hits;
}

/** The best matches, one per taxon: by match score like the baked index, then by record count. */
export function rankHits(hits: readonly NameHit[], query: string): NameHit[] {
  const byKey = new Map(hits.map((hit) => [hit.key, hit]));
  const scored = [...byKey.values()].map((hit) => ({ hit, score: matchHit(hit, query).score }));
  return scored
    .filter(({ score }) => score > 0)
    .sort((first, second) => second.score - first.score || (second.hit.count ?? 0) - (first.hit.count ?? 0))
    .slice(0, MAX_HITS)
    .map(({ hit }) => hit);
}

/** Fetches what a plan reads. Any file failing rejects, so the search shows as failed rather than partial. */
async function readPlan(plan: SearchPlan, query: string): Promise<NameHit[]> {
  const fromLookups = plan.reads.flatMap(({ lookup, prefix, files }) =>
    files.map(async (fileNumber) =>
      rowsUnderPrefix(await loadSearchFile<NameColumns>(filePath(lookup, fileNumber)), lookup, prefix),
    ),
  );
  const fromTop =
    plan.topFile === undefined
      ? []
      : [loadSearchFile<TopColumns>(filePath('top', plan.topFile)).then((columns) => topRowsFor(columns, query))];
  return (await Promise.all([...fromLookups, ...fromTop])).flat();
}

/** Hits from the static files. */
export const staticNameProvider: NameSearchProvider = {
  id: 'static-names',
  async search(query) {
    const normalisedQuery = normalise(query);
    const manifest = await loadSearchFile<SearchManifest>(MANIFEST_PATH);
    const hits = await readPlan(planSearch(manifest, normalisedQuery), normalisedQuery);
    return rankHits(hits, normalisedQuery);
  },
};
