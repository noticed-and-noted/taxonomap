import { normalise } from '~/lib/data/name-index';
import { englishName } from '~/lib/species/names';

import { searchVernacular, suggestSpecies } from './species';
import type { Rank } from './types';

/**
 * Name search is behind an interface because GBIF's taxonomy is migrating to
 * ChecklistBank. Verified: /v1/species/suggest matches scientific names only,
 * and vernacular search ranks poorly, so the omnibox combines a baked
 * common-name index with these live providers.
 */
export interface NameHit {
  key: number;
  scientificName: string;
  commonName?: string;
  rank: Rank;
  /** Occurrence count when known (baked index), used for ranking. */
  count?: number;
  source: 'index' | 'suggest' | 'vernacular';
}

export interface NameSearchProvider {
  readonly id: string;
  search(query: string, signal?: AbortSignal): Promise<NameHit[]>;
}

export const gbifSuggestProvider: NameSearchProvider = {
  id: 'gbif-suggest',
  async search(query, signal) {
    const response = await suggestSpecies(query, { limit: 20 }, signal);
    return response
      .filter((hit) => !hit.synonym)
      .map((hit) => ({
        key: hit.key,
        scientificName: hit.canonicalName ?? hit.scientificName,
        rank: hit.rank,
        source: 'suggest' as const,
      }));
  },
};

export const gbifVernacularProvider: NameSearchProvider = {
  id: 'gbif-vernacular',
  async search(query, signal) {
    const response = await searchVernacular(query, { limit: 10 }, signal);
    const needle = normalise(query);
    return response.results.map((hit) => {
      const names = hit.vernacularNames ?? [];
      // The main English name, not the alias that matched: one old alias shouldn't relabel a species.
      const common =
        englishName(names) ??
        names.find((vernacular) => normalise(vernacular.vernacularName).includes(needle))?.vernacularName;
      return {
        key: hit.key,
        scientificName: hit.canonicalName ?? hit.scientificName,
        rank: hit.rank,
        ...(common && { commonName: common }),
        source: 'vernacular' as const,
      };
    });
  },
};

/** Broadest rank first; ranks not listed sort after these. */
const RANK_ORDER: readonly Rank[] = [
  'KINGDOM',
  'PHYLUM',
  'CLASS',
  'ORDER',
  'FAMILY',
  'GENUS',
  'SPECIES',
  'SUBSPECIES',
  'VARIETY',
  'FORM',
];

function rankPosition(rank: Rank): number {
  const position = RANK_ORDER.indexOf(rank);
  return position === -1 ? RANK_ORDER.length : position;
}

/** Hits ordered broadest rank first (genus before species), keeping relevance order within a rank. */
export function sortByRank(hits: readonly NameHit[]): NameHit[] {
  return [...hits].sort((first, second) => rankPosition(first.rank) - rankPosition(second.rank));
}
