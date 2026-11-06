import { isDev } from '~/lib/env';
import { getSpecies } from '~/lib/gbif/server';
import { speciesSlug } from '~/lib/species/data';
import { countedFacets, lookupLimit, once, rethrowUnlessMissing } from './cache';

const DEFAULT_PRERENDER_COUNT = 2000;
const DEV_PRERENDER_COUNT = 12;
/** Extra facet rows requested per class, so species already picked don't leave the class short. */
const CLASS_FACET_HEADROOM = 20;

/**
 * Major classes and their share of the pre-render budget, so pages cover
 * what naturalists look up (birds, insects, plants…) rather than only the
 * globally most-recorded species, which are overwhelmingly birds.
 */
const PRERENDER_CLASSES: { key: number; share: number }[] = [
  { key: 212, share: 0.3 }, // Aves
  { key: 216, share: 0.14 }, // Insecta
  { key: 220, share: 0.16 }, // Magnoliopsida
  { key: 196, share: 0.04 }, // Liliopsida
  { key: 359, share: 0.06 }, // Mammalia
  { key: 131, share: 0.02 }, // Amphibia
  { key: 11592253, share: 0.02 }, // Squamata
  { key: 204, share: 0.03 }, // Actinopterygii
  { key: 367, share: 0.02 }, // Arachnida
  { key: 225, share: 0.02 }, // Gastropoda
  { key: 186, share: 0.03 }, // Agaricomycetes
  { key: 180, share: 0.01 }, // Lecanoromycetes
  { key: 194, share: 0.01 }, // Pinopsida
  { key: 7228684, share: 0.01 }, // Polypodiopsida
];

/** How many species get a static page: `SPECIES_PRERENDER_COUNT`, else a small number in dev. */
export function prerenderCount(): number {
  const count = Number(process.env['SPECIES_PRERENDER_COUNT']);
  if (Number.isFinite(count) && count >= 0) return Math.floor(count);
  return isDev() ? DEV_PRERENDER_COUNT : DEFAULT_PRERENDER_COUNT;
}

/** A species that gets a static page. */
export interface PrerenderSpecies {
  key: number;
  slug: string;
  count: number;
}

/** Species keys with record counts: each class's share of `total`, then the global top fills the remainder. */
async function pickSpeciesKeys(total: number): Promise<Map<number, number>> {
  const picked = new Map<number, number>();
  const take = (rows: { name: string; count: number }[] | undefined, want: number) => {
    let added = 0;
    for (const row of rows ?? []) {
      if (added >= want || picked.size >= total) break;
      const key = Number(row.name);
      if (!picked.has(key)) {
        picked.set(key, row.count);
        added++;
      }
    }
  };
  for (const classGroup of PRERENDER_CLASSES) {
    const want = Math.ceil(total * classGroup.share);
    const facetLimit = want + CLASS_FACET_HEADROOM;
    const result = await countedFacets({ taxonKey: classGroup.key }, ['speciesKey'], { facetLimit });
    take(result.facets['speciesKey'], want);
  }
  if (picked.size < total) {
    const result = await countedFacets({}, ['speciesKey'], { facetLimit: total * 2 });
    take(result.facets['speciesKey'], total - picked.size);
  }
  return picked;
}

/** The species that get static pages (memoised; shared by pages, OG images and the manifest). */
export async function bakeSpeciesList(): Promise<PrerenderSpecies[]> {
  const list = await pickedSpecies();
  // A baked list may hold more than this build's count (baked without the same env): keep the most-recorded.
  // shortcut: trimming drops the per-class balance, re-bake with the same count to get it back.
  return list.slice(0, prerenderCount());
}

function pickedSpecies(): Promise<PrerenderSpecies[]> {
  return once('species-list', fetchSpeciesList, []);
}

/** The most-recorded accepted species, picked per class, busiest first. */
async function fetchSpeciesList(): Promise<PrerenderSpecies[]> {
  const total = prerenderCount();
  if (total === 0) return [];
  const picked = await pickSpeciesKeys(total);
  const limit = lookupLimit();
  const rows = await Promise.all(
    [...picked].map(([key, count]) =>
      limit(async (): Promise<PrerenderSpecies | null> => {
        try {
          const usage = await getSpecies(key);
          // Only accepted species get a canonical page.
          if (usage.rank !== 'SPECIES') return null;
          return { key, slug: speciesSlug(usage), count };
        } catch (error) {
          return rethrowUnlessMissing(error);
        }
      }),
    ),
  );
  return rows.filter((row): row is PrerenderSpecies => row !== null).sort((left, right) => right.count - left.count);
}
