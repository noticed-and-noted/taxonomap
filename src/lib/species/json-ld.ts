import type { SpeciesData, TaxonRef } from './data';

interface JsonLdInput {
  data: Pick<SpeciesData, 'key' | 'canonicalName' | 'commonName' | 'rank' | 'classification'>;
  pageUrl: string;
  siteUrl: string;
  description: string;
  wikipediaUrl?: string | undefined;
}

const gbifSpeciesUrl = (key: number) => `https://www.gbif.org/species/${key}`;

/** Nests the lineage so each taxon's parentTaxon is the rank above it, ending at the kingdom. */
function parentChain(classification: readonly TaxonRef[]): object | undefined {
  return classification.reduce<object | undefined>(
    (parent, taxon) => ({
      '@type': 'Taxon',
      name: taxon.name,
      taxonRank: taxon.rank.toLowerCase(),
      identifier: gbifSpeciesUrl(taxon.key),
      ...(parent && { parentTaxon: parent }),
    }),
    undefined,
  );
}

/** The classification as breadcrumbs, each linking to its place in the tree, ending at this page. */
function breadcrumbs({ data, pageUrl, siteUrl }: JsonLdInput): object {
  const lineage = data.classification.map((taxon) => ({
    name: taxon.name,
    item: new URL(`/tree/?focus=${taxon.key}`, siteUrl).href,
  }));
  return {
    '@type': 'BreadcrumbList',
    itemListElement: [...lineage, { name: data.commonName ?? data.canonicalName, item: pageUrl }].map(
      (crumb, index) => ({ '@type': 'ListItem', position: index + 1, ...crumb }),
    ),
  };
}

/**
 * Structured data for a species page: the Taxon with its full lineage, and a breadcrumb trail.
 * @returns A JSON-LD graph, ready to stringify into a script tag.
 */
export function speciesJsonLd(input: JsonLdInput): object {
  const { data, pageUrl, description, wikipediaUrl } = input;
  const taxon = {
    '@type': 'Taxon',
    '@id': pageUrl,
    url: pageUrl,
    name: data.canonicalName,
    ...(data.commonName && { alternateName: data.commonName }),
    description,
    taxonRank: data.rank.toLowerCase(),
    identifier: gbifSpeciesUrl(data.key),
    sameAs: [gbifSpeciesUrl(data.key), ...(wikipediaUrl ? [wikipediaUrl] : [])],
    ...(data.classification.length && { parentTaxon: parentChain(data.classification) }),
  };
  return { '@context': 'https://schema.org', '@graph': [taxon, breadcrumbs(input)] };
}
