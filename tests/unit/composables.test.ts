// @vitest-environment jsdom
/** The panel data composables, run in a Vue effect scope against a fake GBIF. */
import { effectScope, nextTick } from 'vue';
import type { TreeNodeRow } from '~/lib/data/types';
import { facets, snapshots, stubNetwork } from './helpers/network';

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
    explorer: await import('~/stores/explorer'),
    hex: await import('~/components/vue/useHexSummary'),
    years: await import('~/components/vue/useYearHistogram'),
  };
}

function run<T>(fn: () => T) {
  const scope = effectScope();
  const result = scope.run(fn) as T;
  return { result, stop: () => scope.stop() };
}

afterEach(() => vi.unstubAllGlobals());

describe('useHexSummary', () => {
  it('loads the selected cell: count, months, groups and species', async () => {
    const calls = stubNetwork((url) => {
      if (url.pathname !== '/v1/occurrence/search') return snapshots({ tree: TREE, names: [] })(url);
      if (url.searchParams.has('classKey')) return facets(4, 'SPECIES_KEY', [[2, 4]]);
      return {
        count: 40,
        results: [],
        facets: [
          { field: 'CLASS_KEY', counts: [{ name: '212', count: 40 }] },
          { field: 'MONTH', counts: [{ name: '3', count: 7 }] },
          { field: 'SPECIES_KEY', counts: [{ name: '1', count: 4 }] },
        ],
      };
    });
    const { explorer, hex } = await load();
    const { result: s, stop } = run(() => hex.useHexSummary());
    expect(s.count.value).toBeNull();
    explorer.$hexGeometry.set(CELL);
    await vi.waitFor(() => expect(s.species.value).toHaveLength(1));
    expect(s.count.value).toBe(40);
    expect(s.months.value[2]).toBe(7);
    expect(s.classes.value).toEqual([{ key: 212, name: 'Aves', common: 'Birds', records: 40 }]);
    expect(s.loading.value).toBe(false);
    // Every facet request is limited to the cell (the name lookup is not).
    const facetCalls = calls.filter((u) => u.searchParams.has('facet'));
    expect(facetCalls.length).toBeGreaterThan(0);
    expect(facetCalls.every((u) => u.searchParams.get('geometry') === CELL.wkt)).toBe(true);
    // Totals, groups, months and species in one request.
    expect(facetCalls).toHaveLength(1);
    expect(facetCalls[0]!.searchParams.getAll('facet')).toEqual(['classKey', 'month', 'speciesKey']);

    // Picking a group asks once for its species; going back to all uses the loaded list.
    await s.pickGroup(212);
    expect(s.group.value).toBe(212);
    expect(s.species.value.map((r) => r.key)).toEqual([2]);
    expect(s.cellSpecies.value.map((r) => r.key)).toEqual([1]);
    await s.pickGroup(null);
    expect(s.species.value.map((r) => r.key)).toEqual([1]);
    await s.pickGroup(212);
    const groupCalls = calls.filter((u) => u.searchParams.get('classKey') === '212');
    expect(groupCalls).toHaveLength(1);
    expect(groupCalls[0]!.searchParams.get('geometry')).toBe(CELL.wkt);
    stop();
  });

  it('reports a failure as a UI error kind', async () => {
    stubNetwork(() => new Response('bad', { status: 400 }));
    const { explorer, hex } = await load();
    const { result: s, stop } = run(() => hex.useHexSummary());
    explorer.$hexGeometry.set(CELL);
    await vi.waitFor(() => expect(s.error.value).toBe('bad-request'));
    expect(s.loading.value).toBe(false);
    stop();
  });

  it('clears when the cell is deselected', async () => {
    stubNetwork((url) =>
      url.pathname === '/v1/occurrence/search' ? facets(5, 'CLASS_KEY', []) : snapshots({ tree: TREE })(url),
    );
    const { explorer, hex } = await load();
    const { result: s, stop } = run(() => hex.useHexSummary());
    explorer.$hexGeometry.set(CELL);
    await vi.waitFor(() => expect(s.count.value).toBe(5));
    explorer.$hexGeometry.set(null);
    await nextTick();
    expect(s.count.value).toBeNull();
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
    const { result: h, stop } = run(() => years.useYearHistogram());
    await vi.waitFor(() => expect(h.loading.value).toBe(false));
    expect([...h.counts.value]).toEqual([
      [2000, 1],
      [2001, 2],
    ]);
    expect(h.live.value).toBe(false);

    explorer.$hasPhoto.set(true);
    await vi.waitFor(() => expect(h.live.value).toBe(true));
    expect([...h.counts.value]).toEqual([[1990, 9]]);
    const live = calls.find((u) => u.pathname === '/v1/occurrence/search')!;
    expect(live.searchParams.get('mediaType')).toBe('StillImage');

    // The year filter itself never changes the histogram.
    const before = calls.length;
    explorer.$yearRange.set([1990, 2000]);
    await nextTick();
    expect(calls).toHaveLength(before);
    stop();
  });
});

describe('useLatestLoad', () => {
  it('lets only the latest run publish, aborting the one before', async () => {
    const { useLatestLoad } = await import('~/components/vue/useLatestLoad');
    const { result: l, stop } = run(() => useLatestLoad());
    const signals: AbortSignal[] = [];
    let release!: () => void;
    const first = l.run(async (signal) => {
      signals.push(signal);
      await new Promise<void>((r) => (release = r));
      throw new Error('superseded runs never report errors');
    });
    const second = l.run(async (signal) => void signals.push(signal));
    await second;
    expect(signals.map((s) => s.aborted)).toEqual([true, false]);
    expect(l.loading.value).toBe(false);
    release();
    await first;
    expect(l.error.value).toBeNull();
    stop();
  });

  it('reports the latest run’s failure', async () => {
    const { useLatestLoad } = await import('~/components/vue/useLatestLoad');
    const { result: l, stop } = run(() => useLatestLoad());
    await l.run(async () => {
      throw new Error('boom');
    });
    expect(l.error.value).toBe('unknown');
    stop();
  });
});
