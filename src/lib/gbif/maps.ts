import { tileBase } from './edge';
import { http } from './http';
import { toQueryString, yearRangeParam, type Params } from './params';
import type { BasisOfRecord, MapCapabilities } from './types';

/**
 * Tile URL builders. MapLibre needs templates with literal {z}/{x}/{y}, so the
 * query string is built here and appended.
 *
 * Verified behaviour: the density endpoint honours taxonKey, year,
 * basisOfRecord and country, but silently ignores mediaType. A "has photo"
 * filter therefore needs the (heavier) adhoc endpoint.
 */

export interface TileFilter {
  taxonKey?: number | undefined;
  year?: readonly [number, number] | null | undefined;
  basisOfRecord?: readonly BasisOfRecord[] | undefined;
  country?: string | undefined;
  hasImage?: boolean | undefined;
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
  return !!f.hasImage;
}

export function tileParams(f: TileFilter, s: TileStyle = {}, format: TileFormat = 'png'): Params {
  return {
    srs: s.srs ?? 'EPSG:3857',
    taxonKey: f.taxonKey,
    year: yearRangeParam(f.year),
    basisOfRecord: f.basisOfRecord,
    country: f.country,
    mediaType: f.hasImage ? 'StillImage' : undefined,
    bin: 'hex',
    hexPerTile: s.hexPerTile ?? 60,
    style: format === 'png' ? (s.style ?? 'purpleYellow-noborder.poly') : undefined,
  };
}

/** XYZ template for MapLibre. Uses adhoc only when a filter requires it. */
export function occurrenceTileTemplate(f: TileFilter, s: TileStyle = {}, format: TileFormat = 'png'): string {
  const kind = needsAdhoc(f) ? 'adhoc' : 'density';
  const qs = toQueryString(tileParams(f, s, format));
  return `${tileBase()}/v2/map/occurrence/${kind}/{z}/{x}/{y}${suffix(format)}${qs ? `?${qs}` : ''}`;
}

export function mapCapabilities(f: Pick<TileFilter, 'taxonKey' | 'country'> = {}): Promise<MapCapabilities> {
  return http().getJson('/v2/map/occurrence/density/capabilities.json', {
    taxonKey: f.taxonKey,
    country: f.country,
  });
}
