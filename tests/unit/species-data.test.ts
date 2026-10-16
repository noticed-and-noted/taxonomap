/** Everything a species page shows, and links to species pages. */
import { facets, stubNetwork } from './helpers/network';

const ROBIN = {
  key: 2492462,
  scientificName: 'Erithacus rubecula (Linnaeus, 1758)',
  canonicalName: 'Erithacus rubecula',
  authorship: '(Linnaeus, 1758)',
  rank: 'SPECIES',
  taxonomicStatus: 'ACCEPTED',
  kingdomKey: 1,
  kingdom: 'Animalia',
  classKey: 212,
  class: 'Aves',
  genusKey: 2492460,
  genus: 'Erithacus',
};

function gbif() {
  return stubNetwork((url) => {
    const p = url.pathname;
    const q = url.searchParams;
    if (p === '/v1/species/2492462') return ROBIN;
    if (p === '/v1/species/2492462/vernacularNames')
      return { results: [{ vernacularName: 'European Robin', language: 'eng' }] };
    if (p === '/v1/species/2492462/synonyms')
      return { results: [{ scientificName: 'Motacilla rubecula' }, { scientificName: 'Motacilla rubecula' }] };
    if (p === '/v1/species/2492460/children')
      return {
        results: [
          { key: 2492462, scientificName: 'Erithacus rubecula' },
          { key: 7, canonicalName: 'Erithacus akahige', scientificName: 'Erithacus akahige (Temminck)' },
        ],
      };
    if (p === '/v1/occurrence/search' && q.get('taxonKey') === '2492460')
      return facets(0, 'SPECIES_KEY', [
        [2492462, 100],
        [7, 5],
        [8, 1],
      ]);
    if (p === '/v1/occurrence/search')
      return {
        count: 1234,
        results: [],
        facets: [
          {
            field: 'YEAR',
            counts: [
              { name: '2020', count: 3 },
              { name: '1999', count: 1 },
            ],
          },
          { field: 'MONTH', counts: [{ name: '5', count: 9 }] },
          { field: 'COUNTRY', counts: [{ name: 'GB', count: 7 }] },
          {
            field: 'DATASET_KEY',
            counts: [
              { name: 'ds1', count: 6 },
              { name: 'ds2', count: 1 },
            ],
          },
        ],
      };
    if (p === '/v1/dataset/ds1') return { key: 'ds1', title: 'Garden birds' };
    return undefined;
  });
}

async function load() {
  vi.resetModules();
  return {
    ...(await import('~/lib/species/data')),
    ...(await import('~/lib/species/links')),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('loadSpeciesData', () => {
  it('assembles the page from a fixed set of requests', async () => {
    const calls = gbif();
    const { loadSpeciesData } = await load();
    const d = await loadSpeciesData(2492462, (k) => (k === 7 ? 'Japanese robin' : null));
    expect(d).toMatchObject({
      key: 2492462,
      slug: 'erithacus-rubecula',
      canonicalName: 'Erithacus rubecula',
      authorship: '(Linnaeus, 1758)',
      status: 'ACCEPTED',
      commonName: 'European Robin',
      classification: [
        { key: 1, name: 'Animalia', rank: 'KINGDOM' },
        { key: 212, name: 'Aves', rank: 'CLASS' },
        { key: 2492460, name: 'Erithacus', rank: 'GENUS' },
      ],
      synonyms: ['Motacilla rubecula'],
      count: 1234,
      years: [
        [1999, 1],
        [2020, 3],
      ],
      countries: [['GB', 7]],
      datasets: [
        { key: 'ds1', title: 'Garden birds', count: 6 },
        { key: 'ds2', title: 'Unnamed dataset', count: 1 },
      ],
      // The species itself and unnamed keys are left out.
      siblings: [{ key: 7, scientificName: 'Erithacus akahige', commonName: 'Japanese robin', count: 5 }],
    });
    expect(d.months[4]).toBe(9);
    expect(calls.length).toBeLessThanOrEqual(9);
  });
});

describe('species links', () => {
  it('use the pre-rendered page when the manifest has one', async () => {
    const { speciesPath, similarItems } = await load();
    expect(speciesPath(1, { 1: 'animalia' })).toBe('/species/1/animalia');
    expect(speciesPath(2, null)).toBe('/species/view?key=2');
    expect(similarItems([{ key: 1, scientificName: 'A', count: 1 }], { 1: 'a' })[0]?.href).toBe('/species/1/a');
  });

  it('load the manifest once and publish it', async () => {
    const calls = stubNetwork((url) => (url.pathname === '/data/species-manifest.json' ? { 5: 'x' } : undefined));
    const { loadSpeciesManifest, $speciesManifest } = await load();
    await Promise.all([loadSpeciesManifest(), loadSpeciesManifest()]);
    expect($speciesManifest.get()).toEqual({ 5: 'x' });
    expect(calls).toHaveLength(1);
  });
});
