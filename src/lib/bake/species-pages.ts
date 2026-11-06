import { loadSpeciesData, type CommonNameLookup, type SpeciesData } from '~/lib/species/data';
import { wikipediaIntro, type WikipediaIntro } from '~/lib/species/wikipedia';
import { lookupLimit, once } from './cache';
import { bakedCommonNames } from './names';
import { bakeSpeciesList, type PrerenderSpecies } from './species-list';

/** What a pre-rendered species page and its Open Graph card show, bar the name's meaning (looked up in the browser). */
export interface BakedSpeciesPage {
  data: SpeciesData;
  intro: WikipediaIntro | null;
}

async function loadPage(key: number, commonName: CommonNameLookup): Promise<BakedSpeciesPage> {
  // The page reads fine without an intro, so a failed lookup just leaves it out.
  const [data, intro] = await Promise.all([loadSpeciesData(key, commonName), wikipediaIntro(key).catch(() => null)]);
  return { data, intro };
}

async function fetchSpeciesPages(): Promise<Record<string, BakedSpeciesPage>> {
  const [list, commonName] = await Promise.all([bakeSpeciesList(), bakedCommonNames()]);
  const limit = lookupLimit();
  const entries = await Promise.all(
    list.map((species) => limit(async () => [String(species.key), await loadPage(species.key, commonName)] as const)),
  );
  return Object.fromEntries(entries);
}

/** Every pre-rendered species' page, keyed by species key (memoised; `pnpm bake` saves it). */
export function bakeSpeciesPages(): Promise<Record<string, BakedSpeciesPage>> {
  return once('species-pages', fetchSpeciesPages, {});
}

/** The species that get a static page: those the bake saved one for. The rest render in the browser. */
export async function prerenderedSpecies(): Promise<PrerenderSpecies[]> {
  const [list, pages] = await Promise.all([bakeSpeciesList(), bakeSpeciesPages()]);
  return list.filter((species) => String(species.key) in pages);
}

/**
 * One pre-rendered species' baked page.
 * @param key A key from `prerenderedSpecies()`.
 * @throws Error when the bake has no page for it.
 */
export async function bakedSpeciesPage(key: number): Promise<BakedSpeciesPage> {
  const page = (await bakeSpeciesPages())[String(key)];
  if (!page) throw new Error(`The bake has no page for species ${key}`);
  return page;
}

/** key → slug for every pre-rendered species (links elsewhere use /species/view). */
export async function bakeSpeciesManifest(): Promise<Record<string, string>> {
  const species = await prerenderedSpecies();
  return Object.fromEntries(species.map((prerendered) => [String(prerendered.key), prerendered.slug]));
}
