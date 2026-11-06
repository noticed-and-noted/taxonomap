import { loadSpeciesData, type CommonNameLookup, type SpeciesData } from '~/lib/species/data';
import { wikipediaIntro, type WikipediaIntro } from '~/lib/species/wikipedia';
import { lookupLimit, once } from './cache';
import { bakedCommonNames } from './names';
import { bakeSpeciesList } from './species-list';

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

/** Every pre-rendered species' page, keyed by species key (memoised; `pnpm bake` saves it). */
export function bakeSpeciesPages(): Promise<Record<string, BakedSpeciesPage>> {
  return once('species-pages', async () => {
    const [list, commonName] = await Promise.all([bakeSpeciesList(), bakedCommonNames()]);
    const limit = lookupLimit();
    const entries = await Promise.all(
      list.map((species) => limit(async () => [String(species.key), await loadPage(species.key, commonName)] as const)),
    );
    return Object.fromEntries(entries);
  });
}

/**
 * One pre-rendered species' page, from the bake when it has it.
 * @param key The GBIF species key.
 * @returns The baked page, or one fetched now for a species the bake left out.
 */
export async function bakedSpeciesPage(key: number): Promise<BakedSpeciesPage> {
  const baked = (await bakeSpeciesPages())[String(key)];
  return baked ?? loadPage(key, await bakedCommonNames());
}
