/**
 * The slice of the cubes a filter asks for: its taxa (each a rank and a name, as the cubes key on names)
 * and the filters every cube holds (years, months, record type, media). In cube mode every view reads
 * the cubes; the filters they can't answer are greyed out and cleared (filters.ts), so never reach here.
 */
import type { OccurrenceFilter } from '~/lib/gbif';
import { MEDIA_PHOTO, MEDIA_SOUND } from './filters';

/** Below this zoom the view is the whole world (MapCanvas uses the same for its bounds). */
export const WORLD_MAX_ZOOM = 2.5;

/** The ranks the cubes are cut by; "life" is every record. */
export const CUBE_RANKS = ['life', 'kingdom', 'phylum', 'class', 'order', 'family', 'genus', 'species'] as const;
export type CubeRank = (typeof CUBE_RANKS)[number];

/** One taxon in the cubes: its rank, and its scientific name at that rank ("Life" for all of life). */
export interface CubeTaxon {
  rank: CubeRank;
  taxon: string;
}

/** Every record, when no taxon is picked. */
export const LIFE: CubeTaxon = { rank: 'life', taxon: 'Life' };

/** The filters every cube holds besides taxon and place; null (or 0 for media) leaves one out. */
export interface CubeFilters {
  year: readonly [number, number] | null;
  months: readonly number[] | null;
  basis: readonly string[] | null;
  /** The media a record must have one of, as bits (photo 1, sound 2), as GBIF ORs them; 0 for any. */
  media: number;
}

/** A slice of the cubes: records of any of the taxa, under the filters. */
export interface CubeQuery extends CubeFilters {
  taxa: readonly CubeTaxon[];
}

/** A taxon's name and rank by key (the app's lookupTaxonRank). */
export type TaxonLookup = (key: number) => Promise<{ scientificName: string; rank: string } | null>;

const isCubeRank = (rank: string | undefined): rank is CubeRank => CUBE_RANKS.includes(rank as CubeRank);

/** The selected taxon keys, from either form the filter takes. */
function taxonKeys(filter: OccurrenceFilter): readonly number[] {
  if (filter.taxonKeys?.length) return filter.taxonKeys;
  return filter.taxonKey === undefined ? [] : [filter.taxonKey];
}

/** The cube filters in an occurrence filter. */
export function cubeFilters(filter: OccurrenceFilter): CubeFilters {
  const months = filter.months?.length ? filter.months : filter.month ? [filter.month] : null;
  return {
    year: filter.year ?? null,
    months,
    basis: filter.basisOfRecord?.length ? filter.basisOfRecord : null,
    media: (filter.hasImage ? MEDIA_PHOTO : 0) | (filter.hasSound ? MEDIA_SOUND : 0),
  };
}

/** A taxon key as a cube taxon, or null for one the cubes don't hold (a subspecies, say) or can't name. */
async function cubeTaxon(key: number, lookup: TaxonLookup): Promise<CubeTaxon | null> {
  const found = await lookup(key);
  const rank = found?.rank.toLowerCase();
  return found && isCubeRank(rank) ? { rank, taxon: found.scientificName } : null;
}

/**
 * The cube slice for a filter.
 * @returns null when a taxon is at a rank the cubes don't hold, or can't be looked up
 */
export async function cubeQueryFor(filter: OccurrenceFilter, lookup: TaxonLookup): Promise<CubeQuery | null> {
  const keys = taxonKeys(filter);
  const taxa = keys.length ? await Promise.all(keys.map((key) => cubeTaxon(key, lookup))) : [LIFE];
  if (taxa.some((taxon) => taxon === null)) return null;
  return { taxa: taxa as CubeTaxon[], ...cubeFilters(filter) };
}
