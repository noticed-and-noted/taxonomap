/** "What's near me" data: the area filter and the share-card tallies. */
import type { NameRow } from '~/lib/data/types';
import { facets, snapshots, stubNetwork } from './helpers/network';

const NAMES: NameRow[] = [
  [1, 'S', 'Erithacus rubecula', 'European robin', 10],
  [2, 'S', 'Passer domesticus', null, 9],
];
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
    const q = calls[0]!.searchParams;
    expect(q.get('geometry')).toMatch(/^POLYGON\(\(/);
    expect(q.get('month')).toBe('5');
    expect(q.get('facetLimit')).toBe('50');
  });

  it('gives the circle as an occurrence filter for the records list', async () => {
    const { nearFilter } = await load();
    expect(nearFilter({ ...AREA, month: 5 })).toMatchObject({ geometry: expect.stringMatching(/^POLYGON\(\(/), month: 5 });
  });

  it('tallies distinct species overall and for the six leading classes', async () => {
    const calls = stubNetwork((url) => {
      if (url.pathname === '/v1/occurrence/search') {
        const taxon = url.searchParams.get('taxonKey');
        return taxon === '212'
          ? facets(5, 'SPECIES_KEY', [[1, 5]])
          : facets(9, 'SPECIES_KEY', [
              [2, 6],
              [1, 3],
            ]);
      }
      return snapshots({ names: NAMES })(url);
    });
    const { speciesTallies } = await load();
    const classes = Array.from({ length: 7 }, (_, i) => ({ key: i === 0 ? 212 : 1000 + i, name: `C${i}`, records: 1 }));
    const t = await speciesTallies(AREA, classes);
    expect(t.total).toBe(2);
    expect(t.topNames).toEqual(['Passer domesticus', 'European robin']);
    expect(t.groups).toHaveLength(6);
    expect(t.groups[0]).toMatchObject({ key: 212, species: 1, topNames: ['European robin'] });
    // One request overall plus one per group.
    expect(calls.filter((u) => u.pathname === '/v1/occurrence/search')).toHaveLength(7);
  });
});

describe('near data without much to go on', () => {
  it('copes with missing facets, keys and names, and passes signals on', async () => {
    const calls = stubNetwork((url) => {
      if (url.pathname === '/v1/occurrence/search') return { count: 0, results: [] };
      return snapshots({})(url);
    });
    const { classesNear, speciesNear, speciesTallies } = await load();
    const { signal } = new AbortController();
    await expect(classesNear(AREA, signal)).resolves.toEqual({ records: 0, classes: [] });
    const classes = [{ key: 212, name: 'Aves', records: 1 }];
    await expect(speciesNear(AREA, null, signal)).resolves.toEqual([]);
    await expect(speciesNear(AREA, 212)).resolves.toEqual([]);
    await expect(speciesTallies(AREA, classes)).resolves.toEqual({
      total: 0,
      topNames: [],
      groups: [{ ...classes[0], species: 0, topNames: [] }],
    });
    const perClass = calls.filter((u) => u.searchParams.get('classKey') === '212');
    expect(perClass[0]!.searchParams.get('facetLimit')).toBe('200');
  });
});
