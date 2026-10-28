import { speciesJsonLd } from '~/lib/species/json-ld';

const ROBIN = {
  key: 2492462,
  canonicalName: 'Erithacus rubecula',
  commonName: 'European Robin',
  rank: 'SPECIES',
  classification: [
    { key: 1, name: 'Animalia', rank: 'KINGDOM' },
    { key: 212, name: 'Aves', rank: 'CLASS' },
    { key: 2492460, name: 'Erithacus', rank: 'GENUS' },
  ],
} as const;

const PAGE_URL = 'https://app.taxonomap.com/species/2492462/erithacus-rubecula/';

describe('speciesJsonLd', () => {
  const [taxon, crumbs] = (
    speciesJsonLd({
      data: { ...ROBIN, classification: [...ROBIN.classification] },
      pageUrl: PAGE_URL,
      siteUrl: 'https://app.taxonomap.com',
      description: 'Robins.',
      wikipediaUrl: 'https://en.wikipedia.org/wiki/European_robin',
    }) as { '@graph': [Record<string, unknown>, { itemListElement: Record<string, unknown>[] }] }
  )['@graph'];

  it('nests the full lineage, nearest rank first', () => {
    expect(taxon).toMatchObject({
      url: PAGE_URL,
      sameAs: ['https://www.gbif.org/species/2492462', 'https://en.wikipedia.org/wiki/European_robin'],
      parentTaxon: { name: 'Erithacus', parentTaxon: { name: 'Aves', parentTaxon: { name: 'Animalia' } } },
    });
  });

  it('lists breadcrumbs from kingdom to this page', () => {
    expect(crumbs.itemListElement.map((crumb) => [crumb['position'], crumb['name']])).toEqual([
      [1, 'Animalia'],
      [2, 'Aves'],
      [3, 'Erithacus'],
      [4, 'European Robin'],
    ]);
    expect(crumbs.itemListElement[0]?.['item']).toBe('https://app.taxonomap.com/tree/?focus=1');
    expect(crumbs.itemListElement[3]?.['item']).toBe(PAGE_URL);
  });

  it('falls back to the scientific name and GBIF alone when there is no common name or Wikipedia page', () => {
    const { commonName: _omitted, ...scientificOnly } = ROBIN;
    const [bare, bareCrumbs] = (
      speciesJsonLd({
        data: { ...scientificOnly, classification: [] },
        pageUrl: PAGE_URL,
        siteUrl: 'https://app.taxonomap.com',
        description: 'Robins.',
      }) as { '@graph': [Record<string, unknown>, { itemListElement: Record<string, unknown>[] }] }
    )['@graph'];
    expect(bare).not.toHaveProperty('alternateName');
    expect(bare).not.toHaveProperty('parentTaxon');
    expect(bare['sameAs']).toEqual(['https://www.gbif.org/species/2492462']);
    expect(bareCrumbs.itemListElement).toEqual([
      { '@type': 'ListItem', position: 1, name: 'Erithacus rubecula', item: PAGE_URL },
    ]);
  });
});
