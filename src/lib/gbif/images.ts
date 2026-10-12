import { apiBase } from './edge';
import { http } from './http';
import { md5 } from './md5';
import { ALLOWED_LICENCE_ENUMS, usableImages, type UsableImage } from './licence';
import { filterToParams, type OccurrenceFilter } from './occurrence';
import type { OccurrenceSearch } from './types';

/**
 * Photos for a filter (usually a taxon). Filters licences server-side, then
 * applies the per-media licence rule (see licence.ts) client-side.
 */
export async function findImages(
  filter: OccurrenceFilter,
  opts: { limit?: number; offset?: number; signal?: AbortSignal } = {},
): Promise<{ images: UsableImage[]; count: number; endOfRecords: boolean }> {
  const res = await http().getJson<OccurrenceSearch>(
    '/v1/occurrence/search',
    {
      ...filterToParams({ ...filter, hasImage: true }),
      license: ALLOWED_LICENCE_ENUMS,
      limit: opts.limit ?? 24,
      offset: opts.offset,
    },
    { ttlMs: 6 * 3_600_000, ...(opts.signal && { signal: opts.signal }) },
  );
  return { images: res.results.flatMap(usableImages), count: res.count, endOfRecords: res.endOfRecords };
}

export type ThumbSize = '200x' | '400x' | '800x' | `${number}x${number}`;

/**
 * Thumbnail via GBIF's image cache (verified: ~19 KB vs ~145 KB original).
 * Addressed by occurrence key and the MD5 of the media identifier.
 */
export function thumbnailUrl(
  img: Pick<UsableImage, 'url' | 'occurrenceKey'>,
  size: ThumbSize = '400x',
  base: string = apiBase(),
): string {
  return `${base}/v1/image/cache/${size}/occurrence/${img.occurrenceKey}/media/${md5(img.url)}`;
}
