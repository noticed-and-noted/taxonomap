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
  opts: { limit?: number; offset?: number; signal?: AbortSignal } = {},
): Promise<{ images: GbifImage[]; count: number; endOfRecords: boolean; names: Map<number, string> }> {
  const res = await http().getJson<OccurrenceSearch>(
    '/v1/occurrence/search',
    {
      ...filterToParams({ ...filter, hasImage: true }),
      license: ALLOWED_LICENCE_ENUMS,
      limit: opts.limit ?? 24,
      offset: opts.offset,
    },
    { ttlMs: 6 * HOUR, ...(opts.signal && { signal: opts.signal }) },
  );
  // Species names come free with the records (useful when batching species).
  const names = new Map<number, string>();
  for (const r of res.results) if (r.speciesKey !== undefined && r.species) names.set(r.speciesKey, r.species);
  return { images: res.results.flatMap(usableImages), count: res.count, endOfRecords: res.endOfRecords, names };
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
export function thumbnailUrl(img: UsableImage, size: ThumbSize = '400x'): string {
  if (img.source === 'inat') {
    const want = parseInt(size, 10);
    const name = INAT_SIZES.find(([, px]) => px >= want)?.[0] ?? 'large';
    return img.url.replace(/\/(square|thumb|small|medium|large|original)\.(\w+)(\?.*)?$/, `/${name}.$2`);
  }
  return `${GBIF_API_BASE}/v1/image/cache/${size}/occurrence/${img.occurrenceKey}/media/${md5(img.url)}`;
}
