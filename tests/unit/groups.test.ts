/**
 * Species for the cell and Near me tables: naming classes, one facet request
 * for the top species (overall or one class), names from the index, then the
 * facet's own names, and stopping once superseded.
 */
import type { NameRow, TreeNodeRow } from '~/lib/data/types';
import { isGraphql, json, namedFacets, predicateOf, snapshots, stubNetwork } from './helpers/network';

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
  it('names classes from the tree snapshot, then the facet, then a detail lookup', async () => {
    const calls = stubNetwork((url) => {
      if (url.pathname === '/v1/species/131')
        return { key: 131, scientificName: 'Amphibia L.', canonicalName: 'Amphibia' };
      return snapshots({ tree: TREE })(url);
    });
    const { namedClasses } = await load();
    const groups = await namedClasses([
      { name: '212', count: 50, label: 'Aves (facet)' },
      { name: '131', count: 20 },
      { name: '999', count: 1 },
      { name: '358', count: 1, label: 'Reptilia' },
    ]);
    expect(groups).toEqual([
      { key: 212, name: 'Aves', common: 'Birds', records: 50 },
      { key: 131, name: 'Amphibia', records: 20 },
      { key: 999, name: 'Class 999', records: 1 },
      { key: 358, name: 'Reptilia', records: 1 },
    ]);
    expect(calls.filter((url) => url.pathname === '/data/tree.json')).toHaveLength(1);
  });
});

describe('topSpecies', () => {
  it('asks once for the top species, ranks them and names them, index first', async () => {
    const calls = stubNetwork((url) => {
      if (isGraphql(url))
        return namedFacets(34, 'speciesKey', [
          [1, 20, 'Erithacus rubecula rubecula'],
          [2, 9],
          [3, 5, 'Turdus merula'],
        ]);
      return snapshots({ names: NAMES })(url);
    });
    const { topSpecies } = await load();
    const rows = await topSpecies({ taxonKeys: [5], classKey: 212 }, { limit: 10 });
    expect(rows).toEqual([
      { key: 1, records: 20, scientificName: 'Erithacus rubecula', commonName: 'European robin' },
      { key: 2, records: 9, scientificName: 'Passer domesticus' },
      { key: 3, records: 5, scientificName: 'Turdus merula' },
    ]);
    const facetCalls = calls.filter(isGraphql);
    // One request, the group AND'd with the caller's filter.
    expect(facetCalls).toHaveLength(1);
    expect(predicateOf(facetCalls[0]!)).toMatchObject({ classKey: ['212'], taxonKey: ['5'] });
    expect(facetCalls[0]?.searchParams.get('query')).toContain('speciesKey(size: 10)');
  });

  it('uses a facet the caller already has instead of asking', async () => {
    const calls = stubNetwork(snapshots({ names: NAMES }));
    const { topSpecies } = await load();
    const rows = await topSpecies({}, { known: [{ name: '1', count: 20 }] });
    expect(rows.map((row) => row.key)).toEqual([1]);
    expect(calls.some(isGraphql)).toBe(false);
  });

  it('marks rows neither the index nor GBIF could name', async () => {
    stubNetwork((url) => (isGraphql(url) ? namedFacets(1, 'speciesKey', [[77, 1]]) : snapshots({ names: NAMES })(url)));
    const { topSpecies } = await load();
    const rows = await topSpecies({});
    expect(rows).toEqual([{ key: 77, records: 1, scientificName: 'Species 77', unnamed: true }]);
  });

  it('returns nothing (and asks for no names) when there are no species', async () => {
    const calls = stubNetwork((url) => (isGraphql(url) ? namedFacets(0, 'speciesKey', []) : undefined));
    const { topSpecies } = await load();
    await expect(topSpecies({})).resolves.toEqual([]);
    expect(calls.some((url) => url.pathname === '/data/names.json')).toBe(false);
  });

  it('stops once its signal aborts', async () => {
    stubNetwork(() => namedFacets(0, 'speciesKey', []));
    const { topSpecies } = await load();
    const controller = new AbortController();
    controller.abort();
    await expect(topSpecies({}, { signal: controller.signal })).rejects.toThrow();
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
    const controller = new AbortController();
    controller.abort();
    expect((await resolveNames([1, 2], controller.signal)).size).toBe(0);
    expect(calls).toHaveLength(0);
  });
});

describe('without the baked data', () => {
  it('names classes by lookup and treats a missing facet as no species', async () => {
    stubNetwork((url) => {
      if (url.pathname === '/v1/species/212') return { key: 212, scientificName: 'Aves' };
      if (isGraphql(url)) return { data: { occurrenceSearch: { documents: { total: 0 }, facet: {} } } };
      return undefined;
    });
    const { namedClasses, topSpecies } = await load();
    const classes = await namedClasses([{ name: '212', count: 5 }]);
    expect(classes).toEqual([{ key: 212, name: 'Aves', records: 5 }]);
    await expect(topSpecies({ classKey: 212 })).resolves.toEqual([]);
  });
});

describe('commonNames', () => {
  const inatNames = vi.fn<(taxa: { key: number }[], options: object) => Promise<Map<number, string | null>>>();
  const leadPhotos = vi.fn();

  /** groups with iNaturalist's names mocked, so only GBIF's fallback request reaches the network. */
  async function loadWithInat() {
    vi.resetModules();
    vi.doMock('~/lib/photos/taxon-photos', async (original) => ({
      ...(await original<typeof import('~/lib/photos/taxon-photos')>()),
      inatNames,
      leadPhotos,
    }));
    return import('~/lib/species/groups');
  }

  afterEach(() => {
    vi.doUnmock('~/lib/photos/taxon-photos');
    inatNames.mockReset();
    leadPhotos.mockReset();
  });

  it('passes a live signal on to iNaturalist', async () => {
    inatNames.mockResolvedValue(new Map([[1, 'European robin']]));
    const { commonNames } = await loadWithInat();
    const signal = new AbortController().signal;
    await commonNames([1], signal);
    expect(inatNames.mock.calls[0]![1]).toEqual({ signal });
  });

  it('asks for each species’ lead photo, passing the signal and names callback on', async () => {
    leadPhotos.mockResolvedValue({ images: new Map() });
    const { photosForKeys } = await loadWithInat();
    await photosForKeys([1, 2]);
    expect(leadPhotos).toHaveBeenLastCalledWith(
      [
        { key: 1, rank: 'SPECIES' },
        { key: 2, rank: 'SPECIES' },
      ],
      {},
    );
    const signal = new AbortController().signal;
    const onCommonNames = () => {};
    await photosForKeys([1], signal, onCommonNames);
    expect(leadPhotos).toHaveBeenLastCalledWith([{ key: 1, rank: 'SPECIES' }], { signal, onCommonNames });
  });

  it('takes iNaturalist’s names, asking GBIF in one request only for the species it does not name', async () => {
    inatNames.mockResolvedValue(
      new Map([
        [1, 'European robin'],
        [2, null],
        [3, null],
      ]),
    );
    const calls = stubNetwork(() => ({
      data: { k2: { vernacularNames: [{ vernacularName: 'house sparrow', language: 'eng' }] }, k3: null },
    }));
    const { commonNames } = await loadWithInat();
    expect([...(await commonNames([1, 2, 3]))]).toEqual([
      [1, 'European robin'],
      [2, 'House sparrow'],
    ]);
    expect(inatNames.mock.calls[0]![0].map((taxon) => taxon.key)).toEqual([1, 2, 3]);
    expect(calls).toHaveLength(1);
    const query = calls[0]!.searchParams.get('query') ?? '';
    expect([query.includes('k1:'), query.includes('k2:'), query.includes('k3:')]).toEqual([false, true, true]);
  });

  it('asks GBIF nothing when iNaturalist names every species', async () => {
    inatNames.mockResolvedValue(new Map([[1, 'European robin']]));
    const calls = stubNetwork(() => ({ data: {} }));
    const { commonNames } = await loadWithInat();
    expect([...(await commonNames([1]))]).toEqual([[1, 'European robin']]);
    expect(calls).toHaveLength(0);
  });

  it('falls back to GBIF’s names when iNaturalist fails', async () => {
    inatNames.mockRejectedValue(new Error('down'));
    stubNetwork(() => ({ data: { k1: { vernacularNames: [{ vernacularName: 'robin', language: 'eng' }] } } }));
    const { commonNames } = await loadWithInat();
    expect([...(await commonNames([1]))]).toEqual([[1, 'Robin']]);
  });

  it('skips the remaining lookups once superseded', async () => {
    const calls = stubNetwork(() => ({ results: [] }));
    const { commonNames } = await loadWithInat();
    expect((await commonNames([1, 2], AbortSignal.abort())).size).toBe(0);
    expect(inatNames).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });
});

describe('gbifCommonNames', () => {
  it('picks each English name from one request, leaving out unknown species and those without one', async () => {
    const calls = stubNetwork(() => ({
      data: {
        k1: { vernacularNames: [{ vernacularName: 'robin', language: 'eng' }] },
        k2: { vernacularNames: [{ vernacularName: 'moineau', language: 'fra' }] },
        k3: null,
      },
    }));
    const { gbifCommonNames } = await load();
    expect([...(await gbifCommonNames([1, 2, 3]))]).toEqual([[1, 'Robin']]);
    expect(calls).toHaveLength(1);
  });

  it('asks nothing for no keys, or once superseded', async () => {
    const calls = stubNetwork(() => ({ data: {} }));
    const { gbifCommonNames } = await load();
    expect((await gbifCommonNames([])).size).toBe(0);
    expect((await gbifCommonNames([1], AbortSignal.abort())).size).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it('names none when the request fails', async () => {
    stubNetwork(() => json({}, 400));
    const { gbifCommonNames } = await load();
    expect((await gbifCommonNames([1, 2])).size).toBe(0);
  });
});
