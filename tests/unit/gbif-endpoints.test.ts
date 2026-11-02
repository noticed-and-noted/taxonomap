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
    const api = await gbif();
    const result = await api.occurrenceFacets({ taxonKey: 212 }, ['speciesKey', 'year'], {
      limits: { year: 600 },
      facetOffset: 20,
    });
    expect(result).toEqual({ count: 42, facets: { speciesKey: [{ name: '5', count: 3 }] } });
    const params = calls[0]!.searchParams;
    expect(params.getAll('facet')).toEqual(['speciesKey', 'year']);
    expect([
      params.get('limit'),
      params.get('facetLimit'),
      params.get('year.facetLimit'),
      params.get('facetOffset'),
    ]).toEqual(['0', '200', '600', '20']);
  });

  it('counts records with a zero-row search', async () => {
    const calls = stubNetwork(() => ({ count: 7, results: [] }));
    const api = await gbif();
    await expect(api.occurrenceCount({ country: 'GB' })).resolves.toBe(7);
    expect(calls[0]!.search).toBe('?country=GB&limit=0');
  });

  it('caps page size and never asks past the offset limit', async () => {
    const calls = stubNetwork(() => ({ count: 1, results: [] }));
    const api = await gbif();
    await api.searchOccurrences({}, { limit: 1000, offset: -5 });
    expect(calls[0]!.search).toBe('?limit=300&offset=0');
    const past = await api.searchOccurrences({}, { limit: 300, offset: 100_000 });
    expect(past).toMatchObject({ endOfRecords: true, results: [] });
    expect(calls).toHaveLength(1);
  });

  it('fetches one record by key', async () => {
    const calls = stubNetwork(() => ({ key: 9, datasetKey: 'd' }));
    const api = await gbif();
    await expect(api.getOccurrence(9)).resolves.toMatchObject({ key: 9 });
    expect(calls[0]!.pathname).toBe('/v1/occurrence/9');
  });
});

describe('species endpoints', () => {
  it('build the expected requests', async () => {
    const calls = stubNetwork(() => ({ results: [] }));
    const api = await gbif();
    await api.suggestSpecies('  Turdus ', { rank: 'SPECIES' });
    await api.searchVernacular('robin');
    await api.listByRank('CLASS', 1000);
    await api.getVernacularNames(212);
    await api.getSynonyms(212);
    await api.getChildren(212, { offset: 100 });
    await api.getParents(212);
    expect(calls.map((url) => `${url.pathname}${url.search}`)).toEqual([
      '/v1/species/suggest?datasetKey=d7dddbf4-2cf0-4f39-9b2a-bb099caae36c&limit=8&q=Turdus&rank=SPECIES&status=ACCEPTED',
      '/v1/species/search?datasetKey=d7dddbf4-2cf0-4f39-9b2a-bb099caae36c&limit=10&q=robin&qField=VERNACULAR&status=ACCEPTED',
      '/v1/species/search?datasetKey=d7dddbf4-2cf0-4f39-9b2a-bb099caae36c&limit=1000&offset=1000&rank=CLASS&status=ACCEPTED',
      '/v1/species/212/vernacularNames?limit=1000',
      '/v1/species/212/synonyms?limit=100',
      '/v1/species/212/children?limit=100&offset=100',
      '/v1/species/212/parents',
    ]);
  });

  it('lists accepted children by search, loading pages after the first from its count', async () => {
    const calls = stubNetwork((url) => {
      const offset = Number(url.searchParams.get('offset'));
      return { count: 2001, results: [{ key: offset }] };
    });
    const api = await gbif();
    const children = await api.getAllChildren(212, 'GENUS');
    expect(children.map((child) => child.key)).toEqual([0, 1000, 2000]);
    const params = calls[0]!.searchParams;
    expect([params.get('highertaxonKey'), params.get('rank'), params.get('status'), params.get('limit')]).toEqual([
      '212',
      'GENUS',
      'ACCEPTED',
      '1000',
    ]);
  });

  it('stops after the first page when the search gives no count', async () => {
    const calls = stubNetwork(() => ({ results: [{ key: 1 }] }));
    const api = await gbif();
    await expect(api.getAllChildren(212, 'GENUS')).resolves.toEqual([{ key: 1 }]);
    expect(calls).toHaveLength(1);
  });

  it('counts species under each descendant from one facet', async () => {
    stubNetwork(() => facets(0, 'HIGHER_TAXON_KEY', [[212, 11000]]));
    const api = await gbif();
    expect([...(await api.speciesCountsUnder(1))]).toEqual([[212, 11000]]);
  });
});

describe('live name providers', () => {
  it('suggest drops synonyms and uses canonical names', async () => {
    stubNetwork(() => [
      { key: 1, scientificName: 'Turdus merula L.', canonicalName: 'Turdus merula', rank: 'SPECIES' },
      { key: 2, scientificName: 'Merula vulgaris', rank: 'SPECIES', synonym: true },
    ]);
    const api = await gbif();
    expect(await api.gbifSuggestProvider.search('turdus')).toEqual([
      { key: 1, scientificName: 'Turdus merula', rank: 'SPECIES', source: 'suggest' },
    ]);
  });

  it('vernacular search shows the English name over other languages', async () => {
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
    const api = await gbif();
    expect(await api.gbifVernacularProvider.search(' Robin ')).toEqual([
      {
        key: 1,
        scientificName: 'Erithacus rubecula',
        rank: 'SPECIES',
        commonName: 'European robin',
        englishNames: ['European robin'],
        source: 'vernacular',
      },
      { key: 2, scientificName: 'Robinia', rank: 'GENUS', source: 'vernacular' },
    ]);
  });

  it('name search asks every name field for accepted names, and gives each hit its English names', async () => {
    const calls = stubNetwork(() => ({
      results: [
        {
          key: 1,
          scientificName: 'Coccinella septempunctata Linnaeus, 1758',
          canonicalName: 'Coccinella septempunctata',
          rank: 'SPECIES',
          vernacularNames: [{ vernacularName: 'Seven-spot ladybird', language: 'eng' }],
        },
        { key: 2, scientificName: 'Karagama', rank: 'GENUS' },
      ],
    }));
    const api = await gbif();
    expect(await api.gbifSearchProvider.search(' ladybird ')).toEqual([
      {
        key: 1,
        scientificName: 'Coccinella septempunctata',
        rank: 'SPECIES',
        commonName: 'Seven-spot ladybird',
        englishNames: ['Seven-spot ladybird'],
        source: 'search',
      },
      { key: 2, scientificName: 'Karagama', rank: 'GENUS', source: 'search' },
    ]);
    const asked = new URL(calls[0]!, 'http://site.test').searchParams;
    expect(asked.get('q')).toBe('ladybird');
    expect(asked.get('status')).toBe('ACCEPTED');
    expect(asked.has('qField')).toBe(false);
  });

  it('vernacular search shows the main English name, not a rarer alias that matched', async () => {
    const english = (vernacularName: string) => ({ vernacularName, language: 'eng' });
    stubNetwork(() => ({
      results: [
        {
          key: 6065844,
          scientificName: 'Leucophaeus atricilla',
          rank: 'SPECIES',
          vernacularNames: [
            english('Laughing Gull'),
            english('Black-headed Gull'),
            english('Laughing Gull'),
            english('Laughing Gull'),
          ],
        },
      ],
    }));
    const api = await gbif();
    const [hit] = await api.gbifVernacularProvider.search('black headed gull');
    expect(hit?.commonName).toBe('Laughing Gull');
  });

  it('vernacular search shows no common name when there is no English one', async () => {
    stubNetwork(() => ({
      results: [
        {
          key: 1,
          scientificName: 'Larus fuscus',
          rank: 'SPECIES',
          vernacularNames: [
            { vernacularName: 'Sildemåke', language: 'nob' },
            { vernacularName: 'Mouette brune', language: 'fra' },
          ],
        },
      ],
    }));
    const api = await gbif();
    const [hit] = await api.gbifVernacularProvider.search('mouette');
    expect(hit?.commonName).toBeUndefined();
  });
});

describe('errors', () => {
  it('maps thrown values to UI categories', async () => {
    const api = await gbif();
    expect(api.classifyError(new api.GbifNotFoundError('u', 404, ''))).toBe('not-found');
    expect(api.classifyError(new api.GbifRequestError('u', 400, ''))).toBe('bad-request');
    expect(api.classifyError(new api.GbifUnavailableError('u'))).toBe('unavailable');
    expect(api.classifyError(new Error('x'))).toBe('unknown');
  });
});
