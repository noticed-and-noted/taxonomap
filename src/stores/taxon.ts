/**
 * Display info (names + rank) for the selected taxa, derived from
 * $taxonKeys. Uses the baked name index first, then one cached GBIF call.
 */
import { atom, onMount } from 'nanostores';
import { nameIndexWithin } from '~/lib/data/name-index';
import { getSpecies, type NameHit, type Rank } from '~/lib/gbif';
import { $taxonKeys, clearHexSelection, MAX_TAXA } from './explorer';

export interface TaxonInfo {
  key: number;
  scientificName: string;
  commonName?: string;
  rank: Rank;
}

/** Names for a taxon key: the baked name index first, then one cached GBIF call. */
export async function lookupTaxon(key: number): Promise<TaxonInfo | null> {
  const idx = await nameIndexWithin();
  const hit = idx?.get(key);
  if (hit) return taxonFromHit(hit);
  try {
    const u = await getSpecies(key);
    return {
      key,
      scientificName: u.canonicalName ?? u.scientificName,
      rank: u.rank,
      ...(u.vernacularName && { commonName: u.vernacularName }),
    };
  } catch {
    return null;
  }
}

const names = new Map<number, TaxonInfo>();

/** Display info for $taxonKeys, in key order; placeholders until names resolve (or if lookup fails). */
export const $taxa = atom<TaxonInfo[]>([]);

function info(key: number): TaxonInfo {
  return names.get(key) ?? { key, scientificName: `Taxon ${key}`, rank: 'UNRANKED' };
}

async function resolve(keys: readonly number[]): Promise<void> {
  // Placeholders first, so chips render immediately.
  $taxa.set(keys.map(info));
  const missing = keys.filter((k) => !names.has(k));
  if (!missing.length) return;
  const found = await Promise.all(missing.map(lookupTaxon));
  for (const t of found) if (t) names.set(t.key, t);
  // Only publish if the selection has not moved on meanwhile.
  if ($taxonKeys.get() === keys) $taxa.set(keys.map(info));
}

onMount($taxa, () => $taxonKeys.subscribe((keys) => void resolve(keys)));

/** A search result (or index entry) as display info. */
export function taxonFromHit(h: Pick<NameHit, 'key' | 'scientificName' | 'rank' | 'commonName'>): TaxonInfo {
  return {
    key: h.key,
    scientificName: h.scientificName,
    rank: h.rank,
    ...(h.commonName && { commonName: h.commonName }),
  };
}

/** Seed the cache when the caller already knows the names (search picks). */
export function primeTaxonInfo(t: TaxonInfo): void {
  names.set(t.key, t);
}

export type AddTaxonResult = 'added' | 'already' | 'full';

/** Add a taxon to the What filter (records of any selected taxon are shown). */
export function addTaxon(t: TaxonInfo): AddTaxonResult {
  const keys = $taxonKeys.get();
  if (keys.includes(t.key)) return 'already';
  if (keys.length >= MAX_TAXA) return 'full';
  primeTaxonInfo(t);
  clearHexSelection();
  $taxonKeys.set([...keys, t.key].sort((a, b) => a - b));
  return 'added';
}

export function removeTaxon(key: number): void {
  clearHexSelection();
  $taxonKeys.set($taxonKeys.get().filter((k) => k !== key));
}
