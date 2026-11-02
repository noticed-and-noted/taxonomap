// @vitest-environment jsdom
/** The shared species search: index first, then live GBIF, merged and de-duplicated. */
import { effectScope } from 'vue';
import type { NameRow } from '~/lib/data/types';
import { SEARCH_DEBOUNCE_MS } from '~/lib/util/debounce';
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

async function setup(options: Parameters<typeof import('~/composables/useNameSearch').useNameSearch>[0]) {
  vi.resetModules();
  const { useNameSearch } = await import('~/composables/useNameSearch');
  const scope = effectScope();
  const search = scope.run(() => useNameSearch(options))!;
  return { ...search, stop: () => scope.stop() };
}

// Fake timers: tests step past the debounce instead of waiting for it.
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
    // Nothing changes before typing pauses, the index's hits included.
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS - 1);
    expect(search.hits.value).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    // Index hits first; with index answers, only three live hits are kept (one a duplicate).
    await vi.waitFor(() => expect(search.hits.value.map((hit) => hit.key)).toEqual([2492462, 9510564, 1, 2]));
    expect(search.loading.value).toBe(false);
    // Fewer than five index hits, so vernacular search was asked too (and its failure tolerated).
    expect(calls.some((url) => url.pathname === '/v1/species/search')).toBe(true);
    expect(search.failed.value).toBe(false);
    search.stop();
  });

  it('orders each wave on its own, so late live hits never move the index hits', async () => {
    gbif();
    const { sortByRank } = await import('~/lib/gbif');
    const search = await setup({ max: 8, order: sortByRank });
    search.search('robin');
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    // The live genera sort before species by rank, but stay below the index's species.
    await vi.waitFor(() => expect(search.hits.value.map((hit) => hit.key)).toEqual([2492462, 9510564, 1, 2]));
    search.stop();
  });

  it('leaves out excluded keys and stops at the maximum', async () => {
    gbif();
    const search = await setup({ max: 2, exclude: () => [2492462] });
    search.search('robin');
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    await vi.waitFor(() => expect(search.hits.value.map((hit) => hit.key)).toEqual([9510564, 1]));
    search.stop();
  });

  it('flags a failure only when every live provider fails', async () => {
    gbif({ suggestFails: true });
    const search = await setup({ max: 8 });
    search.search('zzzz');
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
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
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
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
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
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
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
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

describe('useNameSearch without baked names', () => {
  it("names live hits as iNaturalist does, keeping GBIF's name searchable", async () => {
    stubNetwork((url) => {
      if (url.pathname === '/v1/species/suggest') return [];
      if (url.pathname === '/v1/species/search') {
        return {
          results: [
            { key: 6, scientificName: 'Coprinus', rank: 'GENUS' },
            {
              key: 7,
              scientificName: 'Coprinus plicatilis',
              rank: 'SPECIES',
              vernacularNames: [],
            },
            {
              key: 5,
              scientificName: 'Coprinus comatus',
              rank: 'SPECIES',
              vernacularNames: [
                { vernacularName: "Lawyer's Wig", language: 'eng' },
                { vernacularName: 'Shaggy Inkcap', language: 'eng' },
              ],
            },
          ],
        };
      }
      return snapshots({ names: [] })(url);
    });
    vi.resetModules();
    const asked: number[][] = [];
    vi.doMock('~/lib/photos/taxon-photos', () => ({
      inatNames: async (taxa: { key: number }[]) => {
        asked.push(taxa.map((taxon) => taxon.key));
        return new Map([[5, 'Shaggy Inkcap']]);
      },
    }));
    const { useNameSearch } = await import('~/composables/useNameSearch');
    const scope = effectScope();
    const search = scope.run(() => useNameSearch({ max: 8 }))!;
    search.search('shaggy inkcap');
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    await vi.waitFor(() => expect(search.hits.value).toHaveLength(3));
    const species = search.hits.value.find((hit) => hit.key === 5);
    expect(species).toMatchObject({ commonName: 'Shaggy Inkcap' });
    expect(species?.matchedName).toBeUndefined();
    // Only a species GBIF already names is looked up: the genus and the unnamed species are left as they are.
    expect(asked).toEqual([[5]]);
    scope.stop();
    vi.doUnmock('~/lib/photos/taxon-photos');
  });
});

describe('useNameSearch while typing', () => {
  const noLive = (url: URL) => {
    if (url.pathname === '/v1/species/suggest') return [];
    if (url.pathname === '/v1/species/search') return { results: [] };
    return snapshots({ names: [...NAMES, [13, 'S', 'Fratercula arctica', 'Atlantic puffin', 5]] })(url);
  };

  it('settles on what is typed at once, so Enter never picks from the previous text', async () => {
    stubNetwork(noLive);
    const search = await setup({ max: 8 });
    search.search('robin');
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    await vi.waitFor(() => expect(search.answered.value).toBe('robin'));
    search.search('puffin');
    expect(search.hits.value[0]?.key).toBe(2492462);
    expect(search.answered.value).toBe('robin');
    await search.settle();
    expect(search.hits.value.map((hit) => hit.key)).toEqual([13]);
    expect(search.answered.value).toBe('puffin');
    search.stop();
  });

  it('drops a search in flight when the text changes, so its late answer never lands', async () => {
    let release: (value: unknown) => void = () => undefined;
    stubNetwork((url) => {
      if (url.pathname === '/v1/species/suggest' && url.searchParams.get('q') === 'robin') {
        return new Promise((resolve) => (release = resolve));
      }
      return noLive(url);
    });
    const search = await setup({ max: 8 });
    search.search('robin');
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    search.search('puffin');
    release([{ key: 1, scientificName: 'Robinia', rank: 'GENUS' }]);
    await vi.advanceTimersByTimeAsync(10);
    expect(search.hits.value.map((hit) => hit.key)).not.toContain(1);
    expect(search.loading.value).toBe(true);
    search.stop();
  });
});

describe('useNameSearch naming live hits', () => {
  const named = (key: number, name: string) => ({
    key,
    scientificName: `Species ${key}`,
    rank: 'SPECIES',
    vernacularNames: [{ vernacularName: name, language: 'eng' }],
  });

  async function withInat(names: NameRow[], results: object[], lookup: () => Promise<Map<number, string>>) {
    stubNetwork((url) => {
      if (url.pathname === '/v1/species/suggest') return [];
      if (url.pathname === '/v1/species/search') return { results };
      return snapshots({ names })(url);
    });
    const asked: number[][] = [];
    vi.resetModules();
    vi.doMock('~/lib/photos/taxon-photos', () => ({
      inatNames: (taxa: { key: number }[]) => {
        asked.push(taxa.map((taxon) => taxon.key));
        return lookup();
      },
    }));
    const { useNameSearch } = await import('~/composables/useNameSearch');
    const scope = effectScope();
    const search = scope.run(() => useNameSearch({ max: 20 }))!;
    return { search, asked, stop: () => scope.stop() };
  }

  afterEach(() => vi.doUnmock('~/lib/photos/taxon-photos'));

  it('shows the hits first, holding the place of the names it is looking up', async () => {
    let answer: (names: Map<number, string>) => void = () => undefined;
    const { search, stop } = await withInat(
      [],
      [named(1, 'Robin one'), named(2, 'Robin two')],
      () => new Promise((resolve) => (answer = resolve)),
    );
    search.search('robin');
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    await vi.waitFor(() => expect(search.hits.value.map((hit) => hit.isNamePending)).toEqual([true, true]));
    expect(search.loading.value).toBe(false);
    answer(new Map([[2, 'Better robin']]));
    await vi.waitFor(() => expect(search.hits.value[1]?.commonName).toBe('Better robin'));
    expect(search.hits.value.map((hit) => hit.key)).toEqual([1, 2]);
    // iNaturalist has no name for the first, so it keeps GBIF's.
    expect(search.hits.value[0]?.commonName).toBe('Robin one');
    expect(search.hits.value.some((hit) => hit.isNamePending)).toBe(false);
    stop();
  });

  it('looks names up only for the live hits that can reach the list', async () => {
    const results = [1, 2, 3, 4, 5, 6].map((key) => named(key, `Robin ${key}`));
    const { search, asked, stop } = await withInat(
      [[9, 'S', 'Indexed species', 'Indexed robin', 5]],
      results,
      async () => new Map(),
    );
    search.search('robin');
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    await vi.waitFor(() => expect(asked).toHaveLength(1));
    expect(asked[0]).toHaveLength(3);
    stop();
  });
});
