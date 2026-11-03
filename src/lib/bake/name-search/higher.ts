/** Preview rows for the baked index's higher ranks, matched by the about page's own code so the two can't drift. */
import { resolveInatIds, type PhotoTaxon } from '~/lib/photos/taxon-photos';
import type { PreviewRow } from '~/lib/name-search/preview';
import { chunks } from '../inat';
import { taxonFacts } from './photos';

/** Taxa matched per call. Each costs its own GBIF search; the chunk only limits what a failure loses. */
const MATCH_CHUNK = 50;

/** Each taxon's iNaturalist ID. A chunk that fails is left without, so its taxa keep the live path. */
async function matchHigherTaxa(taxa: readonly PhotoTaxon[]): Promise<Map<number, number>> {
  const ids = new Map<number, number>();
  for (const chunk of chunks(taxa, MATCH_CHUNK)) {
    try {
      for (const [key, id] of await resolveInatIds(chunk)) ids.set(key, id);
    } catch (error) {
      console.warn(`Higher taxa skipped for ${chunk.length} keys:`, String(error));
    }
  }
  return ids;
}

/**
 * Preview rows for higher taxa, with their first open curated photo where they have one. Taxa
 * iNaturalist doesn't match get no row.
 * shortcut: curated results are reused without checking the default photo, so a later bake keeps
 * an old lead; list these taxa too if higher ranks stay baked.
 */
export async function higherRankRows(taxa: readonly PhotoTaxon[]): Promise<Map<number, PreviewRow>> {
  const ids = await matchHigherTaxa(taxa);
  const { facts } = await taxonFacts([...new Set(ids.values())], new Map());
  const rows = new Map<number, PreviewRow>();
  for (const [key, inatId] of ids) {
    const photo = facts.get(inatId)?.photo;
    rows.set(key, { inatId, ...(photo && { photo }) });
  }
  return rows;
}
