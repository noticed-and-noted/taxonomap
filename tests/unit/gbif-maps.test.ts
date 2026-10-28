/** Map tile URLs, the smaller GBIF endpoints, the request meter and the build-time entry point. */
import { facets, stubNetwork } from './helpers/network';

async function gbif() {
  vi.resetModules();
  return import('~/lib/gbif');
}

afterEach(() => vi.unstubAllGlobals());

describe('map tiles', () => {
  it('uses density tiles for taxon, year and record type', async () => {
    const api = await gbif();
    const filter = { taxonKey: 212, year: [2000, 2010] as const, basisOfRecord: ['HUMAN_OBSERVATION' as const] };
    expect(api.needsAdhoc(filter)).toBe(false);
    expect(api.occurrenceTileTemplate(filter)).toBe(
      'https://api.gbif.org/v2/map/occurrence/density/{z}/{x}/{y}@1x.png?basisOfRecord=HUMAN_OBSERVATION&bin=hex&hexPerTile=60&srs=EPSG%3A3857&style=purpleYellow-noborder.poly&taxonKey=212&year=2000%2C2010',
    );
  });

  it('switches to adhoc tiles for refinements or several taxa', async () => {
    const api = await gbif();
    expect(api.needsAdhoc({ hasImage: true })).toBe(true);
    expect(api.needsAdhoc({ taxonKeys: [1] })).toBe(false);
    expect(api.needsAdhoc({ taxonKeys: [1, 2] })).toBe(true);
    // Density tiles ignore eventDate (checked against the live API).
    expect(api.needsAdhoc({ eventDate: '2025-01-01,2025-01-07' })).toBe(true);
    const url = new URL(
      api.occurrenceTileTemplate({ taxonKeys: [1, 2], months: [5] }, { hexPerTile: 28 }, 'mvt').replace(/[{}]/g, ''),
    );
    expect(url.pathname).toBe('/v2/map/occurrence/adhoc/z/x/y.mvt');
    expect(url.searchParams.getAll('taxonKey')).toEqual(['1', '2']);
    expect(url.searchParams.get('month')).toBe('5');
    expect(url.searchParams.get('hexPerTile')).toBe('28');
    expect(url.searchParams.has('style')).toBe(false);
    // Adhoc tiles count flagged records unless told not to; density tiles already leave them out.
    expect(url.searchParams.get('hasGeospatialIssue')).toBe('false');
    expect(api.occurrenceTileTemplate({ taxonKey: 1 })).not.toContain('hasGeospatialIssue');
  });

  it('matches exact taxa with acceptedTaxonKey on adhoc tiles', async () => {
    const api = await gbif();
    expect(api.needsAdhoc({ exactTaxon: true })).toBe(false);
    const url = new URL(api.occurrenceTileTemplate({ taxonKey: 5219173, exactTaxon: true }).replace(/[{}]/g, ''));
    expect(url.pathname).toBe('/v2/map/occurrence/adhoc/z/x/y@1x.png');
    expect(url.searchParams.get('acceptedTaxonKey')).toBe('5219173');
    expect(url.searchParams.has('taxonKey')).toBe(false);
    expect(api.filterToParams({ taxonKeys: [1, 2], exactTaxon: true })).toMatchObject({ acceptedTaxonKey: [1, 2] });
  });

  it('takes a style and fills in a concrete tile', async () => {
    const api = await gbif();
    expect(api.tileParams({}, { style: 'classic.point', srs: 'EPSG:3857' })).toMatchObject({ style: 'classic.point' });
    expect(api.occurrenceTileUrl({ country: 'GB' }, 3, 4, 5)).toMatch(
      /^https:\/\/api\.gbif\.org\/v2\/map\/occurrence\/density\/3\/4\/5@1x\.png\?.*country=GB/,
    );
  });

  it('leaves the query off when there is none', async () => {
    vi.resetModules();
    vi.doMock('~/lib/gbif/params', async (original) => ({
      ...(await original<typeof import('~/lib/gbif/params')>()),
      toQueryString: () => '',
    }));
    const api = await import('~/lib/gbif');
    expect(api.occurrenceTileTemplate({})).toBe('https://api.gbif.org/v2/map/occurrence/density/{z}/{x}/{y}@1x.png');
    vi.doUnmock('~/lib/gbif/params');
  });

  it('points GBIF basemap tiles at the theme', async () => {
    const api = await gbif();
    expect(api.gbifBasemapTile(1, 2, 3)).toBe('https://tile.gbif.org/3857/omt/1/2/3@1x.png?style=gbif-dark');
    expect(api.gbifBasemapTile(1, 2, 3, 'light')).toMatch(/style=gbif-light$/);
  });

  it('asks for map capabilities', async () => {
    const calls = stubNetwork(() => ({ total: 1 }));
    const api = await gbif();
    await api.mapCapabilities();
    await api.mapCapabilities({ taxonKey: 212, country: 'GB' });
    expect(calls.map((url) => `${url.pathname}${url.search}`)).toEqual([
      '/v2/map/occurrence/density/capabilities.json',
      '/v2/map/occurrence/density/capabilities.json?country=GB&taxonKey=212',
    ]);
  });
});

describe('datasets and organisations', () => {
  it('fetch by key', async () => {
    const calls = stubNetwork(() => ({ key: 'k', title: 't' }));
    const api = await gbif();
    await api.getDataset('d1');
    await api.getOrganization('o1');
    expect(calls.map((url) => url.pathname)).toEqual(['/v1/dataset/d1', '/v1/organization/o1']);
  });
});

describe('occurrence filters', () => {
  it('limits to georeferenced records, and passes a signal', async () => {
    const calls = stubNetwork(() => ({ count: 3, results: [] }));
    const api = await gbif();
    expect(api.filterToParams({ georeferenced: true })).toMatchObject({
      hasCoordinate: true,
      hasGeospatialIssue: false,
    });
    expect(api.filterToParams({ geometry: 'POLYGON((0 0,1 0,1 1,0 0))' })).toMatchObject({
      hasGeospatialIssue: false,
    });
    const controller = new AbortController();
    await expect(api.occurrenceCount({}, controller.signal)).resolves.toBe(3);
    await api.searchOccurrences({}, undefined, controller.signal);
    expect(calls[1]!.searchParams.get('limit')).toBe('20');
  });

  it('reads a facet response with no facets', async () => {
    stubNetwork(() => ({ count: 5, results: [] }));
    const api = await gbif();
    await expect(api.occurrenceFacets({}, ['year'])).resolves.toEqual({ count: 5, facets: {} });
  });
});

describe('species endpoints with signals', () => {
  it('pass the signal through and read an empty facet', async () => {
    const calls = stubNetwork((url) => (url.pathname === '/v1/species/search' ? { results: [] } : { key: 1 }));
    const api = await gbif();
    const { signal } = new AbortController();
    await api.getSpecies(1, signal);
    await api.getVernacularNames(1, signal);
    await api.getChildren(1, {}, signal);
    await expect(api.speciesCountsUnder(undefined, 10, signal)).resolves.toEqual(new Map());
    expect(calls.map((url) => `${url.pathname}${url.search}`)).toContain('/v1/species/1/children?limit=100');
    stubNetwork(() => ({ facets: [{ field: 'HIGHER_TAXON_KEY' }] }));
    await expect((await gbif()).speciesCountsUnder(2)).resolves.toEqual(new Map());
  });
});

describe('request meter', () => {
  it('counts by kind and resets', async () => {
    const api = await gbif();
    api.countRequest('tile');
    api.countRequest('tile');
    api.countRequest('image');
    expect(api.$requestCounts.get()).toMatchObject({ tile: 2, json: 0, image: 1 });
    api.resetRequestCounts();
    expect(api.$requestCounts.get()).toMatchObject({ tile: 0, json: 0, image: 0 });
  });
});

describe('build-time entry point', () => {
  it('switches the shared client to the Node transport', async () => {
    vi.resetModules();
    const server = await import('~/lib/gbif/server');
    const { http } = await import('~/lib/gbif/http');
    expect(http().options).toMatchObject({ cacheSize: 5000, defaultTtlMs: 24 * 60 * 60 * 1000 });
    expect(server.occurrenceFacets).toBeTypeOf('function');
    expect(facets(0, 'x', [])).toBeTruthy();
  });
});

describe('images', () => {
  it('finds licensed photos and the species names that come with them', async () => {
    const calls = stubNetwork(() => ({
      count: 3,
      endOfRecords: true,
      results: [
        {
          key: 1,
          datasetKey: 'd',
          license: 'CC0_1_0',
          speciesKey: 5,
          species: 'Turdus merula',
          media: [{ identifier: 'a.jpg' }],
        },
        { key: 2, datasetKey: 'd', license: 'CC0_1_0', speciesKey: 6 },
        { key: 3, datasetKey: 'd', license: 'CC0_1_0', species: 'No key' },
      ],
    }));
    const api = await gbif();
    const result = await api.findImages({ taxonKey: 1 }, { signal: new AbortController().signal });
    expect(result.images.map((image) => image.url)).toEqual(['a.jpg']);
    expect([...result.names]).toEqual([[5, 'Turdus merula']]);
    expect(calls[0]!.searchParams.get('limit')).toBe('24');
    await api.findImages({}, { limit: 5 });
    await api.findImages({});
    expect(calls[1]!.searchParams.get('limit')).toBe('5');
  });

  it('uses iNaturalist’s largest size past 1024 px', async () => {
    const api = await gbif();
    const image = {
      source: 'inat' as const,
      photoId: 1,
      licence: 'CC0' as const,
      url: 'https://x.test/photos/1/square.jpg',
    };
    expect(api.thumbnailUrl(image, '2048x2048')).toBe('https://x.test/photos/1/large.jpg');
  });
});

describe('polygonToWkt', () => {
  it('drops repeated points and keeps a ring that is already closed and counter-clockwise', async () => {
    const api = await gbif();
    const ring: [number, number][] = [
      [0, 0],
      [1, 0],
      [1, 0],
      [1, 1],
      [0, 0],
    ];
    expect(api.polygonToWkt(ring)).toBe('POLYGON((0 0,1 0,1 1,0 0))');
    expect(api.polygonToWkt([])).toBe('POLYGON(())');
  });
});
