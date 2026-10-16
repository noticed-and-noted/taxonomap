/** The one-letter rank codes used in the baked snapshots, and the GBIF ranks they stand for. */
import type { Rank } from '~/lib/gbif/types';
import type { RankCode } from './types';

export const RANK_BY_CODE = {
  K: 'KINGDOM',
  P: 'PHYLUM',
  C: 'CLASS',
  O: 'ORDER',
  F: 'FAMILY',
  G: 'GENUS',
  S: 'SPECIES',
} as const satisfies Record<RankCode, Rank>;

/** GBIF rank → code; undefined for ranks the snapshots do not use (e.g. SUBSPECIES). */
export const CODE_BY_RANK = Object.fromEntries(
  Object.entries(RANK_BY_CODE).map(([code, rank]) => [rank, code]),
) as Partial<Record<Rank, RankCode>>;
