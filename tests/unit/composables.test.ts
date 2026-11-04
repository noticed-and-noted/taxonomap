// @vitest-environment jsdom
/** The panel data composables, run in a Vue effect scope against a fake GBIF. */
import { effectScope, nextTick } from 'vue';
import type { TreeNodeRow } from '~/lib/data/types';
import { facets, isGraphql, namedFacets, predicateOf, snapshots, stubNetwork } from './helpers/network';

const TREE: TreeNodeRow[] = [{ k: 212, n: 'Aves', c: 'Birds', r: 'C', o: 1, s: 1 }];
const YEARS = {
  v: 1,
  generated: '',
  total: 3,
  years: [
    [2000, 1],
    [2001, 2],
  ],
};
const CELL = { ring: [] as [number, number][], wkt: 'POLYGON((0 0,1 0,1 1,0 0))', tileTotal: 9 };

async function load() {
  vi.resetModules();
  return {
    cubes: await import('~/stores/cubes'),
    explorer: await import('~/stores/explorer'),
    hex: await import('~/composables/useHexSummary'),
    years: await import('~/composables/useYearHistogram'),
  };
}

function run<T>(callback: () => T) {
  const scope = effectScope();
  const result = scope.run(callback) as T;
  return { result, stop: () => scope.stop() };
}

afterEach(() => vi.unstubAllGlobals());

describe('useHexSummary', () => {
  it('loads the selected cell: count, months, groups and species', async () => {
    const calls = stubNetwork((url) => {
      if (!isGraphql(url)) return snapshots({ tree: TREE, names: [] })(url);
      if (predicateOf(url)['classKey']) return namedFacets(4, 'speciesKey', [[2, 4, 'Pica pica']]);
      return {
        data: {
          occurrenceSearch: {
            documents: { total: 40 },
            facet: {
              classKey: [{ key: '212', count: 40, taxon: { scientificName: 'Aves' } }],
              month: [{ key: 3, count: 7 }],
              speciesKey: [{ key: '1', count: 4, taxon: { scientificName: 'Turdus merula' } }],
            },
          },
        },
      };
    });
    const { explorer, hex } = await load();
    const { result: summary, stop } = run(() => hex.useHexSummary());
    expect(summary.count.value).toBeNull();
    explorer.$hexGeometry.set(CELL);
    await vi.waitFor(() => expect(summary.species.value).toHaveLength(1));
    expect(summary.species.value[0]).toMatchObject({ key: 1, scientificName: 'Turdus merula' });
    expect(summary.count.value).toBe(40);
    expect(summary.months.value[2]).toBe(7);
    expect(summary.classes.value).toEqual([{ key: 212, name: 'Aves', common: 'Birds', records: 40 }]);
    expect(summary.loading.value).toBe(false);
    // Totals, groups, months and named species in one request, limited to the cell.
    const facetCalls = calls.filter(isGraphql);
    expect(facetCalls).toHaveLength(1);
    expect(facetCalls[0]!.searchParams.get('variables')).toContain(JSON.stringify(CELL.wkt));
    expect(facetCalls[0]!.searchParams.get('query')).toMatch(
      /classKey\(size: 50\).*month\(size: 50\).*speciesKey\(size: 200\)/,
    );

    // Picking a group asks once for its species; going back to all uses the loaded list.
    await summary.pickGroup(212);
    expect(summary.group.value).toBe(212);
    expect(summary.species.value.map((row) => row.key)).toEqual([2]);
    expect(summary.cellSpecies.value.map((row) => row.key)).toEqual([1]);
    await summary.pickGroup(null);
    expect(summary.species.value.map((row) => row.key)).toEqual([1]);
    await summary.pickGroup(212);
    const groupCalls = calls.filter((url) => isGraphql(url) && predicateOf(url)['classKey']?.[0] === '212');
    expect(groupCalls).toHaveLength(1);
    expect(groupCalls[0]!.searchParams.get('variables')).toContain(JSON.stringify(CELL.wkt));
    stop();
  });

  it('reports a failure as a UI error kind', async () => {
    stubNetwork(() => new Response('bad', { status: 400 }));
    const { explorer, hex } = await load();
    const { result: summary, stop } = run(() => hex.useHexSummary());
    explorer.$hexGeometry.set(CELL);
    await vi.waitFor(() => expect(summary.error.value).toBe('bad-request'));
    expect(summary.loading.value).toBe(false);
    stop();
  });

  describe('with the cube setting on', () => {
    const CUBE_CELL = { ...CELL, cell: '841f1d5ffffffff' };
    const cubeRow = (className: string, specieskey: number, species: string, records: number) => ({
      cell: BigInt(`0x${CUBE_CELL.cell}`),
      kingdom: 'Animalia',
      phylum: null,
      class: className,
      order: null,
      family: null,
      genus: null,
      species,
      specieskey,
      year: 2020,
      month: 3,
      records: BigInt(records),
    });

    async function withCubes(cellRows: () => Promise<unknown[]>) {
      const calls = stubNetwork((url) =>
        isGraphql(url) ? namedFacets(5, 'classKey', []) : snapshots({ tree: TREE, names: [] })(url),
      );
      const loaded = await load();
      const cubeSet = {
        snapshot: '2026-11-01',
        scale: 1,
        mapRows: vi.fn(),
        cellRows: vi.fn(cellRows),
        recordRows: vi.fn(),
      };
      loaded.cubes.$openCubes.set(cubeSet as never);
      loaded.cubes.$cubesOn.set(true);
      return { calls, ...loaded };
    }

    it('answers a cube hex from its rows, groups included, with no GBIF search', async () => {
      const rows = [cubeRow('Aves', 1, 'Turdus merula', 4), cubeRow('Insecta', 2, 'Apis mellifera', 6)];
      const { calls, explorer, hex } = await withCubes(async () => rows);
      const { result: summary, stop } = run(() => hex.useHexSummary());
      explorer.$hexGeometry.set(CUBE_CELL);
      await vi.waitFor(() => expect(summary.species.value).toHaveLength(2));
      expect(summary.count.value).toBe(10);
      expect(summary.months.value[2]).toBe(10);
      expect(summary.classes.value.map((group) => group.name)).toEqual(['Insecta', 'Aves']);
      await summary.pickGroup(212);
      expect(summary.species.value.map((row) => row.key)).toEqual([1]);
      expect(calls.filter(isGraphql)).toHaveLength(0);
      stop();
    });

    it('falls back to GBIF when the cubes can’t be read', async () => {
      const { calls, explorer, hex } = await withCubes(() => Promise.reject(new Error('gone')));
      const { result: summary, stop } = run(() => hex.useHexSummary());
      explorer.$hexGeometry.set(CUBE_CELL);
      await vi.waitFor(() => expect(summary.count.value).toBe(5));
      expect(calls.filter(isGraphql)).toHaveLength(1);
      stop();
    });
  });

  it('clears when the cell is deselected', async () => {
    stubNetwork((url) => (isGraphql(url) ? namedFacets(5, 'classKey', []) : snapshots({ tree: TREE })(url)));
    const { explorer, hex } = await load();
    const { result: summary, stop } = run(() => hex.useHexSummary());
    explorer.$hexGeometry.set(CELL);
    await vi.waitFor(() => expect(summary.count.value).toBe(5));
    explorer.$hexGeometry.set(null);
    await nextTick();
    expect(summary.count.value).toBeNull();
    stop();
  });
});

describe('useYearHistogram', () => {
  it('uses the baked years with no filters, then one live facet with them', async () => {
    const calls = stubNetwork((url) => {
      if (url.pathname === '/data/years.json') return YEARS;
      return facets(9, 'YEAR', [[1990, 9]]);
    });
    const { explorer, years } = await load();
    const { result: histogram, stop } = run(() => years.useYearHistogram());
    await vi.waitFor(() => expect(histogram.loading.value).toBe(false));
    expect([...histogram.counts.value]).toEqual([
      [2000, 1],
      [2001, 2],
    ]);
    expect(histogram.live.value).toBe(false);

    explorer.$hasPhoto.set(true);
    await vi.waitFor(() => expect(histogram.live.value).toBe(true));
    expect([...histogram.counts.value]).toEqual([[1990, 9]]);
    const live = calls.find((url) => url.pathname === '/v1/occurrence/search')!;
    expect(live.searchParams.get('mediaType')).toBe('StillImage');

    // The date filter itself never changes the histogram.
    const before = calls.length;
    explorer.$dateRange.set({ unit: 'y', from: '1990-01-01', to: '2000-12-31' });
    await nextTick();
    explorer.$dateRange.set({ preset: '1m' });
    await nextTick();
    expect(calls).toHaveLength(before);
    stop();
  });
});

describe('useLatestLoad', () => {
  it('lets only the latest run publish, aborting the one before', async () => {
    const { useLatestLoad } = await import('~/composables/useLatestLoad');
    const { result: latest, stop } = run(() => useLatestLoad());
    const signals: AbortSignal[] = [];
    let release!: () => void;
    const first = latest.run(async (signal) => {
      signals.push(signal);
      await new Promise<void>((resolve) => (release = resolve));
      throw new Error('superseded runs never report errors');
    });
    const second = latest.run(async (signal) => void signals.push(signal));
    await second;
    expect(signals.map((signal) => signal.aborted)).toEqual([true, false]);
    expect(latest.loading.value).toBe(false);
    release();
    await first;
    expect(latest.error.value).toBeNull();
    stop();
  });

  it('reports the latest run’s failure', async () => {
    const { useLatestLoad } = await import('~/composables/useLatestLoad');
    const { result: latest, stop } = run(() => useLatestLoad());
    await latest.run(async () => {
      throw new Error('boom');
    });
    expect(latest.error.value).toBe('unknown');
    stop();
  });
});
