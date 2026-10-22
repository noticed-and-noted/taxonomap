// @vitest-environment jsdom
/** The shared species search: index first, then live GBIF, merged and de-duplicated. */
import { effectScope } from 'vue';
import type { NameRow } from '~/lib/data/types';
import { json, snapshots, stubNetwork } from './helpers/network';

const NAMES: NameRow[] = [
  [2492462, 'S', 'Erithacus rubecula', 'European robin', 20],
  [9510564, 'S', 'Turdus migratorius', 'American robin', 10],
];

function gbif(options: { suggestFails?: boolean } = {}) {
  return stubNetwork((url) => {
    if (url.pathname === '/v1/species/suggest') {
      if (options.suggestFails) return json({}, 400);
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

async function setup(options: Parameters<typeof import('~/components/vue/useNameSearch').useNameSearch>[0]) {
  vi.resetModules();
  const { useNameSearch } = await import('~/components/vue/useNameSearch');
  const scope = effectScope();
  const search = scope.run(() => useNameSearch(options))!;
  return { ...search, stop: () => scope.stop() };
}

// Fake timers: tests step past the 250 ms debounce instead of waiting for it.
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useNameSearch', () => {
  it('answers from the index, then adds a few live matches without duplicates', async () => {
    const calls = gbif();
    const search = await setup({ max: 8 });
    search.search('robin');
    await vi.waitFor(() => expect(search.hits.value.map((hit) => hit.key)).toEqual([2492462, 9510564]));
    await vi.advanceTimersByTimeAsync(250);
    // Index hits first; with index answers, only three live hits are kept (one a duplicate).
    await vi.waitFor(() => expect(search.hits.value.map((hit) => hit.key)).toEqual([2492462, 9510564, 1, 2]));
    expect(search.loading.value).toBe(false);
    // Fewer than three index hits, so vernacular search was asked too (and its failure tolerated).
    expect(calls.some((url) => url.pathname === '/v1/species/search')).toBe(true);
    expect(search.failed.value).toBe(false);
    search.stop();
  });

  it('leaves out excluded keys and stops at the maximum', async () => {
    gbif();
    const search = await setup({ max: 2, exclude: () => [2492462] });
    search.search('robin');
    await vi.advanceTimersByTimeAsync(250);
    await vi.waitFor(() => expect(search.hits.value.map((hit) => hit.key)).toEqual([9510564, 1]));
    search.stop();
  });

  it('flags a failure only when every live provider fails', async () => {
    gbif({ suggestFails: true });
    const search = await setup({ max: 8 });
    search.search('zzzz');
    await vi.advanceTimersByTimeAsync(250);
    await vi.waitFor(() => expect(search.failed.value).toBe(true));
    expect(search.hits.value).toEqual([]);
    search.stop();
  });

  it('ranks live hits by how well their names match, keeping GBIF order for ties', async () => {
    const gull = (key: number, scientificName: string, vernacularName: string) => ({
      key,
      scientificName,
      rank: 'SPECIES',
      vernacularNames: [{ vernacularName, language: 'eng' }],
    });
    stubNetwork((url) => {
      if (url.pathname === '/v1/species/suggest') return [];
      if (url.pathname === '/v1/species/search') {
        return {
          results: [
            gull(1, 'Larus icthyaetus', 'great black-headed gull'),
            gull(2, 'Chroicocephalus ridibundus', 'Black-headed Gull'),
            gull(3, 'Ichthyaetus ichthyaetus', 'Great Black-headed Gull'),
            gull(4, 'Leucophaeus atricilla', 'Black-headed Gull'),
          ],
        };
      }
      return snapshots({ names: NAMES })(url);
    });
    const search = await setup({ max: 8 });
    search.search('black headed gull');
    await vi.advanceTimersByTimeAsync(250);
    await vi.waitFor(() => expect(search.hits.value.map((hit) => hit.key)).toEqual([2, 4, 1, 3]));
    search.stop();
  });

  it('ranks live hits by the English alias GBIF matched, below a main-name match', async () => {
    const taxon = (key: number, scientificName: string, names: string[]) => ({
      key,
      scientificName,
      rank: 'SPECIES',
      vernacularNames: names.map((vernacularName) => ({ vernacularName, language: 'eng' })),
    });
    stubNetwork((url) => {
      if (url.pathname === '/v1/species/suggest') return [];
      if (url.pathname === '/v1/species/search') {
        return {
          results: [
            taxon(1, 'Ceratophyllus columbae', ['Pigeon Flea', 'Pigeon Flea', 'Feral Pigeon Nest Flea']),
            taxon(2, 'Columba livia', ['Rock Dove', 'Rock Dove', 'Feral Pigeon']),
            taxon(3, 'Columba livia domestica', ['Feral Pigeon']),
          ],
        };
      }
      return snapshots({ names: NAMES })(url);
    });
    const search = await setup({ max: 8 });
    search.search('feral pigeon');
    await vi.advanceTimersByTimeAsync(250);
    await vi.waitFor(() => expect(search.hits.value.map((hit) => hit.key)).toEqual([3, 2, 1]));
    expect(search.hits.value.map((hit) => hit.matchedName)).toEqual([
      undefined,
      'Feral Pigeon',
      'Feral Pigeon Nest Flea',
    ]);
    search.stop();
  });

  it('asks GBIF nothing for short queries, and clears on reset', async () => {
    const calls = gbif();
    const search = await setup({ max: 8 });
    search.search('ro');
    await vi.waitFor(() => expect(search.hits.value).toHaveLength(2));
    await vi.advanceTimersByTimeAsync(300);
    expect(calls.some((url) => url.pathname.startsWith('/v1/'))).toBe(false);
    search.search('r');
    expect(search.hits.value).toEqual([]);
    search.stop();
  });
});

describe('sortByRank', () => {
  it('puts broader ranks first and keeps order within a rank', async () => {
    const { sortByRank } = await import('~/lib/gbif');
    const hit = (key: number, rank: string) => ({ key, scientificName: `n${key}`, rank, source: 'index' as const });
    const sorted = sortByRank([
      hit(1, 'SPECIES'),
      hit(2, 'GENUS'),
      hit(3, 'UNRANKED'),
      hit(4, 'SPECIES'),
      hit(5, 'FAMILY'),
    ]);
    expect(sorted.map((entry) => entry.key)).toEqual([5, 2, 1, 4, 3]);
  });
});
