/** "What's near me" data: the area filter. */
import { facets, snapshots, stubNetwork } from './helpers/network';

const AREA = { lat: 51.5, lng: -0.12, radiusKm: 2 };

async function load() {
  vi.resetModules();
  return import('~/lib/near/data');
}

afterEach(() => vi.unstubAllGlobals());

describe('near data', () => {
  it('counts the classes in a circle, optionally for one month', async () => {
    const calls = stubNetwork((url) =>
      url.pathname === '/v1/occurrence/search'
        ? facets(120, 'CLASS_KEY', [[212, 100]])
        : snapshots({ tree: [{ k: 212, n: 'Aves', r: 'C', o: 1, s: 1 }] })(url),
    );
    const { classesNear } = await load();
    await expect(classesNear({ ...AREA, month: 5 })).resolves.toEqual({
      records: 120,
      classes: [{ key: 212, name: 'Aves', records: 100 }],
    });
    const params = calls[0]!.searchParams;
    expect(params.get('geometry')).toMatch(/^POLYGON\(\(/);
    expect(params.get('month')).toBe('5');
    expect(params.get('facetLimit')).toBe('50');
  });

  it('gives the circle as an occurrence filter for the records list', async () => {
    const { nearFilter } = await load();
    expect(nearFilter({ ...AREA, month: 5 })).toMatchObject({
      geometry: expect.stringMatching(/^POLYGON\(\(/),
      month: 5,
    });
  });
});

describe('near data without much to go on', () => {
  it('copes with missing facets, keys and names, and passes signals on', async () => {
    const calls = stubNetwork((url) => {
      if (url.pathname === '/v1/occurrence/search') return { count: 0, results: [] };
      return snapshots({})(url);
    });
    const { classesNear, speciesNear } = await load();
    const { signal } = new AbortController();
    await expect(classesNear(AREA, signal)).resolves.toEqual({ records: 0, classes: [] });
    await expect(speciesNear(AREA, null, signal)).resolves.toEqual([]);
    await expect(speciesNear(AREA, 212)).resolves.toEqual([]);
    const perClass = calls.filter((url) => url.searchParams.get('classKey') === '212');
    expect(perClass[0]!.searchParams.get('facetLimit')).toBe('200');
  });
});
