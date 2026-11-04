/**
 * Whether the map's hexes can come from the cubes, and which slice of them. The map cube holds one taxon
 * (or all of life), years and place; any other filter keeps the map on GBIF's tiles. So does the world
 * view with no year range, which GBIF's tile cache usually answers fastest.
 */
import type { OccurrenceFilter } from '~/lib/gbif';

/** Below this zoom the view is the whole world (MapCanvas uses the same for its bounds). */
export const WORLD_MAX_ZOOM = 2.5;

/** The ranks the cubes are cut by; "life" is every record. */
export const CUBE_RANKS = ['life', 'kingdom', 'phylum', 'class', 'order', 'family', 'genus', 'species'] as const;
export type CubeRank = (typeof CUBE_RANKS)[number];

/** One taxon's slice of the map cube, and the years to count. */
export interface CubeQuery {
  rank: CubeRank;
  /** The scientific name at that rank ("Life" for all of life): the cubes key on names. */
  taxon: string;
  year: readonly [number, number] | null;
}

/** A taxon's name and rank by key (the app's lookupTaxon). */
export type TaxonLookup = (key: number) => Promise<{ scientificName: string; rank: string } | null>;

/** Filters the map cube holds; any other set filter needs GBIF. */
const CUBE_FILTERS = new Set(['taxonKey', 'taxonKeys', 'year']);

const isSet = (value: unknown) =>
  value !== undefined && value !== null && value !== false && !(Array.isArray(value) && !value.length);

const isCubeRank = (rank: string | undefined): rank is CubeRank => CUBE_RANKS.includes(rank as CubeRank);

/** The selected taxon keys, from either form the filter takes. */
function taxonKeys(filter: OccurrenceFilter): readonly number[] {
  if (filter.taxonKeys?.length) return filter.taxonKeys;
  return filter.taxonKey === undefined ? [] : [filter.taxonKey];
}

/** Whether the cubes could serve this filter at this zoom, before looking the taxon up. */
export function cubesCanServe(filter: OccurrenceFilter, zoom: number): boolean {
  const onlyCubeFilters = Object.entries(filter).every(([name, value]) => !isSet(value) || CUBE_FILTERS.has(name));
  if (!onlyCubeFilters || taxonKeys(filter).length > 1) return false;
  return zoom >= WORLD_MAX_ZOOM || isSet(filter.year);
}

/**
 * The cube slice for a filter at a zoom, or null when the map should stay on GBIF: other filters set,
 * several taxa, the plain world view, or a taxon at a rank the cubes don't hold (a subspecies, say).
 */
export async function cubeQueryFor(
  filter: OccurrenceFilter,
  zoom: number,
  lookup: TaxonLookup,
): Promise<CubeQuery | null> {
  if (!cubesCanServe(filter, zoom)) return null;
  const year = filter.year ?? null;
  const [key] = taxonKeys(filter);
  if (key === undefined) return { rank: 'life', taxon: 'Life', year };
  const taxon = await lookup(key);
  const rank = taxon?.rank.toLowerCase();
  if (!taxon || !isCubeRank(rank)) return null;
  return { rank, taxon: taxon.scientificName, year };
}
