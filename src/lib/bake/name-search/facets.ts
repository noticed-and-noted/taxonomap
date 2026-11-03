import { join } from 'node:path';
import { GBIF_API_BASE } from '~/lib/gbif/config';
import { GbifNotFoundError } from '~/lib/gbif/errors';
import { createHttp } from '~/lib/gbif/http';
import { userAgent, withDiskCache } from '~/lib/gbif/node-transport';
import type { OccurrenceSearch } from '~/lib/gbif/types';
import { DAY, MINUTE } from '~/lib/util/time';

const FACET_PAGE_SIZE = 100_000;
/** GBIF's stated limit on facet entries; in practice it has stopped sooner (see speciesFacet). */
const FACET_CEILING = 1_200_000;
const ATTEMPTS = 4;
const RETRY_PAUSE_MS = MINUTE / 4;

/** Species' record counts from a facet, and whether the list ran into GBIF's ceiling rather than ending. */
export interface SpeciesFacet {
  counts: Map<number, number>;
  hitCeiling: boolean;
}

/** A page of facet values. */
type FacetRows = { name: string; count: number }[];

/** Fetches the facet page at an offset. */
type FacetPager = (offset: number) => Promise<FacetRows>;

/**
 * Its own client, as the build's shared one caches 404s, and a 404 here can pass: it would answer
 * every retry, and every run for a week.
 */
const facetHttp = () =>
  createHttp({
    base: GBIF_API_BASE,
    defaultTtlMs: DAY,
    transport: withDiskCache(
      (url, requestInit) => fetch(url, { ...requestInit, headers: { 'User-Agent': userAgent() } }),
      { cacheDir: join(process.cwd(), '.cache', 'gbif') },
    ),
  });

/** One facet page, retried: GBIF has answered a 404 that succeeded on the next try. */
async function retriedPage(http: ReturnType<typeof createHttp>, datasetKey: string | undefined, facetOffset: number) {
  const params = {
    datasetKey,
    facet: 'speciesKey',
    facetLimit: FACET_PAGE_SIZE,
    facetOffset: facetOffset || undefined,
    limit: 0,
  };
  for (let attempt = 1; ; attempt++) {
    try {
      const page = await http.getJson<OccurrenceSearch>('/v1/occurrence/search', params);
      return page.facets?.[0]?.counts ?? [];
    } catch (error) {
      if (attempt >= ATTEMPTS) throw error;
      console.warn(`Facet page at ${facetOffset} failed (attempt ${attempt}), retrying`);
      await new Promise((resolve) => setTimeout(resolve, RETRY_PAUSE_MS));
    }
  }
}

/**
 * Pages through a facet until the list ends or hits the ceiling. Past the ceiling a missing count
 * means unknown, not zero. Deep pages have answered a lasting 404 from offset 500,000 (while
 * 400,000 was fine), which counts as the ceiling too.
 * @throws Error when a page keeps failing any other way, so a partial list can't pass for a whole one.
 */
export async function pageFacet(fetchPage: FacetPager): Promise<SpeciesFacet> {
  const counts = new Map<number, number>();
  for (let offset = 0; offset < FACET_CEILING; offset += FACET_PAGE_SIZE) {
    const page = await fetchPage(offset).catch((error: unknown) => {
      if (offset > 0 && error instanceof GbifNotFoundError) return null;
      throw error;
    });
    if (!page) return { counts, hitCeiling: true };
    for (const { name, count } of page) counts.set(Number(name), count);
    if (page.length < FACET_PAGE_SIZE) return { counts, hitCeiling: false };
  }
  return { counts, hitCeiling: true };
}

/** Every species' record count, in one dataset or across them all. */
export function speciesFacet(datasetKey?: string): Promise<SpeciesFacet> {
  const http = facetHttp();
  return pageFacet((offset) => retriedPage(http, datasetKey, offset));
}
