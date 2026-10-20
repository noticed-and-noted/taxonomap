import { HOUR } from '~/lib/util/time';
import { GBIF_API_BASE } from './config';
import { http } from './http';
import { md5 } from './md5';
import { ALLOWED_LICENCE_ENUMS, usableImages, type GbifImage, type UsableImage } from './licence';
import { filterToParams, type OccurrenceFilter } from './occurrence';
import type { OccurrenceSearch } from './types';

/**
 * Photos for a filter (usually a taxon). Filters licences server-side, then
 * applies the per-media licence rule (see licence.ts) client-side.
 */
export async function findImages(
  filter: OccurrenceFilter,
  options: { limit?: number; offset?: number; signal?: AbortSignal } = {},
): Promise<{ images: GbifImage[]; count: number; endOfRecords: boolean; names: Map<number, string> }> {
  const response = await http().getJson<OccurrenceSearch>(
    '/v1/occurrence/search',
    {
      ...filterToParams({ ...filter, hasImage: true }),
      license: ALLOWED_LICENCE_ENUMS,
      limit: options.limit ?? 24,
      offset: options.offset,
    },
    { ttlMs: 6 * HOUR, ...(options.signal && { signal: options.signal }) },
  );
  // Species names come free with the records (useful when batching species).
  const names = new Map<number, string>();
  for (const occurrence of response.results)
    if (occurrence.speciesKey !== undefined && occurrence.species) names.set(occurrence.speciesKey, occurrence.species);
  return {
    images: response.results.flatMap(usableImages),
    count: response.count,
    endOfRecords: response.endOfRecords,
    names,
  };
}

/** Photo hosts that send CORS headers. GBIF's image cache does not, so its photos must load without `crossorigin`. */
const CORS_PHOTO_HOST = /^https:\/\/inaturalist-open-data\.s3\.amazonaws\.com\//;

/**
 * `crossorigin` for a photo URL: 'anonymous' where the host allows it, so the
 * service worker stores a readable copy rather than an opaque one, which
 * browsers count as several MB of storage each.
 */
export function photoCrossOrigin(url: string | undefined): 'anonymous' | undefined {
  return url && CORS_PHOTO_HOST.test(url) && !corsFailed.has(url) ? 'anonymous' : undefined;
}

/**
 * Photo URLs whose CORS load failed: a copy fetched without CORS earlier (by
 * an older build, or the browser cache, as S3 doesn't vary on Origin) answers
 * for them and the browser rejects it. They load without `crossorigin` instead.
 */
const corsFailed = new Set<string>();

/** After a photo fails to load: true if it was a CORS load, now to be retried without. */
export function retryWithoutCors(url: string): boolean {
  if (!photoCrossOrigin(url)) return false;
  corsFailed.add(url);
  return true;
}

export type ThumbSize = '200x' | '400x' | '800x' | `${number}x${number}`;

/** iNaturalist's fixed photo sizes, by longest edge. */
const INAT_SIZES = [
  ['small', 240],
  ['medium', 500],
  ['large', 1024],
] as const;

/**
 * Thumbnail URL for a photo. GBIF photos go through GBIF's image cache
 * (verified: ~19 KB vs ~145 KB original), addressed by occurrence key and
 * the MD5 of the media identifier. iNaturalist photos use iNaturalist's own
 * sizes: the smallest at least as wide as the requested width.
 */
export function thumbnailUrl(image: UsableImage, size: ThumbSize = '400x'): string {
  if (image.source === 'inat') {
    const want = parseInt(size, 10);
    const name = INAT_SIZES.find(([, px]) => px >= want)?.[0] ?? 'large';
    const url = image.url.replace(/\/(square|thumb|small|medium|large|original)\.(\w+)(\?.*)?$/, `/${name}.$2`);
    // S3 doesn't vary on Origin, so a cached plain copy would answer a CORS load and be blocked: keep them apart.
    // Not `?cors`: S3 reads that as its CORS-config subresource and returns no image.
    return CORS_PHOTO_HOST.test(url) ? `${url}?x-cors` : url;
  }
  return `${GBIF_API_BASE}/v1/image/cache/${size}/occurrence/${image.occurrenceKey}/media/${md5(image.url)}`;
}
