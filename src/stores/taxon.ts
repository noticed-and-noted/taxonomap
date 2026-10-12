/**
 * Display info for the selected taxon (names + rank), derived from
 * $taxonKey. Uses the baked name index first, then one cached GBIF call.
 */
import { atom, onMount } from 'nanostores';
import { nameIndexWithin } from '~/lib/data/name-index';
import { getSpecies, type Rank } from '~/lib/gbif';
import { $taxonKey } from './explorer';

export interface TaxonInfo {
  key: number;
  scientificName: string;
  commonName?: string;
  rank: Rank;
}

export const $taxonInfo = atom<TaxonInfo | null>(null);

const RANKS = { K: 'KINGDOM', P: 'PHYLUM', C: 'CLASS', O: 'ORDER', F: 'FAMILY', G: 'GENUS', S: 'SPECIES' } as const;

let seq = 0;

async function resolve(key: number | null): Promise<void> {
  const mine = ++seq;
  if (key === null) {
    $taxonInfo.set(null);
    return;
  }
  // Placeholder so the chip can render immediately.
  if ($taxonInfo.get()?.key !== key) $taxonInfo.set({ key, scientificName: `Taxon ${key}`, rank: 'SPECIES' });
  const idx = await nameIndexWithin();
  const row = idx?.get(key);
  if (row) {
    if (mine === seq) {
      $taxonInfo.set({ key, scientificName: row[2], rank: RANKS[row[1]], ...(row[3] && { commonName: row[3] }) });
    }
    return;
  }
  try {
    const u = await getSpecies(key);
    if (mine === seq) {
      $taxonInfo.set({
        key,
        scientificName: u.canonicalName ?? u.scientificName,
        rank: u.rank,
        ...(u.vernacularName && { commonName: u.vernacularName }),
      });
    }
  } catch {
    /* keep the placeholder */
  }
}

onMount($taxonInfo, () => $taxonKey.subscribe((k) => void resolve(k)));

/** Seed the cache when the caller already knows the names (omnibox pick). */
export function primeTaxonInfo(info: TaxonInfo): void {
  seq++;
  $taxonInfo.set(info);
}
