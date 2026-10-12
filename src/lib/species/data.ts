/**
 * Everything a species page shows, loaded with a fixed, small number of
 * GBIF requests (no per-record loops):
 *   detail · vernacular names · synonyms · one facet request (years, months,
 *   countries, datasets) · one image search · one facet request for the
 *   genus (siblings ranked by records) · children of the genus (names) ·
 *   one image search for all siblings · dataset titles for the top 5.
 *
 * Isomorphic: build time imports ~/lib/gbif/server first (Node transport);
 * the /species/view fallback calls it in the browser.
 */
import {
  findImages,
  getChildren,
  INATURALIST_DATASET_KEY,
  getDataset,
  getSpecies,
  getSynonyms,
  getVernacularNames,
  occurrenceFacets,
  type NameUsage,
  type Rank,
  type UsableImage,
} from '~/lib/gbif';
import { englishName, groupByLanguage, slugify, type NamesByLanguage } from './names';

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
  image?: UsableImage;
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
  classification: TaxonRef[];
  vernacular: NamesByLanguage[];
  synonyms: string[];
  count: number;
  years: [number, number][];
  months: number[];
  countries: [string, number][];
  datasets: { key: string; title: string; count: number }[];
  images: UsableImage[];
  siblings: SiblingSpecies[];
  generated: string;
}

/** Optional common-name lookup (build: baked index; browser: loaded index). */
export type CommonNameLookup = (key: number) => string | null | undefined;

const HIGHER: [keyof NameUsage, keyof NameUsage, Rank][] = [
  ['kingdomKey', 'kingdom', 'KINGDOM'],
  ['phylumKey', 'phylum', 'PHYLUM'],
  ['classKey', 'class', 'CLASS'],
  ['orderKey', 'order', 'ORDER'],
  ['familyKey', 'family', 'FAMILY'],
  ['genusKey', 'genus', 'GENUS'],
];

export function classificationOf(u: NameUsage): TaxonRef[] {
  const out: TaxonRef[] = [];
  for (const [k, n, rank] of HIGHER) {
    const key = u[k];
    const name = u[n];
    if (typeof key === 'number' && typeof name === 'string') out.push({ key, name, rank });
  }
  return out;
}

export function speciesSlug(u: Pick<NameUsage, 'canonicalName' | 'scientificName'>): string {
  return slugify(u.canonicalName ?? u.scientificName);
}

/** Pick up to `n` images, at most one per occurrence for variety. */
function pickImages(images: UsableImage[], n: number): UsableImage[] {
  const seen = new Set<number>();
  const out: UsableImage[] = [];
  for (const img of images) {
    if (seen.has(img.occurrenceKey)) continue;
    seen.add(img.occurrenceKey);
    out.push(img);
    if (out.length >= n) break;
  }
  return out;
}

/**
 * Photos: iNaturalist research-grade first (consistently good, per-photo
 * licences), topped up from all datasets when there are too few.
 */
async function speciesImages(key: number): Promise<{ images: UsableImage[] }> {
  const none = { images: [] as UsableImage[] };
  const inat = await findImages({ taxonKey: key, datasetKey: INATURALIST_DATASET_KEY }, { limit: 30 }).catch(
    () => none,
  );
  if (pickImages(inat.images, 12).length >= 8) return inat;
  const any = await findImages({ taxonKey: key }, { limit: 40 }).catch(() => none);
  return { images: [...inat.images, ...any.images] };
}

async function siblingsOf(u: NameUsage, commonName: CommonNameLookup): Promise<SiblingSpecies[]> {
  if (!u.genusKey) return [];
  const [facets, children] = await Promise.all([
    occurrenceFacets({ taxonKey: u.genusKey }, ['speciesKey'], { facetLimit: 12 }),
    getChildren(u.genusKey, { limit: 200 }),
  ]);
  const names = new Map(children.results.map((c) => [c.key, c.canonicalName ?? c.scientificName]));
  const top = (facets.facets['speciesKey'] ?? [])
    .map((c) => ({ key: Number(c.name), count: c.count }))
    .filter((s) => s.key !== u.key && names.has(s.key))
    .slice(0, 8);
  if (!top.length) return [];
  const images = await findImages({ speciesKeys: top.map((s) => s.key) }, { limit: 80 }).catch(() => null);
  const byKey = new Map<number, UsableImage>();
  for (const img of images?.images ?? []) {
    if (img.speciesKey !== undefined && !byKey.has(img.speciesKey)) byKey.set(img.speciesKey, img);
  }
  return top.map((s) => {
    const cn = commonName(s.key);
    const image = byKey.get(s.key);
    return {
      key: s.key,
      scientificName: names.get(s.key) as string,
      count: s.count,
      ...(cn && { commonName: cn }),
      ...(image && { image }),
    };
  });
}

export async function loadSpeciesData(key: number, commonName: CommonNameLookup = () => null): Promise<SpeciesData> {
  const u = await getSpecies(key);
  const [vern, syn, facets, imgs, siblings] = await Promise.all([
    getVernacularNames(key, 300).catch(() => ({ results: [] })),
    getSynonyms(key, 30).catch(() => ({ results: [] })),
    occurrenceFacets({ taxonKey: key }, ['year', 'month', 'country', 'datasetKey'], {
      limits: { year: 700, month: 12, country: 10, datasetKey: 5 },
    }),
    speciesImages(key),
    siblingsOf(u, commonName).catch(() => []),
  ]);

  const months = Array(12).fill(0) as number[];
  for (const c of facets.facets['month'] ?? []) months[Number(c.name) - 1] = c.count;
  const datasetCounts = facets.facets['datasetKey'] ?? [];
  const datasets = await Promise.all(
    datasetCounts.map(async (c) => {
      const d = await getDataset(c.name).catch(() => null);
      return { key: c.name, title: d?.title ?? 'Unnamed dataset', count: c.count };
    }),
  );

  const common = englishName(vern.results) ?? commonName(key) ?? undefined;
  return {
    key,
    slug: speciesSlug(u),
    scientificName: u.scientificName,
    canonicalName: u.canonicalName ?? u.scientificName,
    ...(u.authorship && { authorship: u.authorship }),
    rank: u.rank,
    ...(u.taxonomicStatus && { status: u.taxonomicStatus }),
    ...(common && { commonName: common }),
    classification: classificationOf(u),
    vernacular: groupByLanguage(vern.results),
    synonyms: [...new Set(syn.results.map((s) => s.scientificName))].slice(0, 30),
    count: facets.count,
    years: (facets.facets['year'] ?? [])
      .map((c) => [Number(c.name), c.count] as [number, number])
      .sort((a, b) => a[0] - b[0]),
    months,
    countries: (facets.facets['country'] ?? []).map((c) => [c.name, c.count] as [string, number]),
    datasets,
    images: pickImages(imgs.images, 12),
    siblings,
    generated: new Date().toISOString(),
  };
}
