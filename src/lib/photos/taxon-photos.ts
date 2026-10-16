/**
 * Photos for a taxon (any rank), all fetched in the browser. One ordered
 * list, best first, up to MAX_PHOTOS, from these sources in turn:
 *   A. iNaturalist's curated photos for the taxon (what its taxon page shows)
 *   B. iNaturalist's most-voted research-grade observations of it
 *   C. GBIF photos: the iNaturalist dataset first, then every dataset
 * Duplicates (the same photo from two sources) and photos without an open
 * licence are skipped.
 *
 * The lead photo — what every card, preview and panel shows — is the
 * list's first photo: leadPhotos takes the first photo of the first source
 * that has one, making exactly the same requests, so a preview always
 * matches the first photo on the taxon's page.
 *
 * GBIF taxa are matched to iNaturalist through GBIF's copy of iNaturalist's
 * records, which carries the iNaturalist taxon ID. When a record is of a
 * lower rank (a subspecies, or a species for a genus), its ancestor at the
 * taxon's rank is used. Taxa with no match fall back to source C.
 */
import pLimit from 'p-limit';
import { HOUR } from '~/lib/util/time';
import {
  findImages,
  http,
  INATURALIST_DATASET_KEY,
  type OccurrenceSearch,
  type Rank,
  type UsableImage,
} from '~/lib/gbif';
import { curatedImages, getTaxa, inatPhotoId, observationImages, votedObservations, type InatTaxon } from './inat';

export const MAX_PHOTOS = 20;

export interface PhotoTaxon {
  /** GBIF taxon key. */
  key: number;
  rank: Rank;
}

type Opts = { signal?: AbortSignal };

/** iNaturalist rank levels for the GBIF ranks we can match. */
const RANK_LEVEL: Partial<Record<Rank, number>> = {
  KINGDOM: 70,
  PHYLUM: 60,
  CLASS: 50,
  ORDER: 40,
  FAMILY: 30,
  GENUS: 20,
  SPECIES: 10,
  SUBSPECIES: 5,
  VARIETY: 5,
  FORM: 5,
};

// GBIF lookups, a few at a time: bursts of parallel searches trip its rate limit.
const gbifLimit = pLimit(3);

/** One GBIF record of the taxon from the iNaturalist dataset: its iNaturalist taxon ID and species name. */
async function inatRecord(key: number, opts: Opts): Promise<{ taxonId?: number; species?: string }> {
  const res = await gbifLimit(() =>
    http().getJson<OccurrenceSearch>(
      '/v1/occurrence/search',
      { taxonKey: key, datasetKey: INATURALIST_DATASET_KEY, limit: 1 },
      { ttlMs: 6 * HOUR, ...(opts.signal && { signal: opts.signal }) },
    ),
  );
  const r = res.results[0];
  const id = Number(r?.taxonID);
  return { ...(Number.isInteger(id) && id > 0 && { taxonId: id }), ...(r?.species && { species: r.species }) };
}

/** Match GBIF taxa to iNaturalist taxa (null: no match). Also returns species names from the records. */
async function matchTaxa(
  taxa: readonly PhotoTaxon[],
  opts: Opts,
): Promise<{ matched: Map<number, InatTaxon | null>; names: Map<number, string> }> {
  type InatRecord = Awaited<ReturnType<typeof inatRecord>>;
  const names = new Map<number, string>();
  const records = await Promise.all(
    taxa.map((t): Promise<InatRecord> =>
      RANK_LEVEL[t.rank] ? inatRecord(t.key, opts).catch(() => ({})) : Promise.resolve({}),
    ),
  );
  const candidateIds = records.flatMap((r) => (r.taxonId ? [r.taxonId] : []));
  const candidates = await getTaxa(candidateIds, opts.signal);

  // Records below the taxon's rank: look up their ancestors to find the one at its rank.
  const needAncestors = taxa.flatMap((t, i) => {
    const c = candidates.get(records[i]?.taxonId ?? -1);
    return c && c.rank_level < (RANK_LEVEL[t.rank] ?? 0) ? (c.ancestor_ids ?? []).filter((a) => a !== c.id) : [];
  });
  const ancestors = needAncestors.length ? await getTaxa(needAncestors, opts.signal) : new Map<number, InatTaxon>();

  const matched = new Map<number, InatTaxon | null>();
  taxa.forEach((t, i) => {
    const r = records[i] ?? {};
    if (r.species) names.set(t.key, r.species);
    const level = RANK_LEVEL[t.rank];
    const c = candidates.get(r.taxonId ?? -1);
    let match: InatTaxon | null = null;
    if (c && level && c.rank_level === level) match = c;
    else if (c && level && c.rank_level < level) {
      match = (c.ancestor_ids ?? []).map((a) => ancestors.get(a)).find((a) => a?.rank_level === level) ?? null;
    }
    matched.set(t.key, match);
  });
  return { matched, names };
}

// Source C: GBIF photos. The same requests whether for a list or a lead photo.
const gbifInat = (key: number, opts: Opts) =>
  gbifLimit(() => findImages({ taxonKey: key, datasetKey: INATURALIST_DATASET_KEY }, { limit: 30, ...opts }));
const gbifAny = (key: number, opts: Opts) => gbifLimit(() => findImages({ taxonKey: key }, { limit: 40, ...opts }));

/** Sources in order, each fetched only when asked for. */
function sources(key: number, match: InatTaxon | null, opts: Opts): (() => Promise<UsableImage[]>)[] {
  const swallow = (p: Promise<UsableImage[]>) => p.catch(() => [] as UsableImage[]);
  return [
    async () => (match ? curatedImages(match) : []),
    () => swallow(match ? votedObservations(match.id, opts.signal).then(observationImages) : Promise.resolve([])),
    () => swallow(gbifInat(key, opts).then((r) => r.images)),
    () => swallow(gbifAny(key, opts).then((r) => r.images)),
  ];
}

/** Identity for de-duplication: iNaturalist photo ID wherever the photo is served from. */
function photoKey(img: UsableImage): string {
  if (img.source === 'inat') return `inat:${img.photoId}`;
  const id = inatPhotoId(img.url);
  return id ? `inat:${id}` : `gbif:${img.occurrenceKey}:${img.url}`;
}

/** The ordered photo list for a taxon page (up to MAX_PHOTOS). */
export async function taxonPhotos(t: PhotoTaxon, opts: Opts = {}): Promise<UsableImage[]> {
  const { matched } = await matchTaxa([t], opts);
  const seen = new Set<string>();
  /** GBIF records: one photo each, for variety. */
  const seenRecords = new Set<number>();
  const out: UsableImage[] = [];
  for (const source of sources(t.key, matched.get(t.key) ?? null, opts)) {
    if (out.length >= MAX_PHOTOS) break;
    for (const img of await source()) {
      const k = photoKey(img);
      if (seen.has(k)) continue;
      if (img.source !== 'inat') {
        if (seenRecords.has(img.occurrenceKey)) continue;
        seenRecords.add(img.occurrenceKey);
      }
      seen.add(k);
      out.push(img);
      if (out.length >= MAX_PHOTOS) break;
    }
  }
  return out;
}

/**
 * Lead photos (each taxon's first photo) for many taxa: iNaturalist taxa
 * are fetched TAXA_BATCH per request, and the later sources are only asked
 * for taxa without a photo from an earlier one.
 */
export async function leadPhotos(
  taxa: readonly PhotoTaxon[],
  opts: Opts = {},
): Promise<{ images: Map<number, UsableImage>; names: Map<number, string> }> {
  const { matched, names } = await matchTaxa(taxa, opts);
  const images = new Map<number, UsableImage>();
  const limit = pLimit(4);
  await Promise.all(
    taxa.map((t) =>
      limit(async () => {
        for (const source of sources(t.key, matched.get(t.key) ?? null, opts)) {
          if (opts.signal?.aborted) return;
          const first = (await source())[0];
          if (first) return void images.set(t.key, first);
        }
      }),
    ),
  );
  return { images, names };
}

/** One taxon's lead photo. */
export async function leadPhoto(t: PhotoTaxon, opts: Opts = {}): Promise<UsableImage | undefined> {
  return (await leadPhotos([t], opts)).images.get(t.key);
}
