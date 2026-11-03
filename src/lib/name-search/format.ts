/**
 * The static name-search files, shared by the generator (`pnpm bake:names`) and the browser. Names
 * are sorted and split into evenly sized column files, with a list of each file's first sort key.
 * Letter prefixes would make too many files (over 60,000), and a taxon's preview data sits in files
 * of its own so the search files don't repeat it.
 */
import { normalise } from '~/lib/data/name-index';
import { env } from '~/lib/env';
import type { Rank } from '~/lib/gbif/types';

/** Where the files are served from. Not under /data/: the service worker keeps few entries there. */
export const SEARCH_DATA_PATH = '/search-data';
export const ROWS_PER_FILE = 1000;
/** A prefix spanning more files than this in a lookup is answered from the top-taxa list instead. */
export const MAX_FILES_PER_QUERY = 2;
/** Most taxa a search returns, and most a top-taxa list holds per prefix. */
export const MAX_HITS = 20;

/** The lookups: a scientific name's first word, its second word, and every word of a common name. */
export const LOOKUPS = ['first', 'second', 'common'] as const;
export type Lookup = (typeof LOOKUPS)[number];

/** A file of taxa as columns; a row is one index across them. */
export interface NameColumns {
  names: string[];
  /** Common names; empty where a taxon has none. */
  commons: string[];
  keys: number[];
  /** One RANK_CODES letter per row. */
  ranks: string;
  /** Occurrence records; 0 where unknown. */
  counts: number[];
  /** Common lookup only: the word of the common name this row is filed under. */
  words?: number[];
}

/** A top-taxa file: rows `starts[n]` up to `starts[n + 1]` are the most recorded taxa for `prefixes[n]`. */
export interface TopColumns extends NameColumns {
  prefixes: string[];
  starts: number[];
}

/** Each lookup's file boundaries (enough of each first sort key to tell it from the row before) and the top-taxa list's first prefixes, by file number. */
export interface SearchManifest extends Record<Lookup, string[]> {
  top: string[];
  generated: string;
  /** The GBIF download the iNaturalist IDs came from, which GBIF's terms require citing. */
  downloadDoi?: string;
}

/** A preview file, sorted by GBIF key. A photo ID of 0 means the taxon has no baked photo. */
export interface PreviewColumns {
  keys: number[];
  inatIds: number[];
  photoIds: number[];
  extensions: string[];
  licences: string[];
  creators: string[];
}

export const MANIFEST_PATH = `${SEARCH_DATA_PATH}/manifest.json`;
export const PREVIEW_LOOKUP_PATH = `${SEARCH_DATA_PATH}/preview.json`;

/** The path of one numbered file in a directory such as `first` or `preview`. */
export const filePath = (directory: Lookup | 'top' | 'preview', fileNumber: number) =>
  `${SEARCH_DATA_PATH}/${directory}/${fileNumber}.json`;

/** Whether this build searches names from the static files rather than live GBIF (`PUBLIC_NAME_SEARCH`). */
export const usesStaticNameSearch = () => env['PUBLIC_NAME_SEARCH'] === 'static';

/** One letter per rank the files hold. */
export const RANK_CODES = {
  K: 'KINGDOM',
  P: 'PHYLUM',
  C: 'CLASS',
  O: 'ORDER',
  F: 'FAMILY',
  G: 'GENUS',
  S: 'SPECIES',
  U: 'SUBSPECIES',
  V: 'VARIETY',
  R: 'FORM',
} as const satisfies Record<string, Rank>;
export type SearchRankCode = keyof typeof RANK_CODES;

/** Normalised words moved round so the word at `offset` comes first: how a row is filed under that word. */
export function filedUnder(normalisedName: string, offset: number): string {
  const words = normalisedName.split(' ');
  return [...words.slice(offset), ...words.slice(0, offset)].join(' ');
}

/** The sort key of one row in a lookup's file. */
export function sortKey(columns: NameColumns, lookup: Lookup, row: number): string {
  if (lookup === 'common') return filedUnder(normalise(columns.commons[row]!), columns.words?.[row] ?? 0);
  return filedUnder(normalise(columns.names[row]!), lookup === 'second' ? 1 : 0);
}

/** The number of the last entry below `target`, or -1. `entries` must be sorted. */
function lastBelow(entries: readonly string[], target: string): number {
  let low = 0;
  let high = entries.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (entries[middle]! < target) low = middle + 1;
    else high = middle;
  }
  return low - 1;
}

/** The inclusive file numbers that can hold keys starting with `prefix`, given each file's first key. */
export function filesForPrefix(firstKeys: readonly string[], prefix: string): { from: number; to: number } {
  // Keys equal to the prefix can run on from the end of the file before.
  const from = Math.max(0, lastBelow(firstKeys, prefix));
  // ￿ sorts after every normalised character, so this ends past every key with the prefix.
  const to = Math.max(from, lastBelow(firstKeys, `${prefix}￿`));
  return { from, to };
}

/** How many files `prefix` spans. */
export const fileSpan = ({ from, to }: { from: number; to: number }) => to - from + 1;

/** The top-taxa file that holds `prefix`: the last whose first prefix isn't after it. */
export function topFileFor(firstPrefixes: readonly string[], prefix: string): number {
  return Math.max(0, lastBelow(firstPrefixes, `${prefix} `));
}

/** The number of the file that holds `key`, given each file's first key. */
export function previewFileFor(firstKeys: readonly number[], key: number): number {
  let low = 0;
  let high = firstKeys.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (firstKeys[middle]! <= key) low = middle + 1;
    else high = middle;
  }
  return low - 1;
}
