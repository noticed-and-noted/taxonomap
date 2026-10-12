/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_GBIF_API_BASE?: string;
  readonly PUBLIC_GBIF_TILE_BASE?: string;
  readonly PUBLIC_SITE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
