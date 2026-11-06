/**
 * Everything a species page shows, loaded with a fixed, small number of
 * GBIF requests (no per-record loops):
 *   detail · vernacular names · synonyms · one facet request (years, months,
 *   countries, datasets with their titles) · one facet request for the genus
 *   (siblings ranked by records, with their names) · siblings' common names.
 * The facets come from GBIF's GraphQL API, which names each value.
 * Photos are not part of it: the gallery and cards fetch them in the browser
 * (see ~/lib/photos/taxon-photos).
 *
 * Isomorphic: build time imports ~/lib/gbif/server first (Node transport);
 * the /species/view fallback calls it in the browser.
 */
import {
  getDistributions,
  getRedListCategory,
  getSpecies,
  getSynonyms,
  getVernacularNames,
  MONTHS_IN_YEAR,
  monthCounts,
  namedOccurrenceFacets,
  type NamedFacetCount,
  type NameUsage,
  type Rank,
} from '~/lib/gbif';
import { summariseDistributions, type DistributionSummary } from './distribution';
import { englishName, groupByLanguage, slugify, type NamesByLanguage } from './names';

const SYNONYM_LIMIT = 30;
const SIBLING_LIMIT = 8;
// Red List and checklist distributions cover species and below; higher ranks only get empty answers.
const SPECIES_RANKS: readonly Rank[] = ['SPECIES', 'SUBSPECIES', 'VARIETY'];
// Not evaluated and data deficient say nothing about threat, so the page shows no chip for them.
const UNRATED_CODES = new Set(['NE', 'DD']);

/** A taxon on a species' lineage. */
export interface TaxonRef {
  key: number;
  name: string;
  rank: Rank;
}

export interface SiblingSpecies {
  key: number;
  scientificName: string;
  commonName?: string;
  count: number;
}

/** A species' global IUCN Red List category. */
export interface RedListStatus {
  code: string;
  iucnTaxonId?: string;
}

export interface SpeciesData {
  key: number;
  slug: string;
  scientificName: string;
  canonicalName: string;
  authorship?: string;
  rank: Rank;
  status?: string;
  commonName?: string;
  /** IUCN Red List code (LC, NT, … EX) and IUCN's own taxon ID; absent when not evaluated, data deficient or unknown. */
  redList?: RedListStatus;
  /** Countries checklists say it was introduced to; absent when none say. */
  distribution?: DistributionSummary;
  classification: TaxonRef[];
  vernacular: NamesByLanguage[];
  synonyms: string[];
  count: number;
  years: [number, number][];
  months: number[];
  countries: [string, number][];
  datasets: { key: string; title: string; count: number }[];
  siblings: SiblingSpecies[];
  generated: string;
}

/** Optional common-name lookup (build: baked index; browser: loaded index). */
/** Finds a common name by taxon key (e.g. from the baked name index). */
export type CommonNameLookup = (key: number) => string | null | undefined;

const HIGHER: [keyof NameUsage, keyof NameUsage, Rank][] = [
  ['kingdomKey', 'kingdom', 'KINGDOM'],
  ['phylumKey', 'phylum', 'PHYLUM'],
  ['classKey', 'class', 'CLASS'],
  ['orderKey', 'order', 'ORDER'],
  ['familyKey', 'family', 'FAMILY'],
  ['genusKey', 'genus', 'GENUS'],
];

/** The lineage from kingdom to genus, skipping ranks GBIF has no name for. */
export function classificationOf(usage: NameUsage): TaxonRef[] {
  const out: TaxonRef[] = [];
  for (const [groupKey, groupName, rank] of HIGHER) {
    const key = usage[groupKey];
    const name = usage[groupName];
    if (typeof key === 'number' && typeof name === 'string') out.push({ key, name, rank });
  }
  return out;
}

/** URL slug for a species page, from its canonical name. */
export function speciesSlug(usage: Pick<NameUsage, 'canonicalName' | 'scientificName'>): string {
  return slugify(usage.canonicalName ?? usage.scientificName);
}

/** The most-recorded other species of the same genus, with common names where known (the baked index first). */
async function siblingsOf(usage: NameUsage, commonName: CommonNameLookup): Promise<SiblingSpecies[]> {
  if (!usage.genusKey) return [];
  const facets = await namedOccurrenceFacets({ taxonKey: usage.genusKey }, ['speciesKey'], { facetLimit: 12 });
  const top = facets.facets.speciesKey
    .flatMap(({ name, count, label }) =>
      label && Number(name) !== usage.key ? [{ key: Number(name), count, scientificName: label }] : [],
    )
    .slice(0, SIBLING_LIMIT);
  if (!top.length) return [];
  // The baked index (iNaturalist's names) misses many species, so fall back to their GBIF vernacular names;
  // the similar-species cards swap in iNaturalist's from the photo lookup they make anyway.
  return Promise.all(
    top.map(async (sibling) => {
      const siblingCommonName =
        commonName(sibling.key) ??
        englishName((await getVernacularNames(sibling.key).catch(() => ({ results: [] }))).results, sibling.key);
      return {
        key: sibling.key,
        scientificName: sibling.scientificName,
        count: sibling.count,
        ...(siblingCommonName && { commonName: siblingCommonName }),
      };
    }),
  );
}

/** The IUCN category for an assessed rank, or null (not evaluated, or GBIF failed: the page just omits the chip). */
async function redListOf(usage: NameUsage): Promise<RedListStatus | null> {
  if (!SPECIES_RANKS.includes(usage.rank)) return null;
  const { code, iucnTaxonID } = await getRedListCategory(usage.key).catch(() => ({
    code: undefined,
    iucnTaxonID: undefined,
  }));
  if (!code || UNRATED_CODES.has(code)) return null;
  // GBIF ids look like "22685441_1"; iucnredlist.org's /species/ URLs take only the number before the underscore.
  const iucnTaxonId = iucnTaxonID?.split('_')[0];
  return { code, ...(iucnTaxonId && { iucnTaxonId }) };
}

/** Introduced countries for a species rank, or null (none listed, or GBIF failed: the section is left out). */
async function distributionOf(usage: NameUsage): Promise<DistributionSummary | null> {
  if (!SPECIES_RANKS.includes(usage.rank)) return null;
  const { results } = await getDistributions(usage.key).catch(() => ({ results: [] }));
  return summariseDistributions(results);
}

/** A dataset facet value with its title ("Unnamed dataset" when GBIF has none). */
function datasetTitle(facet: NamedFacetCount) {
  return { key: facet.name, title: facet.label ?? 'Unnamed dataset', count: facet.count };
}

/**
 * Everything a species page shows, from GBIF.
 * @param key GBIF species key.
 * @param commonName Looks up the common name to show ahead of GBIF's (the baked name index, which holds iNaturalist's).
 * @throws GbifNotFoundError when GBIF has no such taxon.
 */
export async function loadSpeciesData(key: number, commonName: CommonNameLookup = () => null): Promise<SpeciesData> {
  const usage = await getSpecies(key);
  const [vernaculars, synonyms, facets, siblings, redList, distribution] = await Promise.all([
    getVernacularNames(key).catch(() => ({ results: [] })),
    getSynonyms(key, SYNONYM_LIMIT).catch(() => ({ results: [] })),
    namedOccurrenceFacets({ taxonKey: key }, ['year', 'month', 'country', 'datasetKey'], {
      limits: { year: 700, month: MONTHS_IN_YEAR, country: 10, datasetKey: 5 },
    }),
    siblingsOf(usage, commonName).catch(() => []),
    redListOf(usage),
    distributionOf(usage),
  ]);

  const common = commonName(key) ?? englishName(vernaculars.results, key) ?? undefined;
  return {
    key,
    slug: speciesSlug(usage),
    scientificName: usage.scientificName,
    canonicalName: usage.canonicalName ?? usage.scientificName,
    ...(usage.authorship && { authorship: usage.authorship }),
    rank: usage.rank,
    ...(usage.taxonomicStatus && { status: usage.taxonomicStatus }),
    ...(common && { commonName: common }),
    ...(redList && { redList }),
    ...(distribution && { distribution }),
    classification: classificationOf(usage),
    vernacular: groupByLanguage(vernaculars.results),
    synonyms: [...new Set(synonyms.results.map((synonym) => synonym.scientificName))].slice(0, SYNONYM_LIMIT),
    count: facets.count,
    years: facets.facets.year
      .map((facet) => [Number(facet.name), facet.count] as [number, number])
      .sort((left, right) => left[0] - right[0]),
    months: monthCounts(facets.facets.month),
    countries: facets.facets.country.map((facet) => [facet.name, facet.count] as [string, number]),
    datasets: facets.facets.datasetKey.map(datasetTitle),
    siblings,
    generated: new Date().toISOString(),
  };
}
