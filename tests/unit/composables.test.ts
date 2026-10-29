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
    const { result: summary, stop } = run(() => hex.useHexSummary());
    expect(summary.count.value).toBeNull();
    explorer.$hexGeometry.set(CELL);
    await vi.waitFor(() => expect(summary.species.value).toHaveLength(1));
    expect(summary.count.value).toBe(40);
    expect(summary.months.value[2]).toBe(7);
    expect(summary.classes.value).toEqual([{ key: 212, name: 'Aves', common: 'Birds', records: 40 }]);
    expect(summary.loading.value).toBe(false);
    // Every facet request is limited to the cell (the name lookup is not).
    const facetCalls = calls.filter((url) => url.searchParams.has('facet'));
    expect(facetCalls.length).toBeGreaterThan(0);
    expect(facetCalls.every((url) => url.searchParams.get('geometry') === CELL.wkt)).toBe(true);
    // Totals, groups, months and species in one request.
    expect(facetCalls).toHaveLength(1);
    expect(facetCalls[0]!.searchParams.getAll('facet')).toEqual(['classKey', 'month', 'speciesKey']);

    // Picking a group asks once for its species; going back to all uses the loaded list.
    await summary.pickGroup(212);
    expect(summary.group.value).toBe(212);
    expect(summary.species.value.map((row) => row.key)).toEqual([2]);
    expect(summary.cellSpecies.value.map((row) => row.key)).toEqual([1]);
    await summary.pickGroup(null);
    expect(summary.species.value.map((row) => row.key)).toEqual([1]);
    await summary.pickGroup(212);
    const groupCalls = calls.filter((url) => url.searchParams.get('classKey') === '212');
    expect(groupCalls).toHaveLength(1);
    expect(groupCalls[0]!.searchParams.get('geometry')).toBe(CELL.wkt);
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

  it('clears when the cell is deselected', async () => {
    stubNetwork((url) =>
      url.pathname === '/v1/occurrence/search' ? facets(5, 'CLASS_KEY', []) : snapshots({ tree: TREE })(url),
    );
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
