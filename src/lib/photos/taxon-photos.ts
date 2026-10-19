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
import { nameIndexIfLoaded } from '~/lib/data/name-index';
import {
  curatedImages,
  getTaxa,
  inatPhotoId,
  observationImages,
  searchTaxon,
  votedObservations,
  type InatTaxon,
} from './inat';
import { forgetInatId, knownInatId, rememberInatIds } from './inat-ids';

export const MAX_PHOTOS = 20;

export interface PhotoTaxon {
  /** GBIF taxon key. */
  key: number;
  rank: Rank;
  /** Scientific name, for finding a species by name when GBIF holds no iNaturalist record of it. */
  name?: string;
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

type InatRecord = Awaited<ReturnType<typeof inatRecord>>;

/** Species per GBIF search for iNaturalist records: one with many records crowds the rest out of a bigger page. */
const RECORD_BATCH = 5;

/** The iNaturalist records GBIF holds of several species in one search; species it returns none for are left out. */
async function inatRecords(keys: readonly number[], opts: Opts): Promise<Map<number, InatRecord>> {
  const res = await gbifLimit(() =>
    http().getJson<OccurrenceSearch>(
      '/v1/occurrence/search',
      { speciesKey: keys, datasetKey: INATURALIST_DATASET_KEY, limit: 300 },
      { ttlMs: 6 * HOUR, ...(opts.signal && { signal: opts.signal }) },
    ),
  );
  const found = new Map<number, InatRecord>();
  for (const r of res.results) {
    const id = Number(r.taxonID);
    if (r.speciesKey === undefined || !Number.isInteger(id) || id <= 0 || found.has(r.speciesKey)) continue;
    found.set(r.speciesKey, { taxonId: id, ...(r.species && { species: r.species }) });
  }
  return found;
}

/** A taxon's iNaturalist match: settled, or still being searched for by name. */
type Match = InatTaxon | null | Promise<InatTaxon | null>;

/** Search iNaturalist for a species by name, remembering a hit; null on none or on failure. */
async function byName(key: number, name: string, opts: Opts): Promise<InatTaxon | null> {
  const found = await searchTaxon(name, opts.signal).catch(() => null);
  if (found) rememberInatIds(new Map([[key, found.id]]));
  return found;
}

/**
 * Match GBIF taxa to iNaturalist taxa (null: no match). Also returns species names from the records.
 * An ID already known (remembered from before, or baked into the name index when it has loaded)
 * skips the GBIF search. Otherwise species are searched a few to a request, then one by one for
 * those that missed. A species GBIF holds no record of is searched for by name (iNaturalist,
 * one request each) when it has one; that match arrives later, so others needn't wait for it.
 */
async function matchTaxa(
  taxa: readonly PhotoTaxon[],
  opts: Opts,
): Promise<{ matched: Map<number, Match>; names: Map<number, string> }> {
  const names = new Map<number, string>();
  const index = nameIndexIfLoaded();
  const known = new Map<number, number>();
  const searches = new Map<number, InatRecord>();
  const unknown: PhotoTaxon[] = [];
  for (const t of taxa) {
    if (!RANK_LEVEL[t.rank]) continue;
    const id = knownInatId(t.key) ?? (t.rank === 'SPECIES' ? index?.get(t.key)?.inatId : undefined);
    if (id) known.set(t.key, id);
    else unknown.push(t);
  }

  const species = unknown.filter((t) => t.rank === 'SPECIES');
  const batches: PhotoTaxon[][] = [];
  // A single species is no cheaper in a batch.
  if (species.length > 1)
    for (let i = 0; i < species.length; i += RECORD_BATCH) batches.push(species.slice(i, i + RECORD_BATCH));
  await Promise.all(
    batches.map(async (b) => {
      const found = await inatRecords(
        b.map((t) => t.key),
        opts,
      ).catch(() => new Map<number, InatRecord>());
      for (const [k, r] of found) searches.set(k, r);
    }),
  );
  await Promise.all(
    unknown
      .filter((t) => !searches.has(t.key))
      .map(async (t) => void searches.set(t.key, await inatRecord(t.key, opts).catch((): InatRecord => ({})))),
  );

  const candidateIds = [...known.values(), ...[...searches.values()].flatMap((r) => (r.taxonId ? [r.taxonId] : []))];
  const candidates = await getTaxa(candidateIds, opts.signal);

  // Records below the taxon's rank: look up their ancestors to find the one at its rank.
  const needAncestors = unknown.flatMap((t) => {
    const c = candidates.get(searches.get(t.key)?.taxonId ?? 0);
    return c && c.rank_level < RANK_LEVEL[t.rank]! ? (c.ancestor_ids ?? []).filter((a) => a !== c.id) : [];
  });
  const ancestors = needAncestors.length ? await getTaxa(needAncestors, opts.signal) : new Map<number, InatTaxon>();

  const matched = new Map<number, Match>();
  const found = new Map<number, number>();
  for (const t of taxa) {
    const level = RANK_LEVEL[t.rank];
    const rec = searches.get(t.key);
    if (rec?.species) names.set(t.key, rec.species);
    let match: InatTaxon | null = null;
    const knownId = known.get(t.key);
    if (knownId) {
      match = candidates.get(knownId) ?? null;
      // A remembered ID iNaturalist no longer has: look it up afresh next time.
      if (!match) forgetInatId(t.key);
    } else if (level) {
      const c = rec?.taxonId === undefined ? undefined : candidates.get(rec.taxonId);
      if (c && c.rank_level === level) match = c;
      else if (c && c.rank_level < level) {
        match = (c.ancestor_ids ?? []).map((a) => ancestors.get(a)).find((a) => a?.rank_level === level) ?? null;
      }
      if (match) found.set(t.key, match.id);
      else if (!c && t.name && t.rank === 'SPECIES') {
        matched.set(t.key, byName(t.key, t.name, opts));
        continue;
      }
    }
    matched.set(t.key, match);
  }
  rememberInatIds(found);
  return { matched, names };
}

/** iNaturalist's species for GBIF species, by GBIF key; the ones it has none for are left out. */
export async function resolveInatIds(taxa: readonly PhotoTaxon[], opts: Opts = {}): Promise<Map<number, number>> {
  const { matched } = await matchTaxa(taxa, opts);
  const ids = new Map<number, number>();
  for (const [key, m] of matched) {
    const t = await m;
    if (t) ids.set(key, t.id);
  }
  return ids;
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
  for (const source of sources(t.key, (await matched.get(t.key)) ?? null, opts)) {
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
        for (const source of sources(t.key, (await matched.get(t.key)) ?? null, opts)) {
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
