/**
 * Names and lead photos for confirmed species. The list endpoint gives most of them cheaply; only a
 * taxon whose default photo is missing or closed costs a path request for its curated photos.
 */
import {
  curatedImages,
  getTaxa,
  getTaxonSummaries,
  inatCommonName,
  TAXA_BATCH,
  TAXON_SUMMARIES_BATCH,
  toImage,
  type InatPhoto,
  type InatTaxon,
  type InatTaxonSummary,
} from '~/lib/photos/inat-server';
import { bakeablePhotoUrl, type BakedPhoto } from '~/lib/name-search/preview';
import { chunks } from '../inat';
import { readCheckpoint, writeCheckpoint } from './checkpoint';

/** iNaturalist's rank level for a species. */
const SPECIES_LEVEL = 10;
/** How far up a subspecies' ancestors its species can sit (a complex or section can come between). */
const NEAREST_ANCESTORS = 4;
const RULE_CHECK_SAMPLE = 300;
const SAVE_EVERY_REQUESTS = 50;

/** Taxa from the list endpoint by ID. Sorted, so the same IDs make the same requests and the disk cache answers. */
export async function listTaxa(ids: Iterable<number>): Promise<Map<number, InatTaxonSummary>> {
  const sorted = [...new Set(ids)].sort((left, right) => left - right);
  const taxa = new Map<number, InatTaxonSummary>();
  for (const group of chunks(sorted, TAXON_SUMMARIES_BATCH)) {
    for (const taxon of await getTaxonSummaries(group)) taxa.set(taxon.id, taxon);
  }
  return taxa;
}

/** A record's taxon at species level, as the about page takes it: an ancestor for a subspecies, none above species. */
function speciesLevelId(taxon: InatTaxonSummary, ancestors: ReadonlyMap<number, InatTaxonSummary>): number | null {
  if (taxon.rank_level === SPECIES_LEVEL) return taxon.id;
  if (taxon.rank_level > SPECIES_LEVEL) return null;
  const lineage = (taxon.ancestor_ids ?? []).filter((id) => id !== taxon.id);
  const nearest = lineage.slice(-NEAREST_ANCESTORS).reverse();
  return nearest.find((id) => ancestors.get(id)?.rank_level === SPECIES_LEVEL) ?? null;
}

/**
 * Moves each record's ID to its taxon at species level, fetching ancestors of records below it.
 * A taxon the list hides (inactive) stays as it is: the path request that fetches it later sorts it out.
 */
export async function toSpeciesLevel(
  ids: ReadonlyMap<number, number>,
  listed: ReadonlyMap<number, InatTaxonSummary>,
): Promise<Map<number, number>> {
  const below = [...listed.values()].filter((taxon) => taxon.rank_level < SPECIES_LEVEL);
  const ancestors = await listTaxa(below.flatMap((taxon) => (taxon.ancestor_ids ?? []).slice(-NEAREST_ANCESTORS - 1)));
  const moved = new Map<number, number>();
  for (const [key, id] of ids) {
    const taxon = listed.get(id);
    const speciesId = taxon ? speciesLevelId(taxon, ancestors) : id;
    if (speciesId) moved.set(key, speciesId);
  }
  return moved;
}

/** A photo as a preview row holds it, or undefined when it's closed or its URL can't be rebuilt exactly. */
function toBakedPhoto(photo: InatPhoto): BakedPhoto | undefined {
  const image = toImage(photo);
  const parts = image && bakeablePhotoUrl(image.url, photo.id);
  return image && parts ? { ...parts, licence: photo.license_code!, creator: image.creator ?? '' } : undefined;
}

/** A taxon's name and lead photo. */
export interface TaxonFacts {
  commonName: string | null;
  photo?: BakedPhoto;
  /** An open photo exists but its URL can't be rebuilt, so the preview goes live for it. */
  hasUnbakeablePhoto?: boolean;
}

/** The first open curated photo of a taxon from a path request, as stored for a later run. */
interface CuratedResult {
  defaultPhotoId: number | null;
  commonName: string | null;
  photo?: BakedPhoto;
  isUnbakeable?: boolean;
}

/** What a path request says about a taxon. */
function curatedResult(taxon: InatTaxon, defaultPhotoId: number | null): CuratedResult {
  const first = curatedImages(taxon)[0];
  const photo = taxon.taxon_photos?.find((taxonPhoto) => taxonPhoto.photo.id === first?.photoId);
  const baked = photo && toBakedPhoto(photo.photo);
  return {
    defaultPhotoId,
    commonName: inatCommonName(taxon),
    ...(baked && { photo: baked }),
    ...(first && !baked && { isUnbakeable: true }),
  };
}

/** Whether a stored result still holds: the list shows the taxon's default photo hasn't changed. */
const isStillCurrent = (stored: CuratedResult | undefined, defaultPhotoId: number | null) =>
  stored !== undefined && stored.defaultPhotoId === defaultPhotoId;

/** Curated photos for the taxa that need them, reusing results from an earlier run. */
async function curatedPhotos(
  ids: readonly number[],
  listed: ReadonlyMap<number, InatTaxonSummary>,
): Promise<Map<number, CuratedResult>> {
  const stored = new Map(await readCheckpoint<[number, CuratedResult][]>('curated', []));
  const defaultId = (id: number) => listed.get(id)?.default_photo?.id ?? null;
  const toFetch = ids.filter((id) => !isStillCurrent(stored.get(id), defaultId(id)));
  let requests = 0;
  for (const group of chunks(
    toFetch.sort((left, right) => left - right),
    TAXA_BATCH,
  )) {
    for (const [id, taxon] of await getTaxa(group)) stored.set(id, curatedResult(taxon, defaultId(id)));
    if (++requests % SAVE_EVERY_REQUESTS === 0) await writeCheckpoint('curated', [...stored]);
  }
  await writeCheckpoint('curated', [...stored]);
  return stored;
}

/** Whether a listed taxon's default photo is open, which makes it the first open curated photo too. */
const hasOpenDefault = (taxon: InatTaxonSummary | undefined) =>
  !!taxon?.default_photo && !!toImage(taxon.default_photo);

/**
 * Each taxon's name and lead photo: the open default photo where the list has one, else the first
 * open curated photo. Taxa the list hides (inactive) get theirs from the path request too.
 */
export async function taxonFacts(
  ids: readonly number[],
  listed: ReadonlyMap<number, InatTaxonSummary>,
): Promise<{ facts: Map<number, TaxonFacts>; curatedRequests: number }> {
  const needCurated = ids.filter((id) => !hasOpenDefault(listed.get(id)));
  const curated = await curatedPhotos(needCurated, listed);
  const facts = new Map<number, TaxonFacts>();
  for (const id of ids) {
    const taxon = listed.get(id);
    if (hasOpenDefault(taxon)) facts.set(id, defaultPhotoFacts(taxon!));
    else if (curated.has(id)) facts.set(id, curatedFacts(curated.get(id)!));
  }
  return { facts, curatedRequests: Math.ceil(needCurated.length / TAXA_BATCH) };
}

/** Facts from a listed taxon with an open default photo. */
function defaultPhotoFacts(taxon: InatTaxonSummary): TaxonFacts {
  const photo = toBakedPhoto(taxon.default_photo!);
  return { commonName: inatCommonName(taxon), ...(photo ? { photo } : { hasUnbakeablePhoto: true }) };
}

/** Facts from a path request. */
function curatedFacts({ commonName, photo, isUnbakeable }: CuratedResult): TaxonFacts {
  return { commonName, ...(photo && { photo }), ...(isUnbakeable && { hasUnbakeablePhoto: true }) };
}

/**
 * Re-checks the rule the bake rests on, measured on a sample: a taxon's open default photo is its
 * first open curated photo, so it's what the about page leads with.
 * @returns The IDs that break the rule, which should be none.
 */
export async function defaultPhotoRuleBreaks(listed: ReadonlyMap<number, InatTaxonSummary>): Promise<number[]> {
  const open = [...listed.values()].filter(hasOpenDefault);
  const sample = open
    .map((taxon) => ({ taxon, order: Math.random() }))
    .sort((left, right) => left.order - right.order)
    .slice(0, RULE_CHECK_SAMPLE)
    .map(({ taxon }) => taxon);
  const breaks: number[] = [];
  for (const group of chunks(sample, TAXA_BATCH)) {
    const curated = await getTaxa(group.map((taxon) => taxon.id));
    for (const taxon of group) {
      const curatedTaxon = curated.get(taxon.id);
      const first = curatedTaxon && curatedImages(curatedTaxon)[0];
      if (first?.photoId !== taxon.default_photo?.id) breaks.push(taxon.id);
    }
  }
  return breaks;
}
