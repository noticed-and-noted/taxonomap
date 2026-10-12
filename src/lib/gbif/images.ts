import { http } from './http';
import { ALLOWED_LICENCE_ENUMS, usableImages, type UsableImage } from './licence';
import { filterToParams, type OccurrenceFilter } from './occurrence';
import type { OccurrenceSearch } from './types';

/**
 * Photos for a filter (usually a taxon). Filters licences server-side, then
 * applies the strict per-media licence rule client-side.
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
