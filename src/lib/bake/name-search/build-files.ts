/** Turns taxa into the static search and preview files. Pure, so it can be tested without any downloads. */
import { normalise } from '~/lib/data/name-index';
import {
  fileSpan,
  filedUnder,
  filesForPrefix,
  MAX_FILES_PER_QUERY,
  MAX_HITS,
  ROWS_PER_FILE,
  type Lookup,
  type NameColumns,
  type PreviewColumns,
  type SearchRankCode,
  type TopColumns,
} from '~/lib/name-search/format';
import type { PreviewRow } from '~/lib/name-search/preview';

/** The shortest query that reaches these files (`MIN_LIVE_QUERY`). */
const SHORTEST_PREFIX = 3;
/** One-letter words ("s" in "St. John's") aren't worth a row of their own. */
const SHORTEST_COMMON_WORD = 2;

/** A taxon to file. */
export interface SearchTaxon {
  key: number;
  rank: SearchRankCode;
  name: string;
  commonName?: string;
  count: number;
}

/** A taxon filed under one sort key. */
interface FiledRow {
  sortKey: string;
  taxon: SearchTaxon;
  word: number;
}

/** Sorted rows of one lookup. */
function filedRows(taxa: readonly SearchTaxon[], lookup: Lookup): FiledRow[] {
  const rows: FiledRow[] = [];
  for (const taxon of taxa) {
    if (lookup === 'common') addCommonRows(rows, taxon);
    else addScientificRow(rows, taxon, lookup === 'second' ? 1 : 0);
  }
  return rows.sort((left, right) => (left.sortKey < right.sortKey ? -1 : left.sortKey > right.sortKey ? 1 : 0));
}

/** Files a taxon under one word of its scientific name, if it has that word. */
function addScientificRow(rows: FiledRow[], taxon: SearchTaxon, word: number) {
  const name = normalise(taxon.name);
  if (name && name.split(' ').length > word) rows.push({ sortKey: filedUnder(name, word), taxon, word });
}

/** Files a taxon under every word of its common name, so "blackbird" finds "Common Blackbird". */
function addCommonRows(rows: FiledRow[], taxon: SearchTaxon) {
  const name = normalise(taxon.commonName ?? '');
  if (!name) return;
  name.split(' ').forEach((text, word) => {
    if (text.length >= SHORTEST_COMMON_WORD) rows.push({ sortKey: filedUnder(name, word), taxon, word });
  });
}

/** Taxa as columns. */
function nameColumns(taxa: readonly SearchTaxon[]): NameColumns {
  return {
    names: taxa.map((taxon) => taxon.name),
    commons: taxa.map((taxon) => taxon.commonName ?? ''),
    keys: taxa.map((taxon) => taxon.key),
    ranks: taxa.map((taxon) => taxon.rank).join(''),
    counts: taxa.map((taxon) => taxon.count),
  };
}

/** A lookup's files, and the rows behind them. */
export interface BuiltLookup {
  files: NameColumns[];
  firstKeys: string[];
  rows: FiledRow[];
}

/** The shortest start of a file's first key that still sorts after the row before it, which keeps the lookup list small. */
function fileBoundary(previousKey: string, firstKey: string): string {
  let length = 1;
  while (length < firstKey.length && firstKey.slice(0, length) <= previousKey) length++;
  return firstKey.slice(0, length);
}

/** A lookup's sorted rows, cut into evenly sized files. */
export function buildLookup(taxa: readonly SearchTaxon[], lookup: Lookup): BuiltLookup {
  const rows = filedRows(taxa, lookup);
  const files: NameColumns[] = [];
  const firstKeys: string[] = [];
  for (let start = 0; start < rows.length; start += ROWS_PER_FILE) {
    const chunk = rows.slice(start, start + ROWS_PER_FILE);
    const columns = nameColumns(chunk.map((row) => row.taxon));
    files.push(lookup === 'common' ? { ...columns, words: chunk.map((row) => row.word) } : columns);
    firstKeys.push(fileBoundary(rows[start - 1]?.sortKey ?? '', chunk[0]!.sortKey));
  }
  return { files, firstKeys, rows };
}

/** The most recorded taxa in a run of rows, at most MAX_HITS. One pass, as the widest run is huge. */
function mostRecorded(rows: readonly FiledRow[], start: number, end: number): SearchTaxon[] {
  const top: SearchTaxon[] = [];
  for (let position = start; position < end; position++) {
    const { taxon } = rows[position]!;
    if (top.length === MAX_HITS && taxon.count <= top.at(-1)!.count) continue;
    if (top.includes(taxon)) continue;
    const place = top.findIndex((held) => held.count < taxon.count);
    top.splice(place === -1 ? top.length : place, 0, taxon);
    if (top.length > MAX_HITS) top.pop();
  }
  return top;
}

/** Calls `visit` with every prefix too wide to read from this lookup's files, and the rows under it. */
function walkWidePrefixes(
  { rows, firstKeys }: Pick<BuiltLookup, 'rows' | 'firstKeys'>,
  range: { start: number; end: number; length: number },
  visit: (prefix: string, start: number, end: number) => void,
) {
  let start = range.start;
  while (start < range.end) {
    const prefix = rows[start]!.sortKey.slice(0, range.length);
    let end = start + 1;
    while (end < range.end && rows[end]!.sortKey.startsWith(prefix)) end++;
    if (prefix.length === range.length && fileSpan(filesForPrefix(firstKeys, prefix)) > MAX_FILES_PER_QUERY) {
      if (!prefix.endsWith(' ')) visit(prefix, start, end);
      walkWidePrefixes({ rows, firstKeys }, { start, end, length: range.length + 1 }, visit);
    }
    start = end;
  }
}

/** The top taxa for every too-wide prefix in any lookup, most recorded first. */
function topTaxaByPrefix(lookups: readonly BuiltLookup[]): Map<string, SearchTaxon[]> {
  const candidates = new Map<string, Set<SearchTaxon>>();
  for (const lookup of lookups) {
    const whole = { start: 0, end: lookup.rows.length, length: SHORTEST_PREFIX };
    walkWidePrefixes(lookup, whole, (prefix, start, end) => {
      const held = candidates.get(prefix) ?? new Set();
      for (const taxon of mostRecorded(lookup.rows, start, end)) held.add(taxon);
      candidates.set(prefix, held);
    });
  }
  const byCount = (left: SearchTaxon, right: SearchTaxon) => right.count - left.count;
  return new Map([...candidates].map(([prefix, taxa]) => [prefix, [...taxa].sort(byCount).slice(0, MAX_HITS)]));
}

/** A prefix and its top taxa. */
type TopEntry = [string, SearchTaxon[]];

/** Top-taxa files, grouped so each holds about ROWS_PER_FILE rows and a prefix's rows are never split. */
export function buildTopFiles(lookups: readonly BuiltLookup[]): { files: TopColumns[]; firstPrefixes: string[] } {
  const entries = [...topTaxaByPrefix(lookups)].sort(([left], [right]) => (left < right ? -1 : 1));
  const groups: TopEntry[][] = [[]];
  let groupRows = 0;
  for (const entry of entries) {
    groups.at(-1)!.push(entry);
    groupRows += entry[1].length;
    if (groupRows >= ROWS_PER_FILE) {
      groups.push([]);
      groupRows = 0;
    }
  }
  const filled = groups.filter((group) => group.length);
  return { files: filled.map(topColumns), firstPrefixes: filled.map((group) => group[0]![0]) };
}

/** A group of prefixes as one file. */
function topColumns(group: readonly TopEntry[]): TopColumns {
  const starts: number[] = [];
  let offset = 0;
  for (const [, taxa] of group) {
    starts.push(offset);
    offset += taxa.length;
  }
  return { ...nameColumns(group.flatMap(([, taxa]) => taxa)), prefixes: group.map(([prefix]) => prefix), starts };
}

/** Preview rows sorted by GBIF key and cut into evenly sized files, with each file's first key. */
export function buildPreviewFiles(rows: ReadonlyMap<number, PreviewRow>): {
  files: PreviewColumns[];
  firstKeys: number[];
} {
  const sorted = [...rows].sort(([left], [right]) => left - right);
  const files: PreviewColumns[] = [];
  const firstKeys: number[] = [];
  for (let start = 0; start < sorted.length; start += ROWS_PER_FILE) {
    const chunk = sorted.slice(start, start + ROWS_PER_FILE);
    files.push({
      keys: chunk.map(([key]) => key),
      inatIds: chunk.map(([, row]) => row.inatId),
      photoIds: chunk.map(([, row]) => row.photo?.photoId ?? 0),
      extensions: chunk.map(([, row]) => row.photo?.extension ?? ''),
      licences: chunk.map(([, row]) => row.photo?.licence ?? ''),
      creators: chunk.map(([, row]) => row.photo?.creator ?? ''),
    });
    firstKeys.push(chunk[0]![0]);
  }
  return { files, firstKeys };
}
