/**
 * iNaturalist API (v2, keyless, CORS-enabled): taxa with their curated
 * photos and English common names, and research-grade observations sorted by votes. The client reuses
 * the GBIF client's retry, cache and in-flight dedupe, behind a throttle:
 * iNaturalist asks for about one request a second, so short bursts are
 * allowed and then requests are spaced out.
 */
import { env } from '~/lib/env';
import { createHttp, type Transport } from '~/lib/gbif/http';
import type { Params } from '~/lib/gbif/params';
import { parseLicence, type InatImage } from '~/lib/gbif/licence';
import { LruCache } from '~/lib/gbif/lru';
import { tidy } from '~/lib/species/names';
import { HOUR } from '~/lib/util/time';

/** iNaturalist's API base (`PUBLIC_INAT_API_BASE`), so a build can be pointed at a stand-in. */
export const INAT_API_BASE = (env['PUBLIC_INAT_API_BASE'] || 'https://api.inaturalist.org').replace(/\/+$/, '');

/** Most taxa per /taxa/{ids} request. */
export const TAXA_BATCH = 30;

/** Most taxa per getTaxonNames request (iNaturalist's `per_page` allows 200). */
export const TAXON_NAMES_BATCH = 100;

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

const throttledFetch = throttle((url, requestInit) => globalThis.fetch(url, requestInit));

/** The client for iNaturalist: `transport` under the shared cache and retries. */
const createInat = (transport: Transport) => createHttp({ base: INAT_API_BASE, transport, defaultTtlMs: 6 * HOUR });

let inat = createInat(throttledFetch);

/** Lets the build put a disk cache in front of the throttled fetch (see inat-server). */
export function configureInat(wrap: (throttled: Transport) => Transport): void {
  inat = createInat(wrap(throttledFetch));
}

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
  /** iNaturalist's English common name (asked for with NAME_PARAMS). */
  preferred_common_name?: string | null;
  ancestor_ids?: number[];
  taxon_photos?: { photo: InatPhoto }[];
}

interface InatObservation {
  id: number;
  uri?: string;
  photos?: InatPhoto[];
}

/**
 * Common names in English as iNaturalist names them for the United Kingdom (place 6857), whatever
 * language the browser asks for, so every visitor sees the same name (and the same cache key).
 * The place does the work: `locale` alone gives every English variant the US name.
 */
const NAME_PARAMS = { locale: 'en', preferred_place_id: 6857 } as const;

const TAXON_FIELDS = `id,name,rank_level,preferred_common_name,ancestor_ids,taxon_photos.photo.${PHOTO_FIELDS.replaceAll(',', ',taxon_photos.photo.')}`;

const TAXON_NAME_FIELDS = 'id,name,rank_level,preferred_common_name,ancestor_ids';

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
      { fields: TAXON_FIELDS, ...NAME_PARAMS },
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

/** Taxa by ID from `path`, with only their names and ancestors. */
async function fetchTaxonNames(path: string, params: Params): Promise<InatTaxon[]> {
  const response = await inat.getJson<{ results: InatTaxon[] }>(path, {
    ...params,
    fields: TAXON_NAME_FIELDS,
    ...NAME_PARAMS,
  });
  return response.results;
}

/**
 * Taxa by ID with only their names and ancestors, up to TAXON_NAMES_BATCH in one request. Unlike
 * getTaxa it asks for no photos and keeps no cache of its own, so a build can name thousands of
 * taxa cheaply. The list endpoint hides inactive taxa (ones iNaturalist has since replaced), which
 * a species' remembered ID can still point at, so those are fetched by path, TAXA_BATCH at a time.
 * @param ids At most TAXON_NAMES_BATCH IDs; the caller splits longer lists.
 */
export async function getTaxonNames(ids: readonly number[]): Promise<Map<number, InatTaxon>> {
  const wanted = [...new Set(ids)].sort((left, right) => left - right);
  const listed = await fetchTaxonNames('/v2/taxa', { id: wanted.join(','), per_page: wanted.length });
  const found = new Map(listed.map((taxon) => [taxon.id, taxon]));

  const hidden = wanted.filter((id) => !found.has(id));
  for (let offset = 0; offset < hidden.length; offset += TAXA_BATCH) {
    const chunk = hidden.slice(offset, offset + TAXA_BATCH);
    for (const taxon of await fetchTaxonNames(`/v2/taxa/${chunk.join(',')}`, {})) found.set(taxon.id, taxon);
  }
  return found;
}

/** iNaturalist's English name for a taxon, tidied like every other name; null when it has none. */
export function inatCommonName(taxon: InatTaxon | null | undefined): string | null {
  const name = taxon?.preferred_common_name?.trim();
  return name ? tidy(name) : null;
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
