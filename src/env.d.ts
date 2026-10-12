/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_GBIF_API_BASE?: string;
  readonly PUBLIC_GBIF_TILE_BASE?: string;
  readonly PUBLIC_SITE_URL?: string;
  readonly PUBLIC_GEOCODER?: 'nominatim' | 'photon';
  readonly PUBLIC_GEOCODER_URL?: string;
  readonly PUBLIC_BASEMAP_PLAIN_DARK?: string;
  readonly PUBLIC_BASEMAP_PLAIN_LIGHT?: string;
  readonly PUBLIC_BASEMAP_TERRAIN?: string;
  readonly PUBLIC_BASEMAP_SATELLITE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
