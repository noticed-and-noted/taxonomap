import { searchVernacular, suggestSpecies } from './species';
import type { Rank } from './types';

/**
 * Name search is behind an interface because GBIF's taxonomy is migrating to
 * ChecklistBank. Verified: /v1/species/suggest matches scientific names only,
 * and vernacular search ranks poorly, so the omnibox combines a baked
 * common-name index (Phase 2) with these live providers.
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
  search(q: string, signal?: AbortSignal): Promise<NameHit[]>;
}

export const gbifSuggestProvider: NameSearchProvider = {
  id: 'gbif-suggest',
  async search(q, signal) {
    const res = await suggestSpecies(q, { limit: 8 }, signal);
    return res
      .filter((r) => !r.synonym)
      .map((r) => ({
        key: r.key,
        scientificName: r.canonicalName ?? r.scientificName,
        rank: r.rank,
        source: 'suggest' as const,
      }));
  },
};

export const gbifVernacularProvider: NameSearchProvider = {
  id: 'gbif-vernacular',
  async search(q, signal) {
    const res = await searchVernacular(q, { limit: 10 }, signal);
    const needle = q.trim().toLowerCase();
    return res.results.map((r) => {
      const common =
        r.vernacularNames?.find((v) => v.language === 'eng' && v.vernacularName.toLowerCase().includes(needle)) ??
        r.vernacularNames?.find((v) => v.vernacularName.toLowerCase().includes(needle));
      return {
        key: r.key,
        scientificName: r.canonicalName ?? r.scientificName,
        rank: r.rank,
        ...(common && { commonName: common.vernacularName }),
        source: 'vernacular' as const,
      };
    });
  },
};
