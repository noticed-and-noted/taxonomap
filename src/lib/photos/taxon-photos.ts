/**
 * Photos for a taxon (any rank), all fetched in the browser. One ordered
 * list, best first, up to MAX_PHOTOS, from these sources in turn:
 *   A. iNaturalist's curated photos for the taxon (what its taxon page shows)
 *   B. iNaturalist's most-voted research-grade observations of it
 *   C. GBIF photos: the iNaturalist dataset first, then every dataset (for
 *      many taxa' lead photos at once, one GraphQL request per source)
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
import { nameIndexIfLoaded } from '~/lib/data/name-index';
import {
  ALLOWED_LICENCE_ENUMS,
  canBatchRank,
  findImages,
  firstRecordsByTaxon,
  http,
  type HigherKeys,
  INATURALIST_DATASET_KEY,
  type OccurrenceFilter,
  type OccurrenceSearch,
  type Rank,
  type UsableImage,
  usableImages,
} from '~/lib/gbif';
import { HOUR } from '~/lib/util/time';
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

/** The field naming a GBIF record's taxon at each rank above species, to check an iNaturalist ancestor is the same group. */
const RANK_FIELD: Partial<Record<Rank, keyof HigherKeys>> = {
  KINGDOM: 'kingdom',
  PHYLUM: 'phylum',
  CLASS: 'class',
  ORDER: 'order',
  FAMILY: 'family',
  GENUS: 'genus',
};

// GBIF lookups, a few at a time: bursts of parallel searches trip its rate limit.
const gbifLimit = pLimit(3);

/** One GBIF record of the taxon from the iNaturalist dataset: its iNaturalist taxon ID, species name and GBIF's name for the taxon. */
async function inatRecord(
  { key, rank }: PhotoTaxon,
  options: Opts,
): Promise<{ taxonId?: number; species?: string; rankName?: string }> {
  const response = await gbifLimit(() =>
    http().getJson<OccurrenceSearch>(
      '/v1/occurrence/search',
      { taxonKey: key, datasetKey: INATURALIST_DATASET_KEY, limit: 1 },
      { ttlMs: 6 * HOUR, ...(options.signal && { signal: options.signal }) },
    ),
  );
  const result = response.results[0];
  const id = Number(result?.taxonID);
  const field = RANK_FIELD[rank];
  const rankName = field && result?.[field];
  return {
    ...(Number.isInteger(id) && id > 0 && { taxonId: id }),
    ...(result?.species && { species: result.species }),
    ...(typeof rankName === 'string' && { rankName }),
  };
}

type InatRecord = Awaited<ReturnType<typeof inatRecord>>;

/**
 * One iNaturalist record GBIF holds of each of several species, in one request; species
 * GBIF has none of are left out.
 */
async function inatRecords(keys: readonly number[], options: Opts): Promise<Map<number, InatRecord>> {
  const bySpecies = await gbifLimit(() =>
    firstRecordsByTaxon(keys, 'SPECIES', { datasetKey: INATURALIST_DATASET_KEY }, { perTaxon: 1, ...options }),
  );
  const found = new Map<number, InatRecord>();
  for (const [key, { name, records }] of bySpecies) {
    const id = Number(records[0]?.taxonID);
    if (Number.isInteger(id) && id > 0) found.set(key, { taxonId: id, ...(name && { species: name }) });
  }
  return found;
}

/** A taxon's iNaturalist match: settled, or still being searched for by name. */
type Match = InatTaxon | null | Promise<InatTaxon | null>;

/** Search iNaturalist for a species by name, remembering a hit; null on none or on failure. */
async function byName(key: number, name: string, options: Opts): Promise<InatTaxon | null> {
  const found = await searchTaxon(name, options.signal).catch(() => null);
  if (found) rememberInatIds(new Map([[key, found.id]]));
  return found;
}

/** Splits taxa into those with a known iNaturalist ID (remembered or baked) and those that need a search. */
function partitionKnown(taxa: readonly PhotoTaxon[]): { known: Map<number, number>; unknown: PhotoTaxon[] } {
  const index = nameIndexIfLoaded();
  const known = new Map<number, number>();
  const unknown: PhotoTaxon[] = [];
  for (const taxon of taxa) {
    if (!RANK_LEVEL[taxon.rank]) continue;
    const id = knownInatId(taxon.key) ?? (taxon.rank === 'SPECIES' ? index?.get(taxon.key)?.inatId : undefined);
    if (id) known.set(taxon.key, id);
    else unknown.push(taxon);
  }
  return { known, unknown };
}

/**
 * Finds each unknown taxon's iNaturalist record on GBIF: every species in one request, then
 * singly for taxa above species, and for the species too if that request failed.
 */
async function searchRecords(unknown: readonly PhotoTaxon[], options: Opts): Promise<Map<number, InatRecord>> {
  const species = unknown.filter((taxon) => taxon.rank === 'SPECIES');
  // A single species is no cheaper in a batch.
  const batch =
    species.length > 1
      ? await inatRecords(
          species.map((taxon) => taxon.key),
          options,
        ).catch(() => null)
      : null;
  const searches = new Map<number, InatRecord>(batch ?? []);
  // A species the batch answered for but left out has no iNaturalist record to find.
  const isAnswered = (taxon: PhotoTaxon) => batch !== null && taxon.rank === 'SPECIES';
  await Promise.all(
    unknown
      .filter((taxon) => !isAnswered(taxon))
      .map(
        async (taxon) => void searches.set(taxon.key, await inatRecord(taxon, options).catch((): InatRecord => ({}))),
      ),
  );
  return searches;
}

/** Ancestors of records that sit below their taxon's rank, to find the ancestor at that rank. */
async function lookupAncestors(
  unknown: readonly PhotoTaxon[],
  searches: ReadonlyMap<number, InatRecord>,
  candidates: ReadonlyMap<number, InatTaxon>,
  options: Opts,
): Promise<Map<number, InatTaxon>> {
  const ancestorIds = unknown.flatMap((taxon) => {
    const candidate = candidates.get(searches.get(taxon.key)?.taxonId ?? 0);
    return candidate && candidate.rank_level < RANK_LEVEL[taxon.rank]!
      ? (candidate.ancestor_ids ?? []).filter((ancestorId) => ancestorId !== candidate.id)
      : [];
  });
  return ancestorIds.length ? getTaxa(ancestorIds, options.signal) : new Map<number, InatTaxon>();
}

/**
 * The candidate itself when it is at `level`, else its ancestor named `name` when GBIF gives one
 * (the two place some groups at different ranks: iNaturalist's order Artiodactyla holds the
 * infraorder Cetacea, GBIF's order), else its ancestor at `level`; null when there is none.
 */
function candidateAtLevel(
  candidate: InatTaxon | undefined,
  level: number,
  ancestors: ReadonlyMap<number, InatTaxon>,
  name?: string,
): InatTaxon | null {
  if (!candidate) return null;
  if (candidate.rank_level === level) return candidate;
  if (candidate.rank_level > level) return null;
  const lineage = (candidate.ancestor_ids ?? []).map((ancestorId) => ancestors.get(ancestorId));
  const isMatch = (ancestor: InatTaxon | undefined) =>
    name ? ancestor?.name === name : ancestor?.rank_level === level;
  return lineage.find(isMatch) ?? null;
}

/**
 * Match GBIF taxa to iNaturalist taxa (null: no match). Also returns species names from the records.
 * An ID already known (remembered from before, or baked into the name index when it has loaded)
 * skips the GBIF search. Otherwise species are searched all in one request, and taxa above
 * species one by one. A species GBIF holds no record of is searched for by name (iNaturalist,
 * one request each) when it has one; that match arrives later, so others needn't wait for it.
 */
async function matchTaxa(
  taxa: readonly PhotoTaxon[],
  options: Opts,
): Promise<{ matched: Map<number, Match>; names: Map<number, string> }> {
  const { known, unknown } = partitionKnown(taxa);
  const searches = await searchRecords(unknown, options);
  const candidateIds = [
    ...known.values(),
    ...[...searches.values()].flatMap((record) => (record.taxonId ? [record.taxonId] : [])),
  ];
  const candidates = await getTaxa(candidateIds, options.signal);
  const ancestors = await lookupAncestors(unknown, searches, candidates, options);

  const names = new Map<number, string>();
  const matched = new Map<number, Match>();
  const found = new Map<number, number>();
  for (const taxon of taxa) {
    const level = RANK_LEVEL[taxon.rank];
    const record = searches.get(taxon.key);
    if (record?.species) names.set(taxon.key, record.species);

    const knownId = known.get(taxon.key);
    if (knownId) {
      const remembered = candidates.get(knownId) ?? null;
      // A remembered ID iNaturalist no longer has: look it up afresh next time.
      if (!remembered) forgetInatId(taxon.key);
      matched.set(taxon.key, remembered);
      continue;
    }
    if (!level) {
      matched.set(taxon.key, null);
      continue;
    }

    const candidate = record?.taxonId === undefined ? undefined : candidates.get(record.taxonId);
    const match = candidateAtLevel(candidate, level, ancestors, record?.rankName);
    if (match) found.set(taxon.key, match.id);
    const isNameSearchable = !match && !candidate && taxon.name && taxon.rank === 'SPECIES';
    matched.set(taxon.key, isNameSearchable ? byName(taxon.key, taxon.name!, options) : match);
  }
  rememberInatIds(found);
  return { matched, names };
}

/** iNaturalist's species for GBIF species, by GBIF key; the ones it has none for are left out. */
export async function resolveInatIds(taxa: readonly PhotoTaxon[], options: Opts = {}): Promise<Map<number, number>> {
  const { matched } = await matchTaxa(taxa, options);
  const ids = new Map<number, number>();
  for (const [key, pending] of matched) {
    const taxon = await pending;
    if (taxon) ids.set(key, taxon.id);
  }
  return ids;
}

/** Source C, GBIF photos: its copy of iNaturalist's records first, then every dataset. */
const GBIF_PHOTO_SOURCES = [
  { filter: { datasetKey: INATURALIST_DATASET_KEY }, limit: 30 },
  { filter: {}, limit: 40 },
] as const satisfies readonly { filter: OccurrenceFilter; limit: number }[];

/**
 * Records per taxon a batched lead-photo search reads, where a taxon's page reads a source's
 * whole page. shortcut: a taxon whose first 3 licensed photo records hold no usable photo gets
 * a later source's lead photo instead of its page's first; read more if that shows up.
 */
const LEAD_RECORDS_PER_TAXON = 3;

const swallow = (promise: Promise<UsableImage[]>) => promise.catch(() => [] as UsableImage[]);

/** Sources A and B, iNaturalist's own photos, each fetched only when asked for. */
function inatSources(match: InatTaxon | null, options: Opts): (() => Promise<UsableImage[]>)[] {
  return [
    async () => (match ? curatedImages(match) : []),
    () => swallow(match ? votedObservations(match.id, options.signal).then(observationImages) : Promise.resolve([])),
  ];
}

/** All sources in order, each fetched only when asked for. */
function sources(key: number, match: InatTaxon | null, options: Opts): (() => Promise<UsableImage[]>)[] {
  const gbifSources = GBIF_PHOTO_SOURCES.map(
    ({ filter, limit }) =>
      () =>
        swallow(
          gbifLimit(() => findImages({ ...filter, taxonKey: key }, { limit, ...options })).then(
            (result) => result.images,
          ),
        ),
  );
  return [...inatSources(match, options), ...gbifSources];
}

/** Identity for de-duplication: iNaturalist photo ID wherever the photo is served from. */
function photoKey(image: UsableImage): string {
  if (image.source === 'inat') return `inat:${image.photoId}`;
  const id = inatPhotoId(image.url);
  return id ? `inat:${id}` : `gbif:${image.occurrenceKey}:${image.url}`;
}

/**
 * Whether `image` is new: not a photo already taken (wherever it is served from) and,
 * for GBIF records, not another photo of a record already used, for variety. Marks it taken if so.
 */
function takeIfNew(image: UsableImage, seenPhotos: Set<string>, seenRecords: Set<number>): boolean {
  const key = photoKey(image);
  if (seenPhotos.has(key)) return false;
  if (image.source !== 'inat') {
    if (seenRecords.has(image.occurrenceKey)) return false;
    seenRecords.add(image.occurrenceKey);
  }
  seenPhotos.add(key);
  return true;
}

/** The ordered photo list for a taxon page (up to MAX_PHOTOS). */
export async function taxonPhotos(taxon: PhotoTaxon, options: Opts = {}): Promise<UsableImage[]> {
  const { matched } = await matchTaxa([taxon], options);
  const seenPhotos = new Set<string>();
  const seenRecords = new Set<number>();
  const photos: UsableImage[] = [];
  for (const source of sources(taxon.key, (await matched.get(taxon.key)) ?? null, options)) {
    if (photos.length >= MAX_PHOTOS) break;
    for (const image of await source()) {
      if (!takeIfNew(image, seenPhotos, seenRecords)) continue;
      photos.push(image);
      if (photos.length >= MAX_PHOTOS) break;
    }
  }
  return photos;
}

/**
 * Lead photos (each taxon's first photo) for many taxa: iNaturalist taxa
 * are fetched TAXA_BATCH per request, and GBIF's photos (source C) only for
 * taxa without one from iNaturalist, one request per rank and source.
 */
export async function leadPhotos(
  taxa: readonly PhotoTaxon[],
  options: Opts = {},
): Promise<{ images: Map<number, UsableImage>; names: Map<number, string> }> {
  const { matched, names } = await matchTaxa(taxa, options);
  const images = new Map<number, UsableImage>();
  const limit = pLimit(4);
  await Promise.all(
    taxa.map((taxon) =>
      limit(async () => {
        for (const source of inatSources((await matched.get(taxon.key)) ?? null, options)) {
          if (options.signal?.aborted) return;
          const first = (await source())[0];
          if (first) return void images.set(taxon.key, first);
        }
      }),
    ),
  );
  for (const { filter, limit: pageSize } of GBIF_PHOTO_SOURCES) {
    const missing = taxa.filter((taxon) => !images.has(taxon.key));
    if (!missing.length || options.signal?.aborted) break;
    const found = await gbifLeadPhotos(missing, filter, pageSize, options);
    for (const [key, image] of found) images.set(key, image);
  }
  return { images, names };
}

/** Each taxon's first GBIF photo under `filter`: one request per rank with several taxa, else the taxon page's own request. */
async function gbifLeadPhotos(
  taxa: readonly PhotoTaxon[],
  filter: OccurrenceFilter,
  pageSize: number,
  options: Opts,
): Promise<Map<number, UsableImage>> {
  const byRank = new Map<Rank, PhotoTaxon[]>();
  for (const taxon of taxa) byRank.set(taxon.rank, [...(byRank.get(taxon.rank) ?? []), taxon]);
  const found = await Promise.all(
    [...byRank].map(([rank, group]) =>
      group.length > 1 && canBatchRank(rank)
        ? batchedLeadPhotos(group, rank, filter, pageSize, options)
        : singleLeadPhotos(group, filter, pageSize, options),
    ),
  );
  return new Map(found.flatMap((photos) => [...photos]));
}

/** First photos of several taxa of one rank, from one request, or one request each when that fails. */
async function batchedLeadPhotos(
  taxa: readonly PhotoTaxon[],
  rank: Rank,
  filter: OccurrenceFilter,
  pageSize: number,
  options: Opts,
): Promise<Map<number, UsableImage>> {
  const keys = taxa.map((taxon) => taxon.key);
  const photoFilter = { ...filter, hasImage: true, license: ALLOWED_LICENCE_ENUMS };
  const byTaxon = await gbifLimit(() =>
    firstRecordsByTaxon(keys, rank, photoFilter, { perTaxon: LEAD_RECORDS_PER_TAXON, ...options }),
  ).catch(() => null);
  // GraphQL failing doesn't stop the REST searches the taxa's own pages make.
  if (!byTaxon) return options.signal?.aborted ? new Map() : singleLeadPhotos(taxa, filter, pageSize, options);
  const photos = new Map<number, UsableImage>();
  for (const [key, { records }] of byTaxon) {
    const first = records.flatMap(usableImages)[0];
    if (first) photos.set(key, first);
  }
  return photos;
}

/** First photos of taxa one request each, the same request as their pages make. */
async function singleLeadPhotos(
  taxa: readonly PhotoTaxon[],
  filter: OccurrenceFilter,
  pageSize: number,
  options: Opts,
): Promise<Map<number, UsableImage>> {
  const firsts = await Promise.all(
    taxa.map(async (taxon) => {
      const search = gbifLimit(() => findImages({ ...filter, taxonKey: taxon.key }, { limit: pageSize, ...options }));
      const [first] = await swallow(search.then((result) => result.images));
      return [taxon.key, first] as const;
    }),
  );
  return new Map(firsts.filter((entry): entry is readonly [number, UsableImage] => !!entry[1]));
}

/** One taxon's lead photo. */
export async function leadPhoto(taxon: PhotoTaxon, options: Opts = {}): Promise<UsableImage | undefined> {
  return (await leadPhotos([taxon], options)).images.get(taxon.key);
}
