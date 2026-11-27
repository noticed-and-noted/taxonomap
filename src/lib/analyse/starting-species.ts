/**
 * The species Analyse's picker opens with: well-known migrants, and species that were introduced or have spread.
 * Keys were matched once with GBIF's `species/match`. The tags are picked by hand: GBIF's checklists mark natives
 * as introduced somewhere (the white stork) and EOL's trait data misses insect migrants (the monarch).
 */
import { normalise } from '~/lib/data/name-index';

/** Why a species is on the list. */
export type AnalyseTag = 'Migrates' | 'Introduced' | 'Invasive';

/** A row in Analyse's species picker. */
export interface AnalyseSpecies {
  key: number;
  commonName: string;
  scientificName: string;
  /** What kind of living thing it is, so typing "bird" or "beetle" finds it. */
  group: string;
  tags: readonly AnalyseTag[];
}

export const STARTING_SPECIES: readonly AnalyseSpecies[] = [
  { key: 9515886, commonName: 'Barn swallow', scientificName: 'Hirundo rustica', group: 'Bird', tags: ['Migrates'] },
  { key: 2481912, commonName: 'White stork', scientificName: 'Ciconia ciconia', group: 'Bird', tags: ['Migrates'] },
  { key: 5228676, commonName: 'Common swift', scientificName: 'Apus apus', group: 'Bird', tags: ['Migrates'] },
  { key: 5229230, commonName: 'Arctic tern', scientificName: 'Sterna paradisaea', group: 'Bird', tags: ['Migrates'] },
  { key: 5231918, commonName: 'Common cuckoo', scientificName: 'Cuculus canorus', group: 'Bird', tags: ['Migrates'] },
  {
    key: 5228514,
    commonName: 'Ruby-throated hummingbird',
    scientificName: 'Archilochus colubris',
    group: 'Bird',
    tags: ['Migrates'],
  },
  {
    key: 5220086,
    commonName: 'Humpback whale',
    scientificName: 'Megaptera novaeangliae',
    group: 'Mammal whale',
    tags: ['Migrates'],
  },
  {
    key: 4299368,
    commonName: 'Painted lady',
    scientificName: 'Vanessa cardui',
    group: 'Insect butterfly',
    tags: ['Migrates'],
  },
  {
    key: 5133088,
    commonName: 'Monarch',
    scientificName: 'Danaus plexippus',
    group: 'Insect butterfly',
    tags: ['Migrates', 'Introduced'],
  },
  {
    key: 2479226,
    commonName: 'Rose-ringed parakeet',
    scientificName: 'Psittacula krameri',
    group: 'Bird',
    tags: ['Invasive'],
  },
  {
    key: 2498252,
    commonName: 'Egyptian goose',
    scientificName: 'Alopochen aegyptiaca',
    group: 'Bird',
    tags: ['Invasive'],
  },
  {
    key: 2495696,
    commonName: 'Eurasian collared dove',
    scientificName: 'Streptopelia decaocto',
    group: 'Bird',
    tags: ['Introduced'],
  },
  {
    key: 4989904,
    commonName: 'Harlequin ladybird',
    scientificName: 'Harmonia axyridis',
    group: 'Insect beetle',
    tags: ['Invasive'],
  },
  {
    key: 1311477,
    commonName: 'Asian hornet',
    scientificName: 'Vespa velutina',
    group: 'Insect wasp',
    tags: ['Invasive'],
  },
  {
    key: 5157899,
    commonName: 'Spotted lanternfly',
    scientificName: 'Lycorma delicatula',
    group: 'Insect bug',
    tags: ['Invasive'],
  },
  {
    key: 5219681,
    commonName: 'Grey squirrel',
    scientificName: 'Sciurus carolinensis',
    group: 'Mammal',
    tags: ['Invasive'],
  },
  {
    key: 5216933,
    commonName: 'Cane toad',
    scientificName: 'Rhinella marina',
    group: 'Amphibian frog',
    tags: ['Invasive'],
  },
  {
    key: 2889173,
    commonName: 'Japanese knotweed',
    scientificName: 'Reynoutria japonica',
    group: 'Plant',
    tags: ['Invasive'],
  },
  {
    key: 2891770,
    commonName: 'Himalayan balsam',
    scientificName: 'Impatiens glandulifera',
    group: 'Plant',
    tags: ['Invasive'],
  },
];

/**
 * The starting species whose names, group or tags contain the query (case and accents ignored).
 * @returns Every species for an empty query.
 */
export function filterStartingSpecies(query: string): readonly AnalyseSpecies[] {
  const needle = normalise(query);
  if (!needle) return STARTING_SPECIES;
  return STARTING_SPECIES.filter((species) =>
    [species.commonName, species.scientificName, species.group, ...species.tags].some((text) =>
      normalise(text).includes(needle),
    ),
  );
}
