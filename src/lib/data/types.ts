/** Shapes of the baked /data/*.json snapshots (shared by build and islands). */

export interface BakedMeta {
  v: 1;
  generated: string;
}

/** /data/years.json — global records per year. */
export interface YearsSnapshot extends BakedMeta {
  total: number;
  /** [year, count] ascending by year. */
  years: [number, number][];
}

/** Rank codes used in the name index. */
export type RankCode = 'K' | 'P' | 'C' | 'O' | 'F' | 'G' | 'S';

/** [key, rank, scientificName, commonName | null, occurrenceCount, iNaturalistTaxonId | null?, otherEnglishNames?] */
export type NameRow = [number, RankCode, string, string | null, number, (number | null)?, string[]?];

/** /data/names.json — common-name index for the omnibox, descending by count. */
export interface NamesSnapshot extends BakedMeta {
  names: NameRow[];
  /** Its iNaturalist IDs all came through GBIF's iNaturalist records; earlier bakes also searched by name. */
  inatIdsFromRecords?: true;
}

/** Tree node rank codes (baked levels are K–O; lazy levels add F, G, S). */
export type TreeRank = RankCode;

/** Compact tree node. */
export interface TreeNodeRow {
  /** GBIF key */
  k: number;
  /** scientific name */
  n: string;
  /** English common name */
  c?: string;
  r: TreeRank;
  /** occurrence records */
  o: number;
  /** accepted species (backbone) */
  s: number;
  /** parent key (absent for kingdoms) */
  p?: number;
}

/** /data/tree.json — kingdom → order with counts. */
export interface TreeSnapshot extends BakedMeta {
  nodes: TreeNodeRow[];
}
