/**
 * iNaturalist API (v2, keyless, CORS-enabled): taxa with their curated
 * photos, and research-grade observations sorted by votes. The client reuses
 * the GBIF client's retry, cache and in-flight dedupe, behind a throttle:
 * iNaturalist asks for about one request a second, so short bursts are
 * allowed and then requests are spaced out.
 */
import { createHttp, type Transport } from '~/lib/gbif/http';
import { HOUR } from '~/lib/util/time';
import { parseLicence, type InatImage } from '~/lib/gbif/licence';

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
    const t = now();
    tokens = Math.min(burst, tokens + ((t - last) / 1000) * perSecond);
    last = t;
  };
  const acquire = () => {
    const turn = queue.then(async () => {
      refill();
      if (tokens < 1) {
        await new Promise((r) => setTimeout(r, ((1 - tokens) / perSecond) * 1000));
        refill();
      }
      tokens -= 1;
    });
    queue = turn;
    return turn;
  };
  return async (url, init) => {
    await acquire();
    return transport(url, init);
  };
}

const inat = createHttp({
  base: INAT_API_BASE,
  transport: throttle((url, init) => globalThis.fetch(url, init)),
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

/** Taxa already fetched, by ID, so overlapping batches don't fetch them twice. */
const taxa = new Map<number, InatTaxon>();

/**
 * Taxa by ID, with their curated photos; batched TAXA_BATCH per request.
 * Batches come from the requested IDs alone, not from what this visitor has
 * already loaded, so the same list always makes the same requests (and cache keys).
 */
export async function getTaxa(ids: readonly number[], signal?: AbortSignal): Promise<Map<number, InatTaxon>> {
  const wanted = [...new Set(ids)].sort((a, b) => a - b);
  for (let i = 0; i < wanted.length; i += TAXA_BATCH) {
    const chunk = wanted.slice(i, i + TAXA_BATCH);
    if (chunk.every((id) => taxa.has(id))) continue;
    const res = await inat.getJson<{ results: InatTaxon[] }>(
      `/v2/taxa/${chunk.join(',')}`,
      { fields: TAXON_FIELDS },
      { ...(signal && { signal }) },
    );
    for (const t of res.results) taxa.set(t.id, t);
  }
  return new Map(ids.flatMap((id) => (taxa.has(id) ? [[id, taxa.get(id) as InatTaxon]] : [])));
}

/** Research-grade observations of a taxon with an openly licensed photo, most-voted first. */
export async function votedObservations(taxonId: number, signal?: AbortSignal): Promise<InatObservation[]> {
  const res = await inat.getJson<{ results: InatObservation[] }>(
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
  return res.results;
}

/** "(c) Ann Smith, some rights reserved (CC BY)" → "Ann Smith". */
function creatorOf(p: InatPhoto): string | undefined {
  if (p.attribution_name) return p.attribution_name;
  return p.attribution?.match(/^\(c\)\s*(.+?),\s*(?:some|all) rights reserved/i)?.[1];
}

/** An openly licensed photo as an image, or null ("all rights reserved" and the like). */
export function toImage(p: InatPhoto, observationUrl?: string): InatImage | null {
  const licence = parseLicence(p.license_code);
  if (!licence || !p.url) return null;
  const creator = creatorOf(p);
  return {
    source: 'inat',
    photoId: p.id,
    url: p.url,
    licence,
    publisher: 'iNaturalist',
    ...(creator && { creator }),
    ...(observationUrl && { observationUrl }),
  };
}

/** A taxon's curated photos (the ones iNaturalist shows on its taxon page), best first. */
export function curatedImages(t: InatTaxon): InatImage[] {
  return (t.taxon_photos ?? []).flatMap((tp) => toImage(tp.photo) ?? []);
}

/** The first openly licensed photo of each observation. */
export function observationImages(obs: readonly InatObservation[]): InatImage[] {
  return obs.flatMap((o) => {
    for (const p of o.photos ?? []) {
      const img = toImage(p, o.uri);
      if (img) return [img];
    }
    return [];
  });
}

/** iNaturalist photo ID in a photo URL (also on GBIF's copies of iNaturalist photos). */
export function inatPhotoId(url: string): number | undefined {
  const m = url.match(/(?:inaturalist-open-data\.s3\.amazonaws\.com|static\.inaturalist\.org)\/photos\/(\d+)\//);
  return m ? Number(m[1]) : undefined;
}
