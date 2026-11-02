import { inatNames } from '~/lib/photos/taxon-photos';
import type { SpeciesData } from './data';

/**
 * A species page rendered in the browser, named as iNaturalist names the taxon when the name
 * index didn't name it. The page's photo gallery matches the taxon to iNaturalist anyway and
 * reuses this match (the remembered ID and the fetched taxon), so it costs no extra request.
 * @returns The data with iNaturalist's name, or as it was when iNaturalist has none or fails.
 */
export async function withInatName(data: SpeciesData): Promise<SpeciesData> {
  const names = await inatNames([{ key: data.key, rank: data.rank }]).catch(() => null);
  const name = names?.get(data.key);
  return name ? { ...data, commonName: name } : data;
}
