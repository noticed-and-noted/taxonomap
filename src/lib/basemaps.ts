/**
 * Basemap catalogue (free/open sources, no API keys, CORS-enabled —
 * verified 2026-10-12; CARTO's raster basemaps now return "API key
 * required" tiles, so they are not used). Override with PUBLIC_BASEMAP_*.
 *
 * "plain" is an OpenFreeMap vector style that follows the site theme; its
 * label layers are drawn above the occurrence hexes, and over the satellite
 * imagery too.
 */
import { env } from '~/lib/env';

export type BasemapId = 'plain' | 'satellite';
export type Theme = 'dark' | 'light';

export interface RasterDef {
  kind: 'raster';
  tiles: string[];
  tileSize: number;
  maxzoom: number;
  attribution: string;
}

export interface VectorDef {
  kind: 'vector';
  styleUrl: string;
}

export interface BasemapDef {
  id: BasemapId;
  label: string;
  source: (theme: Theme) => RasterDef | VectorDef;
}

export const BASEMAPS: Record<BasemapId, BasemapDef> = {
  plain: {
    id: 'plain',
    label: 'Plain',
    source: (theme) => ({
      kind: 'vector',
      styleUrl:
        (theme === 'dark' ? env['PUBLIC_BASEMAP_PLAIN_DARK'] : env['PUBLIC_BASEMAP_PLAIN_LIGHT']) ||
        `https://tiles.openfreemap.org/styles/${theme === 'dark' ? 'dark' : 'positron'}`,
    }),
  },
  satellite: {
    id: 'satellite',
    label: 'Satellite',
    source: () => ({
      kind: 'raster',
      tiles: [
        env['PUBLIC_BASEMAP_SATELLITE'] ||
          'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2023_3857/default/g/{z}/{y}/{x}.jpg',
      ],
      tileSize: 256,
      maxzoom: 15,
      attribution:
        '<a href="https://s2maps.eu">Sentinel-2 cloudless</a> by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2023, CC BY-NC-SA 4.0)',
    }),
  },
};

export const BASEMAP_IDS = Object.keys(BASEMAPS) as BasemapId[];
