// @vitest-environment jsdom
/** The shared species search: index first, then live GBIF, merged and de-duplicated. */
import { effectScope } from 'vue';
import type { NameRow } from '~/lib/data/types';
import { json, snapshots, stubNetwork } from './helpers/network';

const NAMES: NameRow[] = [
  [2492462, 'S', 'Erithacus rubecula', 'European robin', 20],
  [9510564, 'S', 'Turdus migratorius', 'American robin', 10],
];

function gbif(opts: { suggestFails?: boolean } = {}) {
  return stubNetwork((url) => {
    if (url.pathname === '/v1/species/suggest') {
      if (opts.suggestFails) return json({}, 400);
      return [
        { key: 2492462, scientificName: 'Erithacus rubecula', rank: 'SPECIES' },
        { key: 1, scientificName: 'Robinia', rank: 'GENUS' },
        { key: 2, scientificName: 'Robinsonia', rank: 'GENUS' },
        { key: 3, scientificName: 'Robsonius', rank: 'GENUS' },
        { key: 4, scientificName: 'Robertus', rank: 'GENUS' },
      ];
    }
    if (url.pathname === '/v1/species/search') return json({}, 400);
    return snapshots({ names: NAMES })(url);
  });
}

async function setup(opts: Parameters<typeof import('~/components/vue/useNameSearch').useNameSearch>[0]) {
  vi.resetModules();
  const { useNameSearch } = await import('~/components/vue/useNameSearch');
  const scope = effectScope();
  const s = scope.run(() => useNameSearch(opts))!;
  return { ...s, stop: () => scope.stop() };
}

afterEach(() => vi.unstubAllGlobals());

describe('useNameSearch', () => {
  it('answers from the index, then adds a few live matches without duplicates', async () => {
    const calls = gbif();
    const s = await setup({ max: 8 });
    s.search('robin');
    await vi.waitFor(() => expect(s.hits.value.map((h) => h.key)).toEqual([2492462, 9510564]));
    // Index hits first; with index answers, only three live hits are kept (one a duplicate).
    await vi.waitFor(() => expect(s.hits.value.map((h) => h.key)).toEqual([2492462, 9510564, 1, 2]));
    expect(s.loading.value).toBe(false);
    // Fewer than three index hits, so vernacular search was asked too (and its failure tolerated).
    expect(calls.some((u) => u.pathname === '/v1/species/search')).toBe(true);
    expect(s.failed.value).toBe(false);
    s.stop();
  });

  it('leaves out excluded keys and stops at the maximum', async () => {
    gbif();
    const s = await setup({ max: 2, exclude: () => [2492462] });
    s.search('robin');
    await vi.waitFor(() => expect(s.hits.value.map((h) => h.key)).toEqual([9510564, 1]));
    s.stop();
  });

  it('flags a failure only when every live provider fails', async () => {
    gbif({ suggestFails: true });
    const s = await setup({ max: 8 });
    s.search('zzzz');
    await vi.waitFor(() => expect(s.failed.value).toBe(true));
    expect(s.hits.value).toEqual([]);
    s.stop();
  });

  it('asks GBIF nothing for short queries, and clears on reset', async () => {
    const calls = gbif();
    const s = await setup({ max: 8 });
    s.search('ro');
    await vi.waitFor(() => expect(s.hits.value).toHaveLength(2));
    await new Promise((r) => setTimeout(r, 300));
    expect(calls.some((u) => u.pathname.startsWith('/v1/'))).toBe(false);
    s.search('r');
    expect(s.hits.value).toEqual([]);
    s.stop();
  });
});
