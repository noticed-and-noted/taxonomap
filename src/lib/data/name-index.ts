import type { NameHit, NameSearchProvider } from '~/lib/gbif/names';
import type { Rank } from '~/lib/gbif/types';
import { loadSnapshot } from './load';
import { RANK_BY_CODE } from './ranks';
import type { NameRow } from './types';

/** Lower-case, strip accents and punctuation. */
export function normalise(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** One taxon in the index. */
export interface IndexedName {
  key: number;
  rank: Rank;
  scientificName: string;
  commonName?: string;
  /** Occurrence records. */
  count: number;
}

/** The baked row format, [key, rank code, scientific name, common name | null, count], decoded. */
function decode([key, code, scientificName, commonName, count]: NameRow): IndexedName {
  return { key, rank: RANK_BY_CODE[code], scientificName, ...(commonName && { commonName }), count };
}

interface Entry {
  name: IndexedName;
  common: string;
  sci: string;
}

/**
 * Score a candidate: exact > full prefix > every query word prefixes a word.
 * Returns 0 when it does not match. Scientific matches are discounted so
 * "robin" prefers robins over the genus Robinia, unless the scientific name
 * matches exactly or as a full prefix and nothing common-named does.
 */
function score(text: string, q: string, qWords: string[]): number {
  if (!text) return 0;
  if (text === q) return 4;
  if (text.startsWith(q)) return 3;
  const words = text.split(' ');
  if (qWords.every((w) => words.some((x) => x.startsWith(w)))) return 2;
  return 0;
}

export class NameIndex {
  readonly #entries: Entry[];
  readonly #byKey: Map<number, IndexedName>;

  constructor(rows: readonly NameRow[]) {
    this.#entries = rows.map(decode).map((name) => ({
      name,
      common: normalise(name.commonName ?? ''),
      sci: normalise(name.scientificName),
    }));
    this.#byKey = new Map(this.#entries.map((e) => [e.name.key, e.name]));
  }

  search(query: string, limit = 8): NameHit[] {
    const q = normalise(query);
    if (q.length < 2) return [];
    const qWords = q.split(' ');
    const hits: { e: Entry; s: number }[] = [];
    for (const e of this.#entries) {
      const s = Math.max(score(e.common, q, qWords), score(e.sci, q, qWords) - 1.5);
      if (s > 0) hits.push({ e, s });
    }
    // Rows are pre-sorted by count; sort is stable, so ties keep count order.
    hits.sort((a, b) => b.s - a.s);
    return hits.slice(0, limit).map(({ e }) => ({ ...e.name, source: 'index' as const }));
  }

  get(key: number): IndexedName | undefined {
    return this.#byKey.get(key);
  }
}

let indexPromise: Promise<NameIndex | null> | undefined;

/** Lazily load /data/names.json (first omnibox focus). */
export function loadNameIndex(): Promise<NameIndex | null> {
  indexPromise ??= loadSnapshot('names').then((s) => (s ? new NameIndex(s.names) : null));
  return indexPromise;
}

/**
 * The index if it is ready within `ms`, else null (callers fall back to live
 * lookups rather than block the UI on a slow network).
 */
export function nameIndexWithin(ms = 1500): Promise<NameIndex | null> {
  return Promise.race([loadNameIndex(), new Promise<null>((r) => setTimeout(() => r(null), ms))]);
}

export const bakedIndexProvider: NameSearchProvider = {
  id: 'baked-index',
  async search(q) {
    const idx = await loadNameIndex();
    return idx ? idx.search(q) : [];
  },
};
