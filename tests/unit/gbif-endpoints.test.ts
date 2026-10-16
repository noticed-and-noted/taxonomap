/** The GBIF endpoint wrappers: which URL each sends, and how responses are shaped. */
import { facets, stubNetwork } from './helpers/network';

async function gbif() {
  vi.resetModules();
  return import('~/lib/gbif');
}

afterEach(() => vi.unstubAllGlobals());

describe('occurrence endpoints', () => {
  it('asks for facets in one request, with per-field limits and paging', async () => {
    const calls = stubNetwork(() => facets(42, 'SPECIES_KEY', [[5, 3]]));
    const g = await gbif();
    const r = await g.occurrenceFacets({ taxonKey: 212 }, ['speciesKey', 'year'], {
      limits: { year: 600 },
      facetOffset: 20,
    });
    expect(r).toEqual({ count: 42, facets: { speciesKey: [{ name: '5', count: 3 }] } });
    const q = calls[0]!.searchParams;
    expect(q.getAll('facet')).toEqual(['speciesKey', 'year']);
    expect([q.get('limit'), q.get('facetLimit'), q.get('year.facetLimit'), q.get('facetOffset')]).toEqual([
      '0',
      '200',
      '600',
      '20',
    ]);
  });

  it('counts records with a zero-row search', async () => {
    const calls = stubNetwork(() => ({ count: 7, results: [] }));
    const g = await gbif();
    await expect(g.occurrenceCount({ country: 'GB' })).resolves.toBe(7);
    expect(calls[0]!.search).toBe('?country=GB&limit=0');
  });

  it('caps page size and never asks past the offset limit', async () => {
    const calls = stubNetwork(() => ({ count: 1, results: [] }));
    const g = await gbif();
    await g.searchOccurrences({}, { limit: 1000, offset: -5 });
    expect(calls[0]!.search).toBe('?limit=300&offset=0');
    const past = await g.searchOccurrences({}, { limit: 300, offset: 100_000 });
    expect(past).toMatchObject({ endOfRecords: true, results: [] });
    expect(calls).toHaveLength(1);
  });

  it('searches species in a circle', async () => {
    const calls = stubNetwork(() => facets(1, 'SPECIES_KEY', []));
    const g = await gbif();
    await g.speciesInRadius(51.5, -0.1, 5, { month: 4 }, 50);
    const q = calls[0]!.searchParams;
    expect(q.get('geometry')).toMatch(/^POLYGON/);
    expect([q.get('month'), q.get('facetLimit')]).toEqual(['4', '50']);
  });

  it('fetches one record by key', async () => {
    const calls = stubNetwork(() => ({ key: 9, datasetKey: 'd' }));
    const g = await gbif();
    await expect(g.getOccurrence(9)).resolves.toMatchObject({ key: 9 });
    expect(calls[0]!.pathname).toBe('/v1/occurrence/9');
  });
});

describe('species endpoints', () => {
  it('build the expected requests', async () => {
    const calls = stubNetwork(() => ({ results: [] }));
    const g = await gbif();
    await g.suggestSpecies('  Turdus ', { rank: 'SPECIES' });
    await g.searchVernacular('robin');
    await g.listByRank('CLASS', 1000);
    await g.matchName('Aves');
    await g.matchNameV2('Aves');
    await g.getVernacularNames(212);
    await g.getSynonyms(212);
    await g.getChildren(212, { offset: 100 });
    await g.getParents(212);
    expect(calls.map((u) => `${u.pathname}${u.search}`)).toEqual([
      '/v1/species/suggest?datasetKey=d7dddbf4-2cf0-4f39-9b2a-bb099caae36c&limit=8&q=Turdus&rank=SPECIES',
      '/v1/species/search?datasetKey=d7dddbf4-2cf0-4f39-9b2a-bb099caae36c&limit=10&q=robin&qField=VERNACULAR&status=ACCEPTED',
      '/v1/species/search?datasetKey=d7dddbf4-2cf0-4f39-9b2a-bb099caae36c&limit=1000&offset=1000&rank=CLASS&status=ACCEPTED',
      '/v1/species/match?name=Aves',
      '/v2/species/match?scientificName=Aves',
      '/v1/species/212/vernacularNames?limit=300',
      '/v1/species/212/synonyms?limit=100',
      '/v1/species/212/children?limit=100&offset=100',
      '/v1/species/212/parents',
    ]);
  });

  it('counts species under each descendant from one facet', async () => {
    stubNetwork(() => facets(0, 'HIGHER_TAXON_KEY', [[212, 11000]]));
    const g = await gbif();
    expect([...(await g.speciesCountsUnder(1))]).toEqual([[212, 11000]]);
  });

  it('prefers a preferred English common name', async () => {
    const g = await gbif();
    const names = [
      { vernacularName: 'Rotkehlchen', language: 'deu', preferred: true },
      { vernacularName: 'Robin', language: 'eng' },
      { vernacularName: 'European robin', language: 'eng', preferred: true },
    ];
    expect(g.pickCommonName(names)).toBe('European robin');
    expect(g.pickCommonName(names.slice(0, 1))).toBeUndefined();
  });
});

describe('live name providers', () => {
  it('suggest drops synonyms and uses canonical names', async () => {
    stubNetwork(() => [
      { key: 1, scientificName: 'Turdus merula L.', canonicalName: 'Turdus merula', rank: 'SPECIES' },
      { key: 2, scientificName: 'Merula vulgaris', rank: 'SPECIES', synonym: true },
    ]);
    const g = await gbif();
    expect(await g.gbifSuggestProvider.search('turdus')).toEqual([
      { key: 1, scientificName: 'Turdus merula', rank: 'SPECIES', source: 'suggest' },
    ]);
  });

  it('vernacular search shows the matching name, English first', async () => {
    stubNetwork(() => ({
      results: [
        {
          key: 1,
          scientificName: 'Erithacus rubecula',
          rank: 'SPECIES',
          vernacularNames: [
            { vernacularName: 'Robin redbreast', language: 'fra' },
            { vernacularName: 'European robin', language: 'eng' },
          ],
        },
        { key: 2, scientificName: 'Robinia', rank: 'GENUS' },
      ],
    }));
    const g = await gbif();
    expect(await g.gbifVernacularProvider.search(' Robin ')).toEqual([
      {
        key: 1,
        scientificName: 'Erithacus rubecula',
        rank: 'SPECIES',
        commonName: 'European robin',
        source: 'vernacular',
      },
      { key: 2, scientificName: 'Robinia', rank: 'GENUS', source: 'vernacular' },
    ]);
  });
});

describe('errors', () => {
  it('maps thrown values to UI categories', async () => {
    const g = await gbif();
    expect(g.classifyError(new g.GbifNotFoundError('u', 404, ''))).toBe('not-found');
    expect(g.classifyError(new g.GbifRequestError('u', 400, ''))).toBe('bad-request');
    expect(g.classifyError(new g.GbifUnavailableError('u'))).toBe('unavailable');
    expect(g.classifyError(new Error('x'))).toBe('unknown');
  });
});
