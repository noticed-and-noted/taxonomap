/**
 * iNaturalist API (v2, keyless, CORS-enabled): taxa with their curated
 * photos, and research-grade observations sorted by votes. The client reuses
 * the GBIF client's retry, cache and in-flight dedupe, behind a throttle:
 * iNaturalist asks for about one request a second, so short bursts are
 * allowed and then requests are spaced out.
 */
import { createHttp, type Transport } from '~/lib/gbif/http';
import { parseLicence, type InatImage } from '~/lib/gbif/licence';
import { LruCache } from '~/lib/gbif/lru';
import { HOUR } from '~/lib/util/time';

export const INAT_API_BASE = 'https://api.inaturalist.org';

/** Most taxa per /taxa request. */
export const TAXA_BATCH = 30;

const BURST = 5;
const PER_SECOND = 1;

/** Token bucket in front of fetch: BURST at once, then PER_SECOND. */
export function throttle(transport: Transport, burst = BURST, perSecond = PER_SECOND, now = Date.now): Transport {
  let tokens = burst;
  let last = now();
  let queue: Promise<void> = Promise.resolve();
  const refill = () => {
    const timestamp = now();
    tokens = Math.min(burst, tokens + ((timestamp - last) / 1000) * perSecond);
    last = timestamp;
  };
  // A request cancelled while queued (its panel closed) gives up its turn without spending a token.
  const acquire = (signal?: AbortSignal) => {
    const turn = queue.then(async () => {
      if (signal?.aborted) return;
      refill();
      if (tokens < 1) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, ((1 - tokens) / perSecond) * 1000);
          signal?.addEventListener('abort', () => (clearTimeout(timer), resolve()), { once: true });
        });
        if (signal?.aborted) return;
        refill();
      }
      tokens -= 1;
    });
    queue = turn;
    return turn;
  };
  return async (url, requestInit) => {
    await acquire(requestInit?.signal);
    requestInit?.signal?.throwIfAborted();
    return transport(url, requestInit);
  };
}

const inat = createHttp({
  base: INAT_API_BASE,
  transport: throttle((url, requestInit) => globalThis.fetch(url, requestInit)),
  defaultTtlMs: 6 * HOUR,
});

/** Every Creative Commons photo licence (see parseLicence for the rule). */
const PHOTO_LICENCES = 'cc0,cc-by,cc-by-nc,cc-by-sa,cc-by-nd,cc-by-nc-sa,cc-by-nc-nd';
const PHOTO_FIELDS = 'id,url,license_code,attribution,attribution_name';

export interface InatPhoto {
  id: number;
  url: string;
  license_code: string | null;
  attribution?: string;
  attribution_name?: string | null;
}

export interface InatTaxon {
  id: number;
  name: string;
  rank_level: number;
  ancestor_ids?: number[];
  taxon_photos?: { photo: InatPhoto }[];
}

interface InatObservation {
  id: number;
  uri?: string;
  photos?: InatPhoto[];
}

const TAXON_FIELDS = `id,name,rank_level,ancestor_ids,taxon_photos.photo.${PHOTO_FIELDS.replaceAll(',', ',taxon_photos.photo.')}`;

/** Taxa already fetched, by ID, so overlapping batches don't fetch them twice; capped so long sessions don't grow without end. */
const taxa = new LruCache<InatTaxon>(2000);

/**
 * Taxa by ID, with their curated photos; batched TAXA_BATCH per request.
 * Batches come from the requested IDs alone, not from what this visitor has
 * already loaded, so the same list always makes the same requests (and cache keys).
 */
export async function getTaxa(ids: readonly number[], signal?: AbortSignal): Promise<Map<number, InatTaxon>> {
  const wanted = [...new Set(ids)].sort((left, right) => left - right);
  for (let offset = 0; offset < wanted.length; offset += TAXA_BATCH) {
    const chunk = wanted.slice(offset, offset + TAXA_BATCH);
    if (chunk.every((id) => taxa.get(String(id)) !== undefined)) continue;
    const response = await inat.getJson<{ results: InatTaxon[] }>(
      `/v2/taxa/${chunk.join(',')}`,
      { fields: TAXON_FIELDS },
      { ...(signal && { signal }) },
    );
    for (const taxon of response.results) taxa.set(String(taxon.id), taxon, Infinity);
  }
  return new Map(
    ids.flatMap((id): [number, InatTaxon][] => {
      const cachedTaxon = taxa.get(String(id));
      return cachedTaxon ? [[id, cachedTaxon]] : [];
    }),
  );
}

/**
 * The species iNaturalist names `name`, found by name: one request each, so
 * only for species GBIF holds no iNaturalist record of. Null when there is none.
 */
export async function searchTaxon(name: string, signal?: AbortSignal): Promise<InatTaxon | null> {
  const response = await inat.getJson<{ results: InatTaxon[] }>(
    '/v2/taxa',
    { q: name, rank: 'species', is_active: true, per_page: 5, fields: TAXON_FIELDS },
    { ...(signal && { signal }) },
  );
  const found = response.results.find((taxon) => taxon.name.toLowerCase() === name.toLowerCase());
  if (found) taxa.set(String(found.id), found, Infinity);
  return found ?? null;
}

/** Research-grade observations of a taxon with an openly licensed photo, most-voted first. */
export async function votedObservations(taxonId: number, signal?: AbortSignal): Promise<InatObservation[]> {
  const response = await inat.getJson<{ results: InatObservation[] }>(
    '/v2/observations',
    {
      taxon_id: taxonId,
      quality_grade: 'research',
      photos: true,
      photo_license: PHOTO_LICENCES,
      order_by: 'votes',
      order: 'desc',
      per_page: 20,
      fields: `id,uri,photos.${PHOTO_FIELDS.replaceAll(',', ',photos.')}`,
    },
    { ...(signal && { signal }) },
  );
  return response.results;
}

/** "(c) Ann Smith, some rights reserved (CC BY)" → "Ann Smith". */
function creatorOf(photo: InatPhoto): string | undefined {
  if (photo.attribution_name) return photo.attribution_name;
  return photo.attribution?.match(/^\(c\)\s*(.+?),\s*(?:some|all) rights reserved/i)?.[1];
}

/** An openly licensed photo as an image, or null ("all rights reserved" and the like). */
export function toImage(photo: InatPhoto, observationUrl?: string): InatImage | null {
  const licence = parseLicence(photo.license_code);
  if (!licence || !photo.url) return null;
  const creator = creatorOf(photo);
  return {
    source: 'inat',
    photoId: photo.id,
    url: photo.url,
    licence,
    publisher: 'iNaturalist',
    ...(creator && { creator }),
    ...(observationUrl && { observationUrl }),
  };
}

/** A taxon's curated photos (the ones iNaturalist shows on its taxon page), best first. */
export function curatedImages(taxon: InatTaxon): InatImage[] {
  return (taxon.taxon_photos ?? []).flatMap((taxonPhoto) => toImage(taxonPhoto.photo) ?? []);
}

/** The first openly licensed photo of each observation. */
export function observationImages(observations: readonly InatObservation[]): InatImage[] {
  return observations.flatMap((observation) => {
    for (const photo of observation.photos ?? []) {
      const image = toImage(photo, observation.uri);
      if (image) return [image];
    }
    return [];
  });
}

/** iNaturalist photo ID in a photo URL (also on GBIF's copies of iNaturalist photos). */
export function inatPhotoId(url: string): number | undefined {
  const match = url.match(/(?:inaturalist-open-data\.s3\.amazonaws\.com|static\.inaturalist\.org)\/photos\/(\d+)\//);
  return match ? Number(match[1]) : undefined;
}
