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

/** /data/countries.json — records per country. */
export interface CountriesSnapshot extends BakedMeta {
  /** [ISO2, count] descending by count. */
  countries: [string, number][];
}

/** Rank codes used in the name index. */
export type RankCode = 'K' | 'P' | 'C' | 'O' | 'F' | 'G' | 'S';

/** [key, rank, scientificName, commonName | null, occurrenceCount] */
export type NameRow = [number, RankCode, string, string | null, number];

/** /data/names.json — common-name index for the omnibox, descending by count. */
export interface NamesSnapshot extends BakedMeta {
  names: NameRow[];
}
