import type { NameHit, NameSearchProvider } from '~/lib/gbif/names';
import type { Rank } from '~/lib/gbif/types';
import { loadSnapshot } from './load';
import { RANK_BY_CODE } from './ranks';
import type { NameRow } from './types';

/** Lower-case, strip accents and punctuation. */
export function normalise(text: string): string {
  return text
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
  /** iNaturalist's taxon for it (species only), when the bake matched one. */
  inatId?: number;
}

/** The baked row format, [key, rank code, scientific name, common name | null, count, iNaturalist ID?], decoded. */
function decode([key, code, scientificName, commonName, count, inatId]: NameRow): IndexedName {
  return {
    key,
    rank: RANK_BY_CODE[code],
    scientificName,
    ...(commonName && { commonName }),
    count,
    ...(inatId && { inatId }),
  };
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
function score(text: string, query: string, qWords: string[]): number {
  if (!text) return 0;
  if (text === query) return 4;
  if (text.startsWith(query)) return 3;
  const words = text.split(' ');
  if (qWords.every((queryWord) => words.some((word) => word.startsWith(queryWord)))) return 2;
  return 0;
}

/** In-memory search over the baked names, matching common and scientific names by word prefix. */
export class NameIndex {
  readonly #entries: Entry[];
  readonly #byKey: Map<number, IndexedName>;

  constructor(rows: readonly NameRow[]) {
    this.#entries = rows.map(decode).map((name) => ({
      name,
      common: normalise(name.commonName ?? ''),
      sci: normalise(name.scientificName),
    }));
    this.#byKey = new Map(this.#entries.map((entry) => [entry.name.key, entry.name]));
  }

  search(query: string, limit = 20): NameHit[] {
    const normalisedQuery = normalise(query);
    if (normalisedQuery.length < 2) return [];
    const qWords = normalisedQuery.split(' ');
    const hits: { entry: Entry; score: number }[] = [];
    for (const entry of this.#entries) {
      const bestScore = Math.max(
        score(entry.common, normalisedQuery, qWords),
        score(entry.sci, normalisedQuery, qWords) - 1.5,
      );
      if (bestScore > 0) hits.push({ entry, score: bestScore });
    }
    // Rows are pre-sorted by count; sort is stable, so ties keep count order.
    hits.sort((left, right) => right.score - left.score);
    return hits.slice(0, limit).map(({ entry }) => ({ ...entry.name, source: 'index' as const }));
  }

  get(key: number): IndexedName | undefined {
    return this.#byKey.get(key);
  }
}

let indexPromise: Promise<NameIndex | null> | undefined;
let loaded: NameIndex | null = null;

/** Lazily load /data/names.json (first omnibox focus). */
export function loadNameIndex(): Promise<NameIndex | null> {
  indexPromise ??= loadSnapshot('names').then((snapshot) => (loaded = snapshot ? new NameIndex(snapshot.names) : null));
  return indexPromise;
}

/** The index if it has already loaded, without starting a load (for callers that only use it when it's free). */
export function nameIndexIfLoaded(): NameIndex | null {
  return loaded;
}

/**
 * The index if it is ready within `ms`, else null (callers fall back to live
 * lookups rather than block the UI on a slow network).
 */
export function nameIndexWithin(ms = 1500): Promise<NameIndex | null> {
  return Promise.race([loadNameIndex(), new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);
}

export const bakedIndexProvider: NameSearchProvider = {
  id: 'baked-index',
  async search(query) {
    const nameIndex = await loadNameIndex();
    return nameIndex ? nameIndex.search(query) : [];
  },
};
