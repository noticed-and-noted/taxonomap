/** Everything a species page shows, and links to species pages. */
import { isGraphql, json, namedFacets, predicateOf, stubNetwork } from './helpers/network';

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

function gbif(usage: Record<string, unknown> = ROBIN, redListCode = 'LC') {
  return stubNetwork((url) => {
    const path = url.pathname;
    if (path === '/v1/species/2492462') return usage;
    if (path === '/v1/species/2492462/vernacularNames')
      return { results: [{ vernacularName: 'European Robin', language: 'eng' }] };
    if (path === '/v1/species/2492462/synonyms')
      return { results: [{ scientificName: 'Motacilla rubecula' }, { scientificName: 'Motacilla rubecula' }] };
    if (isGraphql(url) && predicateOf(url)['taxonKey']?.[0] === '2492460')
      return namedFacets(0, 'speciesKey', [
        [2492462, 100, 'Erithacus rubecula'],
        [7, 5, 'Erithacus akahige'],
        [8, 1],
      ]);
    if (isGraphql(url))
      return {
        data: {
          occurrenceSearch: {
            documents: { total: 1234 },
            facet: {
              year: [
                { key: 2020, count: 3 },
                { key: 1999, count: 1 },
              ],
              month: [{ key: 5, count: 9 }],
              countryCode: [{ key: 'GB', count: 7 }],
              datasetKey: [
                { key: 'ds1', count: 6, dataset: { title: 'Garden birds' } },
                { key: 'ds2', count: 1, dataset: null },
              ],
            },
          },
        },
      };
    if (path === '/v1/species/2492462/iucnRedListCategory') return { code: redListCode, iucnTaxonID: '22710_1' };
    if (path === '/v1/species/2492462/distributions')
      return { results: [{ country: 'IE', establishmentMeans: 'INTRODUCED', source: 'GRIIS - Ireland' }] };
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
    const data = await loadSpeciesData(2492462, (key) => (key === 7 ? 'Japanese robin' : null));
    expect(data).toMatchObject({
      key: 2492462,
      slug: 'erithacus-rubecula',
      canonicalName: 'Erithacus rubecula',
      authorship: '(Linnaeus, 1758)',
      status: 'ACCEPTED',
      commonName: 'European Robin',
      redList: { code: 'LC', iucnTaxonId: '22710' },
      distribution: { introduced: ['IE'], invasive: [], sources: 1 },
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
    expect(data.months[4]).toBe(9);
    expect(calls.length).toBeLessThanOrEqual(8);
  });

  it('lists a sibling without a common name when neither the index nor GBIF has one', async () => {
    gbif();
    const { loadSpeciesData } = await load();
    const data = await loadSpeciesData(2492462, () => null);
    expect(data.siblings).toEqual([{ key: 7, scientificName: 'Erithacus akahige', count: 5 }]);
  });

  it('leaves out a data-deficient Red List category', async () => {
    gbif(ROBIN, 'DD');
    const { loadSpeciesData } = await load();
    expect((await loadSpeciesData(2492462)).redList).toBeUndefined();
  });

  it('leaves out the Red List and range for higher ranks without asking GBIF', async () => {
    const calls = gbif({ ...ROBIN, rank: 'GENUS' });
    const { loadSpeciesData } = await load();
    const data = await loadSpeciesData(2492462);
    expect(data.redList).toBeUndefined();
    expect(data.distribution).toBeUndefined();
    expect(calls.some((call) => /iucnRedListCategory|distributions/.test(call.pathname))).toBe(false);
  });
});

describe('loadSpeciesData with sparse answers', () => {
  const bad = () => json({ message: 'bad' }, 400);

  it('fills gaps from the lookup and leaves out what GBIF does not have', async () => {
    stubNetwork((url) => {
      if (url.pathname === '/v1/species/1') return { key: 1, scientificName: 'Alpha beta', rank: 'SPECIES' };
      if (isGraphql(url)) return { data: { occurrenceSearch: { documents: { total: 2 }, facet: {} } } };
      return bad();
    });
    const { loadSpeciesData } = await load();
    const data = await loadSpeciesData(1, () => 'Lookup name');
    expect(data).toMatchObject({
      canonicalName: 'Alpha beta',
      commonName: 'Lookup name',
      synonyms: [],
      vernacular: [],
    });
    expect(data).not.toHaveProperty('authorship');
    expect(data).not.toHaveProperty('status');
    expect([data.years, data.countries, data.datasets, data.siblings]).toEqual([[], [], [], []]);
    expect(data.months).toEqual(Array(12).fill(0));
  });

  it('has no siblings when the genus has no other recorded species, or cannot be loaded', async () => {
    stubNetwork((url) => {
      if (url.pathname === '/v1/species/2')
        return { key: 2, scientificName: 'Alpha gamma', rank: 'SPECIES', genusKey: 9 };
      if (url.pathname === '/v1/species/3')
        return { key: 3, scientificName: 'Alpha delta', rank: 'SPECIES', genusKey: 10 };
      if (isGraphql(url) && predicateOf(url)['taxonKey']?.[0] === '9')
        return namedFacets(1, 'speciesKey', [[2, 1, 'Alpha gamma']]);
      if (isGraphql(url) && predicateOf(url)['taxonKey']?.[0] === '10') return bad();
      if (isGraphql(url)) return namedFacets(0, 'speciesKey', []);
      return bad();
    });
    const { loadSpeciesData } = await load();
    const data = await loadSpeciesData(2);
    expect(data.siblings).toEqual([]);
    expect(data).not.toHaveProperty('commonName');
    await expect(loadSpeciesData(3)).resolves.toMatchObject({ siblings: [] });
  });
});

describe('species links', () => {
  it('use the pre-rendered page when the manifest has one', async () => {
    const { speciesPath, similarItems } = await load();
    expect(speciesPath(1, { 1: 'animalia' })).toBe('/species/1/animalia/');
    expect(speciesPath(2, null)).toBe('/species/view/2');
    expect(similarItems([{ key: 1, scientificName: 'A', count: 1 }], { 1: 'a' })[0]?.href).toBe('/species/1/a/');
  });

  it('load the manifest once and publish it', async () => {
    const calls = stubNetwork((url) => (url.pathname === '/data/species-manifest.json' ? { 5: 'x' } : undefined));
    const { loadSpeciesManifest, $speciesManifest } = await load();
    await Promise.all([loadSpeciesManifest(), loadSpeciesManifest()]);
    expect($speciesManifest.get()).toEqual({ 5: 'x' });
    expect(calls).toHaveLength(1);
  });

  it('publish null when the manifest is missing or unreachable', async () => {
    stubNetwork(() => undefined);
    const first = await load();
    await expect(first.loadSpeciesManifest()).resolves.toBeNull();
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('offline')));
    const second = await load();
    await expect(second.loadSpeciesManifest()).resolves.toBeNull();
    expect(second.$speciesManifest.get()).toBeNull();
  });
});

describe('species charts', () => {
  it('names countries and links datasets', async () => {
    const { speciesCharts } = await import('~/lib/species/charts');
    const data = { countries: [['GB', 3]], datasets: [{ key: 'ds', title: 'Garden birds', count: 2 }] } as never;
    expect(speciesCharts(data)).toEqual({
      countries: [{ label: 'United Kingdom', value: 3 }],
      datasets: [{ label: 'Garden birds', value: 2, href: 'https://www.gbif.org/dataset/ds' }],
    });
  });
});
