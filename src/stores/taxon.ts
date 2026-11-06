/**
 * Display info (names + rank) for the selected taxa, derived from
 * $taxonKeys. Uses the baked name index first, then GBIF for the taxon and
 * iNaturalist (or GBIF) for its common name.
 */
import { atom, onMount } from 'nanostores';
import { nameIndexIfLoaded, nameIndexWithin } from '~/lib/data/name-index';
import { getSpecies, getVernacularNames, type NameHit, type Rank } from '~/lib/gbif';
import { inatNames } from '~/lib/photos/taxon-photos';
import { englishName } from '~/lib/species/names';
import { $taxonKeys, clearHexSelection, MAX_TAXA } from './explorer';

export interface TaxonInfo {
  key: number;
  scientificName: string;
  commonName?: string;
  rank: Rank;
  /** A placeholder whose names are still being looked up. */
  loading?: true;
}

/**
 * A taxon's English name: iNaturalist's (no request when remembered from a visit before, and
 * shared with the taxon's photo lookup otherwise), else the pick from GBIF's names (cached).
 */
async function taxonCommonName(key: number, rank: Rank): Promise<string | null> {
  const fromInat = await inatNames([{ key, rank }]).catch(() => null);
  const inatName = fromInat?.get(key);
  if (inatName) return inatName;
  // A taxon without its common name still beats no taxon.
  const vernaculars = await getVernacularNames(key).catch(() => null);
  return englishName(vernaculars?.results ?? [], key);
}

/** Names for a taxon key: the baked name index first, then the taxon from GBIF and its common name (cached). */
export async function lookupTaxon(key: number): Promise<TaxonInfo | null> {
  const nameIndex = await nameIndexWithin();
  const hit = nameIndex?.get(key);
  if (hit) return taxonFromHit(hit);
  try {
    const usage = await getSpecies(key);
    const commonName = await taxonCommonName(key, usage.rank);
    return {
      key,
      scientificName: usage.canonicalName ?? usage.scientificName,
      rank: usage.rank,
      ...(commonName && { commonName }),
    };
  } catch {
    return null;
  }
}

const names = new Map<number, TaxonInfo>();

/** Display info for $taxonKeys, in key order; placeholders until names resolve (or if lookup fails). */
export const $taxa = atom<TaxonInfo[]>([]);

function info(key: number, isLoading = false): TaxonInfo {
  return (
    names.get(key) ?? { key, scientificName: `Taxon ${key}`, rank: 'UNRANKED', ...(isLoading && { loading: true }) }
  );
}

async function resolve(keys: readonly number[]): Promise<void> {
  // Placeholders first, so chips render immediately.
  $taxa.set(keys.map((key) => info(key, true)));
  const missing = keys.filter((key) => !names.has(key));
  if (!missing.length) return;
  const found = await Promise.all(missing.map(lookupTaxon));
  for (const taxon of found) if (taxon) names.set(taxon.key, taxon);
  // Only publish if the selection has not moved on meanwhile.
  if ($taxonKeys.get() === keys) $taxa.set(keys.map((key) => info(key)));
}

onMount($taxa, () => $taxonKeys.subscribe((keys) => void resolve(keys)));

/** How long the cubes' lookup waits for the baked index before relying on GBIF's answer, already on its way. */
const QUICK_INDEX_MS = 300;

/**
 * A taxon's scientific name and rank, as quickly as possible, for the cubes (which need no common name):
 * the baked index if it's loaded or loads within QUICK_INDEX_MS, else GBIF's species API, asked at once
 * rather than after the index.
 * @returns null when GBIF has no such taxon
 */
export async function lookupTaxonRank(key: number): Promise<{ scientificName: string; rank: Rank } | null> {
  const loaded = nameIndexIfLoaded()?.get(key);
  if (loaded) return taxonFromHit(loaded);
  const fromGbif = getSpecies(key).then(
    (usage) => ({ scientificName: usage.canonicalName ?? usage.scientificName, rank: usage.rank }),
    // No such taxon (or GBIF down): the cubes say a taxon is one they don't hold.
    () => null,
  );
  const hit = (await nameIndexWithin(QUICK_INDEX_MS))?.get(key);
  return hit ? taxonFromHit(hit) : fromGbif;
}

/** A search result (or index entry) as display info. */
export function taxonFromHit(
  hit: Pick<NameHit, 'key' | 'scientificName' | 'rank' | 'commonName' | 'isNamePending'>,
): TaxonInfo {
  return {
    key: hit.key,
    scientificName: hit.scientificName,
    rank: hit.rank,
    ...(hit.isNamePending ? { loading: true } : hit.commonName && { commonName: hit.commonName }),
  };
}

/** Seed the cache when the caller already knows the names (search picks). */
export function primeTaxonInfo(taxon: TaxonInfo): void {
  names.set(taxon.key, taxon);
}

export type AddTaxonResult = 'added' | 'already' | 'full';

/** Add a taxon to the What filter (records of any selected taxon are shown). */
export function addTaxon(taxon: TaxonInfo): AddTaxonResult {
  const keys = $taxonKeys.get();
  if (keys.includes(taxon.key)) return 'already';
  if (keys.length >= MAX_TAXA) return 'full';
  // A taxon still awaiting its name is looked up by the selection instead, so it can't stick with the wrong one.
  if (!taxon.loading) primeTaxonInfo(taxon);
  clearHexSelection();
  $taxonKeys.set([...keys, taxon.key].sort((left, right) => left - right));
  return 'added';
}

/** Takes a taxon out of the selection. */
export function removeTaxon(key: number): void {
  clearHexSelection();
  $taxonKeys.set($taxonKeys.get().filter((existing) => existing !== key));
}

export interface TaxonGroup {
  label: string;
  /** 24×24 stroke icon path (drawn for Taxonomap; see docs/design-system.md, Icons). */
  icon: string;
  taxa: readonly TaxonInfo[];
}

/**
 * Familiar groups for one-tap What filters: animals, then plants and fungi. Reptiles are three
 * classes in GBIF's backbone (Reptilia has no records). Crustaceans are Malacostraca (crabs,
 * lobsters, shrimps, woodlice), the bulk of their records; mosses also sit inside Plants.
 */
export const TAXON_GROUPS: readonly TaxonGroup[] = [
  {
    label: 'Birds',
    icon: 'M2.28 21.16Q10.41 11.61 20.31 4.54M20.31 4.54Q21.02 6.38 18.68 8.57L18.97 11.12Q16.21 14.58 13.87 16.21L11.97 15.43L12.39 16.98Q9.7 17.97 6.52 16.49',
    taxa: [{ key: 212, scientificName: 'Aves', commonName: 'Birds', rank: 'CLASS' }],
  },
  {
    label: 'Mammals',
    icon: 'M3.45 11.28A1.6 2.1 -25 1 0 6.35 9.92A1.6 2.1 -25 1 0 3.45 11.28M7.72 5.82A1.6 2.2 -8 1 0 10.88 5.38A1.6 2.2 -8 1 0 7.72 5.82M13.12 5.38A1.6 2.2 8 1 0 16.28 5.82A1.6 2.2 8 1 0 13.12 5.38M17.65 9.92A1.6 2.1 25 1 0 20.55 11.28A1.6 2.1 25 1 0 17.65 9.92M12 13c-1.5 0-2.5 1.1-3.2 2.3-.5.9-1.7 1.4-2 2.6-.4 1.4.6 2.6 2 2.6 1.2 0 2-.5 3.2-.5s2 .5 3.2.5c1.4 0 2.4-1.2 2-2.6-.3-1.2-1.5-1.7-2-2.6C14.5 14.1 13.5 13 12 13z',
    taxa: [{ key: 359, scientificName: 'Mammalia', commonName: 'Mammals', rank: 'CLASS' }],
  },
  {
    label: 'Reptiles',
    icon: 'M12 2.5c1.3 0 2.2 1 2.2 2.2S13.3 6.6 12 6.6 9.8 5.9 9.8 4.7 10.7 2.5 12 2.5zM12 6.6c1.4 0 2.2 1.5 2.2 4.5s-.8 5-2.2 5-2.2-2-2.2-5 .8-4.5 2.2-4.5zM12 16.1c0 2.5 1 4 3.5 5M10.2 9 7.5 7.5 7 5.5M13.8 9l2.7-1.5.5-2M10.3 13.5l-2.8 1.5-.5 2M13.7 13.5l2.8 1.5.5 2',
    taxa: [
      { key: 11592253, scientificName: 'Squamata', commonName: 'Lizards and snakes', rank: 'CLASS' },
      { key: 11418114, scientificName: 'Testudines', commonName: 'Turtles', rank: 'CLASS' },
      { key: 11493978, scientificName: 'Crocodylia', commonName: 'Crocodilians', rank: 'CLASS' },
    ],
  },
  {
    label: 'Amphibians',
    icon: 'M3.5 19c0-4 2-7.5 5.5-9 1.5-.7 3-1 4.5-1 .4-1.3 1.4-2 2.5-2s2 .7 2.4 1.9c1.2.4 2.1 1.4 2.6 2.6.3.8-.3 1.5-1.1 1.5H17c-.3 1.8-1.4 3.2-3 4l1.2 2zM6.2 19c0-2.7 1.6-4.6 3.8-4.6s3.3 1.7 3.3 4.6M16 8.6v.01M14.5 11.5h5',
    taxa: [{ key: 131, scientificName: 'Amphibia', commonName: 'Amphibians', rank: 'CLASS' }],
  },
  {
    label: 'Fish',
    icon: 'M20 12c-2 3.5-5 5-8.5 5-2.5 0-4.5-1-6.5-3l-2.5 3V7l2.5 3c2-2 4-3 6.5-3 3.5 0 6.5 1.5 8.5 5zM16 11.5v.01',
    taxa: [{ key: 204, scientificName: 'Actinopterygii', commonName: 'Ray-finned fishes', rank: 'CLASS' }],
  },
  {
    label: 'Insects',
    icon: 'M12 8c3 0 5 2.5 5 6s-2 6-5 6-5-2.5-5-6 2-6 5-6zM10 8.3a2 2 0 0 1 4 0M10.5 6 9 3.5M13.5 6 15 3.5M12 10.5V20M7 12 4 10.5M7 15H4M7.5 17.5 5 20M17 12l3-1.5M17 15h3M16.5 17.5 19 20',
    taxa: [{ key: 216, scientificName: 'Insecta', commonName: 'Insects', rank: 'CLASS' }],
  },
  {
    label: 'Arachnids',
    icon: 'M9 14.5a3 3 0 1 0 6 0a3 3 0 1 0-6 0M10.5 10a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0M10.6 11.2 7.5 7.5 4 8.5M13.4 11.2l3.1-3.7 3.5 1M9.2 13.3 5 11.5l-2.5 2M14.8 13.3l4.2-1.8 2.5 2M9.1 15.5l-4.1 1-1.5 3M14.9 15.5l4.1 1 1.5 3M10.2 16.9 8 20.5M13.8 16.9l2.2 3.6',
    taxa: [{ key: 367, scientificName: 'Arachnida', commonName: 'Arachnids', rank: 'CLASS' }],
  },
  {
    label: 'Molluscs',
    icon: 'M3 18h13c2.5 0 4-1.5 4-3.5V12M3 18c1-3 4-5 8-5h4.5c1.5 0 2.5-.5 3-1M18.5 11.5 17.5 8M20.5 11.5l1-3.5M8 15.5v.01M11.5 15v.01',
    taxa: [{ key: 52, scientificName: 'Mollusca', commonName: 'Molluscs', rank: 'PHYLUM' }],
  },
  {
    label: 'Crustaceans',
    icon: 'M5.5 14.5c0-3 2.9-5 6.5-5s6.5 2 6.5 5c0 2-2.9 3.5-6.5 3.5s-6.5-1.5-6.5-3.5zM8 10.5 5.5 7.5M16 10.5l2.5-3M5.5 7.5c-1.5-.5-2.5-2-2-3.5 1 .5 1.5 1.5 2 3.5zm0 0c.5-1.5 1.5-2.5 3-2.5-.5 1.5-1.5 2.5-3 2.5zM18.5 7.5c1.5-.5 2.5-2 2-3.5-1 .5-1.5 1.5-2 3.5zm0 0c-.5-1.5-1.5-2.5-3-2.5.5 1.5 1.5 2.5 3 2.5zM6 16l-3 1.5M6.5 18 4 20M18 16l3 1.5M17.5 18l2.5 2M10.5 9.5V8M13.5 9.5V8',
    taxa: [{ key: 229, scientificName: 'Malacostraca', commonName: 'Crabs, lobsters and woodlice', rank: 'CLASS' }],
  },
  {
    label: 'Plants',
    icon: 'M12 20v-9M12 11C12 7.5 9.5 5 5 5c0 4 2.5 6 7 6zM12 14c0-3 2.5-5 6.5-5 0 3.5-2.5 5-6.5 5zM8 20h8',
    taxa: [{ key: 6, scientificName: 'Plantae', commonName: 'Plants', rank: 'KINGDOM' }],
  },
  {
    label: 'Mosses',
    icon: 'M4 20h16M6.5 20c.5-1.5 1.5-2 2.5-2s2 .5 2.5 2m1 0c.5-1.5 1.5-2 2.5-2s2 .5 2.5 2M9 18l-1.5-9M7.5 9c-.8-.4-1.1-1.3-.8-2.1.8.4 1.1 1.3.8 2.1zM12 18.5V6M12 6c-.6-.6-.6-1.6 0-2.2.6.6.6 1.6 0 2.2zM15 18l1.5-8M16.5 10c.4-.8 1.3-1.1 2.1-.8-.4.8-1.3 1.1-2.1.8z',
    taxa: [{ key: 35, scientificName: 'Bryophyta', commonName: 'Mosses', rank: 'PHYLUM' }],
  },
  {
    label: 'Fungi',
    icon: 'M4 12c0-4.5 3.5-8 8-8s8 3.5 8 8zM9.5 12v6a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-6M9 8.5v.01M14.5 7v.01M16.5 10v.01',
    taxa: [{ key: 5, scientificName: 'Fungi', commonName: 'Fungi', rank: 'KINGDOM' }],
  },
];

/** Add all of `taxa` to the What filter, or remove them all when they are all there already (one history step). */
export function toggleTaxa(taxa: readonly TaxonInfo[]): AddTaxonResult | 'removed' {
  const keys = $taxonKeys.get();
  const mine = new Set(taxa.map((taxon) => taxon.key));
  if (taxa.every((taxon) => keys.includes(taxon.key))) {
    clearHexSelection();
    $taxonKeys.set(keys.filter((key) => !mine.has(key)));
    return 'removed';
  }
  const next = new Set([...keys, ...mine]);
  if (next.size > MAX_TAXA) return 'full';
  for (const taxon of taxa) primeTaxonInfo(taxon);
  clearHexSelection();
  $taxonKeys.set([...next].sort((left, right) => left - right));
  return 'added';
}
