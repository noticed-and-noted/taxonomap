import { GBIF_TILE_BASE } from './config';
import { http } from './http';
import { hasRefinements, refinementParams, taxonParams, type Refinements } from './occurrence';
import { toQueryString, yearRangeParam, type Params } from './params';
import type { BasisOfRecord, MapCapabilities } from './types';

/**
 * Tile URL builders. MapLibre needs templates with literal {z}/{x}/{y}, so the
 * query string is built here and appended.
 *
 * Verified behaviour: the density endpoint honours taxonKey, year,
 * basisOfRecord and country, but silently ignores mediaType, month and the
 * other refinements, and rejects a repeated taxonKey (400). Those filters
 * therefore need the (heavier) adhoc endpoint, as does acceptedTaxonKey.
 */

export interface TileFilter extends Refinements {
  taxonKey?: number | undefined;
  /** Several taxa, OR'd (adhoc only when more than one). */
  taxonKeys?: readonly number[] | undefined;
  /** acceptedTaxonKey instead of taxonKey (adhoc only). */
  exactTaxon?: boolean | undefined;
  year?: readonly [number, number] | null | undefined;
  basisOfRecord?: readonly BasisOfRecord[] | undefined;
  country?: string | undefined;
}

export interface TileStyle {
  /** Hex bins per 512px tile. */
  hexPerTile?: number;
  /** GBIF server-side style for PNG tiles, e.g. "purpleYellow-noborder.poly". */
  style?: string;
  srs?: 'EPSG:3857';
}

export type TileFormat = 'png' | 'mvt';

function suffix(format: TileFormat): string {
  return format === 'png' ? '@1x.png' : '.mvt';
}

/** Whether the filter needs GBIF's ad hoc tiles, because the density tiles cannot apply it. */
export function needsAdhoc(filter: TileFilter): boolean {
  return hasRefinements(filter) || (filter.taxonKeys?.length ?? 0) > 1 || 'acceptedTaxonKey' in taxonParams(filter);
}

/** Query parameters for a map tile request: the filter plus the tile style and format. */
export function tileParams(filter: TileFilter, style: TileStyle = {}, format: TileFormat = 'png'): Params {
  return {
    srs: style.srs ?? 'EPSG:3857',
    ...taxonParams(filter),
    year: yearRangeParam(filter.year),
    basisOfRecord: filter.basisOfRecord,
    country: filter.country,
    ...refinementParams(filter),
    bin: 'hex',
    hexPerTile: style.hexPerTile ?? 60,
    style: format === 'png' ? (style.style ?? 'purpleYellow-noborder.poly') : undefined,
  };
}

/** XYZ template for MapLibre. Uses adhoc only when a filter requires it. */
export function occurrenceTileTemplate(filter: TileFilter, style: TileStyle = {}, format: TileFormat = 'png'): string {
  const kind = needsAdhoc(filter) ? 'adhoc' : 'density';
  // Density tiles leave out records with geospatial issues; adhoc ones must be told to, or their cells
  // disagree with the area queries (a cell of only flagged records shows, then counts as empty).
  const params = { ...tileParams(filter, style, format), hasGeospatialIssue: kind === 'adhoc' ? false : undefined };
  const queryString = toQueryString(params);
  return `${GBIF_TILE_BASE}/v2/map/occurrence/${kind}/{z}/{x}/{y}${suffix(format)}${queryString ? `?${queryString}` : ''}`;
}

/** What GBIF's map API holds for a filter (e.g. the year range with data). */
export function mapCapabilities(filter: Pick<TileFilter, 'taxonKey' | 'country'> = {}): Promise<MapCapabilities> {
  return http().getJson('/v2/map/occurrence/density/capabilities.json', {
    taxonKey: filter.taxonKey,
    country: filter.country,
  });
}

/** GBIF's own raster basemap (CORS-enabled), used by the static mini-map. */
export function gbifBasemapTile(zoom: number, tileX: number, tileY: number, theme: 'dark' | 'light' = 'dark'): string {
  return `https://tile.gbif.org/3857/omt/${zoom}/${tileX}/${tileY}@1x.png?style=gbif-${theme === 'dark' ? 'dark' : 'light'}`;
}

/** A concrete density PNG tile (not a template). */
export function occurrenceTileUrl(
  filter: TileFilter,
  zoom: number,
  tileX: number,
  tileY: number,
  style: TileStyle = {},
): string {
  return occurrenceTileTemplate(filter, style, 'png')
    .replace('{z}', String(zoom))
    .replace('{x}', String(tileX))
    .replace('{y}', String(tileY));
}
