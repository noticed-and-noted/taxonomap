import { loadSpeciesData, type CommonNameLookup, type SpeciesData } from '~/lib/species/data';
import { nameMeaning, type NamePart } from '~/lib/species/etymology';
import { wikipediaIntro, type WikipediaIntro } from '~/lib/species/wikipedia';
import { lookupLimit, once } from './cache';
import { bakedCommonNames } from './names';
import { bakeSpeciesList } from './species-list';

/** Everything a pre-rendered species page and its Open Graph card show. */
export interface BakedSpeciesPage {
  data: SpeciesData;
  intro: WikipediaIntro | null;
  nameParts: NamePart[] | null;
}

async function loadPage(key: number, commonName: CommonNameLookup): Promise<BakedSpeciesPage> {
  const data = await loadSpeciesData(key, commonName);
  // The page reads fine without an intro or the name's meaning, so a failed lookup just leaves it out.
  const [intro, nameParts] = await Promise.all([
    wikipediaIntro(key).catch(() => null),
    nameMeaning(data.canonicalName).catch(() => null),
  ]);
  return { data, intro, nameParts };
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
