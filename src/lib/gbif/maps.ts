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

export function needsAdhoc(f: TileFilter): boolean {
  return hasRefinements(f) || (f.taxonKeys?.length ?? 0) > 1 || 'acceptedTaxonKey' in taxonParams(f);
}

export function tileParams(f: TileFilter, s: TileStyle = {}, format: TileFormat = 'png'): Params {
  return {
    srs: s.srs ?? 'EPSG:3857',
    ...taxonParams(f),
    year: yearRangeParam(f.year),
    basisOfRecord: f.basisOfRecord,
    country: f.country,
    ...refinementParams(f),
    bin: 'hex',
    hexPerTile: s.hexPerTile ?? 60,
    style: format === 'png' ? (s.style ?? 'purpleYellow-noborder.poly') : undefined,
  };
}

/** XYZ template for MapLibre. Uses adhoc only when a filter requires it. */
export function occurrenceTileTemplate(f: TileFilter, s: TileStyle = {}, format: TileFormat = 'png'): string {
  const kind = needsAdhoc(f) ? 'adhoc' : 'density';
  const qs = toQueryString(tileParams(f, s, format));
  return `${GBIF_TILE_BASE}/v2/map/occurrence/${kind}/{z}/{x}/{y}${suffix(format)}${qs ? `?${qs}` : ''}`;
}

export function mapCapabilities(f: Pick<TileFilter, 'taxonKey' | 'country'> = {}): Promise<MapCapabilities> {
  return http().getJson('/v2/map/occurrence/density/capabilities.json', {
    taxonKey: f.taxonKey,
    country: f.country,
  });
}

/** GBIF's own raster basemap (CORS-enabled), used by the static mini-map. */
export function gbifBasemapTile(z: number, x: number, y: number, theme: 'dark' | 'light' = 'dark'): string {
  return `https://tile.gbif.org/3857/omt/${z}/${x}/${y}@1x.png?style=gbif-${theme === 'dark' ? 'dark' : 'light'}`;
}

/** A concrete density PNG tile (not a template). */
export function occurrenceTileUrl(f: TileFilter, z: number, x: number, y: number, s: TileStyle = {}): string {
  return occurrenceTileTemplate(f, s, 'png')
    .replace('{z}', String(z))
    .replace('{x}', String(x))
    .replace('{y}', String(y));
}
