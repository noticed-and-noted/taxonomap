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

/** Scientific matches score this much lower, so common names win ties. */
const SCIENTIFIC_DISCOUNT = 1.5;

/** Other English names score this much lower, so a rare alias doesn't tie a taxon's main name. */
const ALIAS_DISCOUNT = 0.5;

/**
 * Word matches score this. Aliases aren't discounted at this level: so many main names share a
 * word ("Wood Pigeon") that a discounted alias ("Rock Pigeon") would never surface.
 */
const WORD_MATCH = 2;

/** Another English name: normalised for matching, and as shown. */
interface Alias {
  text: string;
  name: string;
}

interface Entry {
  name: IndexedName;
  common: string;
  sci: string;
  aliases: Alias[];
}

interface Match {
  score: number;
  matchedName?: string;
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
  if (qWords.every((queryWord) => words.some((word) => word.startsWith(queryWord)))) return WORD_MATCH;
  return 0;
}

/** The better of a common-name and a scientific-name score, from normalised text. */
function bestScore(common: string, sci: string, query: string, qWords: string[]): number {
  return Math.max(score(common, query, qWords), score(sci, query, qWords) - SCIENTIFIC_DISCOUNT);
}

/** A score for another English name: discounted above word matches, so the main name wins those ties. */
function aliasScore(text: string, query: string, qWords: string[]): number {
  const aliasMatch = score(text, query, qWords);
  return aliasMatch > WORD_MATCH ? aliasMatch - ALIAS_DISCOUNT : aliasMatch;
}

/** The best of the main names' and the aliases' scores, naming the alias when one matched better. */
function bestMatch(entry: Omit<Entry, 'name'>, query: string, qWords: string[]): Match {
  let best: Match = { score: bestScore(entry.common, entry.sci, query, qWords) };
  for (const alias of entry.aliases) {
    const candidate = aliasScore(alias.text, query, qWords);
    if (candidate > best.score) best = { score: candidate, matchedName: alias.name };
  }
  return best;
}

/** Aliases from display names. */
function toAliases(names: readonly string[]): Alias[] {
  return names.map((name) => ({ text: normalise(name), name: name.trim() }));
}

/**
 * How well a hit's names match a query, scored like the index's own search,
 * so live GBIF hits can be ranked the same way. Other English names count too,
 * slightly discounted, since GBIF often matched on one of those.
 * @returns `score` (0 when no name matches; higher is better), and `matchedName`
 *   when another English name matched better than the main ones.
 */
export function matchHit(hit: Pick<NameHit, 'scientificName' | 'commonName' | 'englishNames'>, query: string): Match {
  const normalisedQuery = normalise(query);
  const names = {
    common: normalise(hit.commonName ?? ''),
    sci: normalise(hit.scientificName),
    aliases: toAliases(hit.englishNames ?? []),
  };
  return bestMatch(names, normalisedQuery, normalisedQuery.split(' '));
}

/** In-memory search over the baked names, matching common and scientific names by word prefix. */
export class NameIndex {
  readonly #entries: Entry[];
  readonly #byKey: Map<number, IndexedName>;

  constructor(rows: readonly NameRow[]) {
    this.#entries = rows.map((row) => {
      const name = decode(row);
      return {
        name,
        common: normalise(name.commonName ?? ''),
        sci: normalise(name.scientificName),
        aliases: toAliases(row[6] ?? []),
      };
    });
    this.#byKey = new Map(this.#entries.map((entry) => [entry.name.key, entry.name]));
  }

  search(query: string, limit = 20): NameHit[] {
    const normalisedQuery = normalise(query);
    if (normalisedQuery.length < 2) return [];
    const qWords = normalisedQuery.split(' ');
    const hits: { entry: Entry; match: Match }[] = [];
    for (const entry of this.#entries) {
      const match = bestMatch(entry, normalisedQuery, qWords);
      if (match.score > 0) hits.push({ entry, match });
    }
    // Rows are pre-sorted by count; sort is stable, so ties keep count order.
    hits.sort((left, right) => right.match.score - left.match.score);
    return hits.slice(0, limit).map(({ entry, match }) => ({
      ...entry.name,
      ...(match.matchedName && { matchedName: match.matchedName }),
      source: 'index' as const,
    }));
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
