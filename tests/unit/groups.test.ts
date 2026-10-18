/**
 * Species grouped by class (the cell and Near me tables): naming classes,
 * one facet request per leading class, names from the index with a batched
 * fallback, and stopping once superseded.
 */
import type { NameRow, TreeNodeRow } from '~/lib/data/types';
import { facets, json, nums, snapshots, stubNetwork } from './helpers/network';

const TREE: TreeNodeRow[] = [
  { k: 212, n: 'Aves', c: 'Birds', r: 'C', o: 1, s: 1 },
  { k: 359, n: 'Mammalia', r: 'C', o: 1, s: 1 },
];
const NAMES: NameRow[] = [
  [1, 'S', 'Erithacus rubecula', 'European robin', 10],
  [2, 'S', 'Passer domesticus', null, 9],
];

async function load() {
  vi.resetModules();
  return import('~/lib/species/groups');
}

afterEach(() => vi.unstubAllGlobals());

describe('namedClasses', () => {
  it('names classes from the tree snapshot, falling back to a detail lookup', async () => {
    const calls = stubNetwork((url) => {
      if (url.pathname === '/v1/species/131')
        return { key: 131, scientificName: 'Amphibia L.', canonicalName: 'Amphibia' };
      return snapshots({ tree: TREE })(url);
    });
    const { namedClasses } = await load();
    const groups = await namedClasses([
      { name: '212', count: 50 },
      { name: '131', count: 20 },
      { name: '999', count: 1 },
    ]);
    expect(groups).toEqual([
      { key: 212, name: 'Aves', common: 'Birds', records: 50 },
      { key: 131, name: 'Amphibia', records: 20 },
      { key: 999, name: 'Class 999', records: 1 },
    ]);
    expect(calls.filter((u) => u.pathname === '/data/tree.json')).toHaveLength(1);
  });
});

describe('speciesInClasses', () => {
  it('queries each leading class, ranks rows by records and names them', async () => {
    const calls = stubNetwork((url) => {
      if (url.pathname === '/v1/occurrence/search' && url.searchParams.get('facet') === 'speciesKey') {
        const cls = Number(url.searchParams.get('classKey'));
        if (cls === 212)
          return facets(30, 'SPECIES_KEY', [
            [1, 20],
            [3, 5],
          ]);
        if (cls === 359) return facets(9, 'SPECIES_KEY', [[2, 9]]);
      }
      if (url.pathname === '/v1/occurrence/search') {
        // Batched fallback for names the index lacks.
        expect(nums(url, 'speciesKey')).toEqual([3]);
        return { count: 1, results: [{ key: 9, datasetKey: 'd', speciesKey: 3, species: 'Turdus merula' }] };
      }
      return snapshots({ names: NAMES })(url);
    });
    const { nameFromRecords, speciesInClasses } = await load();
    const indexed = await speciesInClasses(
      { taxonKeys: [5] },
      [
        { key: 212, name: 'Aves', records: 30 },
        { key: 359, name: 'Mammalia', records: 9 },
        { key: 131, name: 'Amphibia', records: 1 },
      ],
      { maxClasses: 2, perClass: 10 },
    );
    // Index names first, so rows can show before the batched search.
    expect(indexed.find((r) => r.key === 3)).toMatchObject({ scientificName: 'Species 3', unnamed: true });
    const rows = await nameFromRecords(indexed);
    expect(rows).toEqual([
      { key: 1, records: 20, classKey: 212, scientificName: 'Erithacus rubecula', commonName: 'European robin' },
      { key: 2, records: 9, classKey: 359, scientificName: 'Passer domesticus' },
      { key: 3, records: 5, classKey: 212, scientificName: 'Turdus merula' },
    ]);
    const perClass = calls.filter((u) => u.searchParams.get('facet') === 'speciesKey');
    // Only the two leading classes, each AND'd with the caller's filter.
    expect(perClass.map((u) => u.searchParams.get('classKey'))).toEqual(['212', '359']);
    expect(perClass.every((u) => u.searchParams.get('taxonKey') === '5')).toBe(true);
    expect(perClass[0]?.searchParams.get('facetLimit')).toBe('10');
  });

  it('uses facets the caller already has instead of querying their class', async () => {
    const calls = stubNetwork((url) => {
      if (url.searchParams.get('facet') === 'speciesKey') return facets(9, 'SPECIES_KEY', [[2, 9]]);
      return snapshots({ names: NAMES })(url);
    });
    const { speciesInClasses } = await load();
    const rows = await speciesInClasses(
      {},
      [
        { key: 212, name: 'Aves', records: 30 },
        { key: 359, name: 'Mammalia', records: 9 },
      ],
      { known: new Map([[212, [{ name: '1', count: 20 }]]]) },
    );
    expect(rows.map((r) => [r.key, r.classKey])).toEqual([
      [1, 212],
      [2, 359],
    ]);
    const perClass = calls.filter((u) => u.searchParams.get('facet') === 'speciesKey');
    expect(perClass.map((u) => u.searchParams.get('classKey'))).toEqual(['359']);
  });

  it('marks rows it could not name', async () => {
    stubNetwork((url) => {
      if (url.searchParams.get('facet') === 'speciesKey') return facets(1, 'SPECIES_KEY', [[77, 1]]);
      if (url.pathname === '/v1/occurrence/search') return { count: 0, results: [] };
      return snapshots({ names: NAMES })(url);
    });
    const { nameFromRecords, speciesInClasses } = await load();
    const rows = await nameFromRecords(await speciesInClasses({}, [{ key: 212, name: 'Aves', records: 1 }]));
    expect(rows).toEqual([{ key: 77, records: 1, classKey: 212, scientificName: 'Species 77', unnamed: true }]);
  });

  it('returns nothing (and asks for no names) when the classes are empty', async () => {
    const calls = stubNetwork((url) =>
      url.searchParams.get('facet') === 'speciesKey' ? facets(0, 'SPECIES_KEY', []) : undefined,
    );
    const { speciesInClasses } = await load();
    await expect(speciesInClasses({}, [{ key: 212, name: 'Aves', records: 0 }])).resolves.toEqual([]);
    expect(calls.some((u) => u.pathname === '/data/names.json')).toBe(false);
  });

  it('stops once its signal aborts', async () => {
    stubNetwork(() => facets(0, 'SPECIES_KEY', []));
    const { speciesInClasses } = await load();
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(
      speciesInClasses({}, [{ key: 212, name: 'Aves', records: 0 }], { signal: ctrl.signal }),
    ).rejects.toThrow();
  });
});

describe('resolveNames', () => {
  it('looks up each key, dropping failures', async () => {
    stubNetwork((url) => {
      if (url.pathname === '/v1/species/1') return { key: 1, scientificName: 'A b L.', canonicalName: 'A b' };
      if (url.pathname === '/v1/species/2') return { key: 2, scientificName: 'C d' };
      return json({}, 404);
    });
    const { resolveNames } = await load();
    const names = await resolveNames([1, 2, 3]);
    expect([...names]).toEqual([
      [1, 'A b'],
      [2, 'C d'],
    ]);
  });

  it('skips the remaining lookups once superseded', async () => {
    const calls = stubNetwork(() => ({ key: 1, scientificName: 'x' }));
    const { resolveNames } = await load();
    const ctrl = new AbortController();
    ctrl.abort();
    expect((await resolveNames([1, 2], ctrl.signal)).size).toBe(0);
    expect(calls).toHaveLength(0);
  });
});

describe('without the baked data', () => {
  it('names classes by lookup and treats a missing facet as no species', async () => {
    stubNetwork((url) => {
      if (url.pathname === '/v1/species/212') return { key: 212, scientificName: 'Aves' };
      if (url.pathname === '/v1/occurrence/search') return { count: 0, results: [] };
      return undefined;
    });
    const { namedClasses, speciesInClasses } = await load();
    const classes = await namedClasses([{ name: '212', count: 5 }]);
    expect(classes).toEqual([{ key: 212, name: 'Aves', records: 5 }]);
    await expect(speciesInClasses({}, classes)).resolves.toEqual([]);
  });
});

describe('nameFromRecords', () => {
  const rows = [
    { key: 1, scientificName: 'Species 1', records: 3, classKey: 212, unnamed: true as const },
    { key: 2, scientificName: 'Passer domesticus', records: 2, classKey: 212 },
  ];

  it('returns the rows unchanged when the search fails or names nothing', async () => {
    stubNetwork(() => json({}, 400));
    const { nameFromRecords } = await load();
    await expect(nameFromRecords(rows)).resolves.toBe(rows);
    stubNetwork(() => ({
      count: 2,
      results: [
        { key: 9, speciesKey: 1 },
        { key: 10, species: 'No key' },
      ],
    }));
    await expect(nameFromRecords(rows)).resolves.toBe(rows);
  });
});

describe('commonNames', () => {
  it('picks each English name, leaving out failures and species without one', async () => {
    stubNetwork((url) => {
      if (url.pathname === '/v1/species/1/vernacularNames')
        return { results: [{ vernacularName: 'robin', language: 'eng' }] };
      if (url.pathname === '/v1/species/2/vernacularNames')
        return { results: [{ vernacularName: 'moineau', language: 'fra' }] };
      return json({}, 400);
    });
    const { commonNames } = await load();
    expect([...(await commonNames([1, 2, 3]))]).toEqual([[1, 'Robin']]);
  });

  it('skips the remaining lookups once superseded', async () => {
    const calls = stubNetwork(() => ({ results: [] }));
    const { commonNames } = await load();
    expect((await commonNames([1, 2], AbortSignal.abort())).size).toBe(0);
    expect(calls).toHaveLength(0);
  });
});

describe('photosForKeys', () => {
  afterEach(() => vi.doUnmock('~/lib/photos/taxon-photos'));

  it('asks for each species’ lead photo, passing the signal on', async () => {
    const leadPhotos = vi.fn(async () => ({ images: new Map(), names: new Map() }));
    vi.resetModules();
    vi.doMock('~/lib/photos/taxon-photos', () => ({ leadPhotos }));
    const { photosForKeys } = await import('~/lib/species/groups');
    const { signal } = new AbortController();
    await photosForKeys([1, 2], signal);
    await photosForKeys([3]);
    expect(leadPhotos.mock.calls).toEqual([
      [
        [
          { key: 1, rank: 'SPECIES' },
          { key: 2, rank: 'SPECIES' },
        ],
        { signal },
      ],
      [[{ key: 3, rank: 'SPECIES' }], {}],
    ]);
  });
});
