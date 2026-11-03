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
  firstRecordsBySearches,
  firstRecordsByTaxon,
  type RecordsSearch,
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
  inatCommonName,
  inatPhotoId,
  observationImages,
  votedObservations,
  type InatTaxon,
} from './inat';
import { forgetInatId, type InatMatch, knownInatId, knownInatName, rememberInatMatches } from './inat-ids';

export const MAX_PHOTOS = 20;

export interface PhotoTaxon {
  /** GBIF taxon key. */
  key: number;
  rank: Rank;
}

type Opts = { signal?: AbortSignal };

/** A match as remembered: its ID and English name. */
const asMatch = (taxon: InatTaxon): InatMatch => ({ id: taxon.id, name: inatCommonName(taxon) });

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
export async function inatRecords(keys: readonly number[], options: Opts): Promise<Map<number, InatRecord>> {
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

/** What matchTaxa has fetched: the GBIF record searches, and iNaturalist's candidates and their ancestors. */
interface MatchContext {
  known: ReadonlyMap<number, number>;
  searches: ReadonlyMap<number, InatRecord>;
  candidates: ReadonlyMap<number, InatTaxon>;
  ancestors: ReadonlyMap<number, InatTaxon>;
  options: Opts;
}

/** One taxon's match from what was fetched; a match found is added to `found`. */
function settleMatch(taxon: PhotoTaxon, context: MatchContext, found: Map<number, InatMatch>): InatTaxon | null {
  const knownId = context.known.get(taxon.key);
  if (knownId) {
    const remembered = context.candidates.get(knownId) ?? null;
    // A remembered ID iNaturalist no longer has: look it up afresh next time.
    if (remembered) found.set(taxon.key, asMatch(remembered));
    else forgetInatId(taxon.key);
    return remembered;
  }
  const level = RANK_LEVEL[taxon.rank];
  if (!level) return null;
  const record = context.searches.get(taxon.key);
  const candidate = record?.taxonId === undefined ? undefined : context.candidates.get(record.taxonId);
  const match = candidateAtLevel(candidate, level, context.ancestors, record?.rankName);
  if (match) found.set(taxon.key, asMatch(match));
  return match;
}

/**
 * Match GBIF taxa to iNaturalist taxa (null: no match). Also returns species names from the records.
 * An ID already known (remembered from before, or baked into the name index when it has loaded)
 * skips the GBIF search. Otherwise species are searched all in one request, and taxa above
 * species one by one. A species GBIF holds no iNaturalist record of has no match, so every name
 * and photo comes from the same taxon. Every match is remembered with its English name, so a later name lookup needs no request.
 */
async function matchTaxa(
  taxa: readonly PhotoTaxon[],
  options: Opts,
): Promise<{ matched: Map<number, InatTaxon | null>; names: Map<number, string> }> {
  const { known, unknown } = partitionKnown(taxa);
  const searches = await searchRecords(unknown, options);
  const candidateIds = [
    ...known.values(),
    ...[...searches.values()].flatMap((record) => (record.taxonId ? [record.taxonId] : [])),
  ];
  const candidates = await getTaxa(candidateIds, options.signal);
  const ancestors = await lookupAncestors(unknown, searches, candidates, options);
  const context: MatchContext = { known, searches, candidates, ancestors, options };

  const names = new Map<number, string>();
  const matched = new Map<number, InatTaxon | null>();
  const found = new Map<number, InatMatch>();
  for (const taxon of taxa) {
    const species = searches.get(taxon.key)?.species;
    if (species) names.set(taxon.key, species);
    matched.set(taxon.key, settleMatch(taxon, context, found));
  }
  rememberInatMatches(found);
  return { matched, names };
}

/** Each matched taxon's English name. */
function matchedCommonNames(matched: ReadonlyMap<number, InatTaxon | null>): Map<number, string> {
  return new Map(
    [...matched].flatMap(([key, taxon]): [number, string][] => {
      const name = inatCommonName(taxon);
      return name ? [[key, name]] : [];
    }),
  );
}

/**
 * iNaturalist's English name for each taxon: null when it has none or matches nothing. A name
 * remembered from before costs nothing; the rest are matched as for photos, and their iNaturalist
 * taxa come 30 to a request, shared with the photos of the same taxa.
 */
export async function inatNames(taxa: readonly PhotoTaxon[], options: Opts = {}): Promise<Map<number, string | null>> {
  const names = new Map<number, string | null>();
  const toMatch: PhotoTaxon[] = [];
  for (const taxon of taxa) {
    const remembered = knownInatName(taxon.key);
    if (remembered === undefined) toMatch.push({ key: taxon.key, rank: taxon.rank });
    else names.set(taxon.key, remembered);
  }
  if (!toMatch.length) return names;
  const { matched } = await matchTaxa(toMatch, options);
  const found = matchedCommonNames(matched);
  for (const taxon of toMatch) names.set(taxon.key, found.get(taxon.key) ?? null);
  return names;
}

/** iNaturalist's species for GBIF species, by GBIF key; the ones it has none for are left out. */
export async function resolveInatIds(taxa: readonly PhotoTaxon[], options: Opts = {}): Promise<Map<number, number>> {
  const { matched } = await matchTaxa(taxa, options);
  const ids = new Map<number, number>();
  for (const [key, taxon] of matched) {
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

/** A source's photos, or none when it fails: a failed source just hands over to the next. */
const orNoImages = (promise: Promise<UsableImage[]>) => promise.catch(() => [] as UsableImage[]);

/** Sources A and B, iNaturalist's own photos, each fetched only when asked for. */
function inatSources(match: InatTaxon | null, options: Opts): (() => Promise<UsableImage[]>)[] {
  return [
    async () => (match ? curatedImages(match) : []),
    () => orNoImages(match ? votedObservations(match.id, options.signal).then(observationImages) : Promise.resolve([])),
  ];
}

/** All sources in order, each fetched only when asked for. */
function sources(key: number, match: InatTaxon | null, options: Opts): (() => Promise<UsableImage[]>)[] {
  const gbifSources = GBIF_PHOTO_SOURCES.map(
    ({ filter, limit }) =>
      () =>
        orNoImages(
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
  for (const source of sources(taxon.key, matched.get(taxon.key) ?? null, options)) {
    if (photos.length >= MAX_PHOTOS) break;
    for (const image of await source()) {
      if (!takeIfNew(image, seenPhotos, seenRecords)) continue;
      photos.push(image);
      if (photos.length >= MAX_PHOTOS) break;
    }
  }
  return photos;
}

/** Options for leadPhotos. */
type LeadPhotoOpts = Opts & {
  /** Hears iNaturalist's names as soon as the taxa are matched, before the photos. */
  onCommonNames?: (commonNames: ReadonlyMap<number, string>) => void;
  /** Also read each taxon's record count, when GBIF is searched for its photo anyway. */
  withCounts?: boolean;
};

/** Lead photos, with the species names from GBIF's records and iNaturalist's English names. */
export interface LeadPhotos {
  images: Map<number, UsableImage>;
  names: Map<number, string>;
  commonNames: Map<number, string>;
  /** Record counts, for the taxa GBIF was searched for (see `withCounts`). */
  counts: Map<number, number>;
}

/**
 * Lead photos (each taxon's first photo) for many taxa: iNaturalist taxa
 * are fetched TAXA_BATCH per request, and GBIF's photos (source C) only for
 * taxa without one from iNaturalist, every source in one request.
 * The same iNaturalist taxa carry the English names, so those cost nothing more.
 */
export async function leadPhotos(taxa: readonly PhotoTaxon[], options: LeadPhotoOpts = {}): Promise<LeadPhotos> {
  const { matched, names } = await matchTaxa(taxa, options);
  const commonNames = matchedCommonNames(matched);
  options.onCommonNames?.(commonNames);
  const images = new Map<number, UsableImage>();

  const limit = pLimit(4);
  await Promise.all(
    taxa.map((taxon) =>
      limit(async () => {
        for (const source of inatSources(matched.get(taxon.key) ?? null, options)) {
          if (options.signal?.aborted) return;
          const first = (await source())[0];
          if (first) return void images.set(taxon.key, first);
        }
      }),
    ),
  );

  const missing = taxa.filter((taxon) => !images.has(taxon.key));
  const gbif = options.signal?.aborted ? undefined : await gbifLeadPhotos(missing, options);
  for (const [key, image] of gbif?.images ?? []) images.set(key, image);
  return { images, names, commonNames, counts: gbif?.counts ?? new Map() };
}

/** GBIF's photos and record counts of some taxa. */
interface GbifLeadPhotos {
  images: Map<number, UsableImage>;
  counts: Map<number, number>;
}

/**
 * Each taxon's first GBIF photo, from the first source that has one. A lone taxon asks every source
 * in one request. Several go one source at a time: most find a photo in the first source, and asking
 * the second for all of them too took GBIF two to three times as long.
 */
async function gbifLeadPhotos(taxa: readonly PhotoTaxon[], options: LeadPhotoOpts): Promise<GbifLeadPhotos> {
  const [only] = taxa;
  if (only && taxa.length === 1 && canBatchRank(only.rank)) {
    const found = await photosFromAllSources(only, options).catch(() => null);
    if (found) return found;
  }
  return { images: await photosOneSourceAtATime(taxa, options), counts: new Map() };
}

/** A taxon's first photo from one request asking every source (the first with a photo wins), and its count if asked. */
async function photosFromAllSources(taxon: PhotoTaxon, options: LeadPhotoOpts): Promise<GbifLeadPhotos> {
  const { key, rank } = taxon;
  const photoSearches: RecordsSearch[] = GBIF_PHOTO_SOURCES.map(({ filter, limit }) => ({
    filter: { ...filter, hasImage: true, license: ALLOWED_LICENCE_ENUMS },
    // As many records as its page reads, so both pick the same first photo.
    perTaxon: limit,
  }));
  // Every record of the taxon, none of them read: only the total.
  const countSearches: RecordsSearch[] = options.withCounts ? [{ filter: {}, perTaxon: 0 }] : [];
  const found = await gbifLimit(() =>
    firstRecordsBySearches([key], rank, [...photoSearches, ...countSearches], options),
  );
  const first = found
    .slice(0, photoSearches.length)
    .map((records) => records.get(key)?.records.flatMap(usableImages)[0])
    .find(Boolean);
  const countFound = found[photoSearches.length];
  return {
    images: new Map(first ? [[key, first]] : []),
    // A taxon with no records has no facet value to count.
    counts: new Map(countFound ? [[key, countFound.get(key)?.count ?? 0]] : []),
  };
}

/** First photos of taxa, asking one source at a time and only for the taxa still without a photo. */
async function photosOneSourceAtATime(taxa: readonly PhotoTaxon[], options: Opts): Promise<Map<number, UsableImage>> {
  const images = new Map<number, UsableImage>();
  for (const { filter, limit } of GBIF_PHOTO_SOURCES) {
    const missing = taxa.filter((taxon) => !images.has(taxon.key));
    if (!missing.length || options.signal?.aborted) break;
    for (const [key, image] of await gbifSourcePhotos(missing, filter, limit, options)) images.set(key, image);
  }
  return images;
}

/** Each taxon's first GBIF photo under `filter`: one request per rank with several taxa, else the taxon page's own request. */
async function gbifSourcePhotos(
  taxa: readonly PhotoTaxon[],
  filter: OccurrenceFilter,
  pageSize: number,
  options: Opts,
): Promise<Map<number, UsableImage>> {
  const byRank = Map.groupBy(taxa, (taxon) => taxon.rank);
  const photosByRank = await Promise.all(
    [...byRank].map(([rank, taxaOfRank]) =>
      taxaOfRank.length > 1 && canBatchRank(rank)
        ? batchedLeadPhotos(taxaOfRank, rank, filter, pageSize, options)
        : singleLeadPhotos(taxaOfRank, filter, pageSize, options),
    ),
  );
  return new Map(photosByRank.flatMap((photos) => [...photos]));
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
      const [first] = await orNoImages(search.then((result) => result.images));
      return [taxon.key, first] as const;
    }),
  );
  return new Map(firsts.filter((entry): entry is readonly [number, UsableImage] => !!entry[1]));
}

/** One taxon's lead photo. */
export async function leadPhoto(taxon: PhotoTaxon, options: Opts = {}): Promise<UsableImage | undefined> {
  return (await leadPhotos([taxon], options)).images.get(taxon.key);
}
