// @vitest-environment jsdom
/** Name search over a cell's species: listed species match by key, others are checked in the cell. */
import { effectScope, nextTick, ref } from 'vue';
import type { NameRow } from '~/lib/data/types';
import type { SpeciesRow } from '~/lib/species/groups';
import { SEARCH_DEBOUNCE_MS } from '~/lib/util/debounce';
import { facets, nums, snapshots, stubNetwork } from './helpers/network';

const LISTED_KEY = 2481139;
const IN_CELL_KEY = 2481745;
const ELSEWHERE_KEY = 2481800;
// Matches "sa" but not "san", so each keystroke asks about a different set of species.
const GULL_KEY = 2481801;
// No common name anywhere.
const UNNAMED_KEY = 2481802;

const NAMES: NameRow[] = [
  [LISTED_KEY, 'S', 'Calidris alba', 'Sanderling sandpiper', 30],
  [IN_CELL_KEY, 'S', 'Calidris minutilla', 'Least sandpiper', 20],
  [ELSEWHERE_KEY, 'S', 'Calidris pusilla', 'Semipalmated sandpiper', 10],
  [GULL_KEY, 'S', 'Xema sabini', "Sabine's gull", 5],
  [UNNAMED_KEY, 'S', 'Calidris sandi', null, 1],
];

const LISTED: SpeciesRow[] = [{ key: LISTED_KEY, scientificName: 'Calidris alba', records: 99 }];

function gbif() {
  return stubNetwork((url) => {
    if (url.pathname === '/v1/occurrence/search') return facets(7, 'SPECIES_KEY', [[IN_CELL_KEY, 7]]);
    if (url.pathname.startsWith('/v1/species/')) return { results: [] };
    return snapshots({ names: NAMES })(url);
  });
}

async function setup(withArea: boolean) {
  vi.resetModules();
  const { useCellNameSearch } = await import('~/composables/useCellNameSearch');
  const query = ref('');
  const scope = effectScope();
  const search = scope.run(() =>
    useCellNameSearch({ query, species: () => LISTED, ...(withArea && { area: () => ({ geometry: 'POLYGON' }) }) }),
  )!;
  return { query, search, stop: () => scope.stop() };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useCellNameSearch', () => {
  it('matches listed species by key and keeps unlisted ones with records in the cell', async () => {
    const calls = gbif();
    const { query, search, stop } = await setup(true);
    query.value = 'sandpiper';
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    await vi.waitFor(() => expect(search.outside.value.map((row) => row.key)).toEqual([IN_CELL_KEY]));
    expect([...search.matchedKeys.value]).toEqual([LISTED_KEY]);
    expect(search.outside.value[0]).toMatchObject({ commonName: 'Least sandpiper', records: 7 });
    // One facet request checks both unlisted hits; none is made per species.
    const checks = calls.filter((url) => url.pathname === '/v1/occurrence/search');
    expect(checks).toHaveLength(1);
    expect(nums(checks[0]!, 'speciesKey').sort()).toEqual([IN_CELL_KEY, ELSEWHERE_KEY].sort());
    expect(calls.some((url) => url.pathname.endsWith('/vernacularNames'))).toBe(false);
    stop();
  });

  it('checks the cell once typing pauses, not on every keystroke', async () => {
    const calls = gbif();
    const { query, search, stop } = await setup(true);
    // Loaded already, as in the app, the index answers every keystroke.
    const { loadNameIndex } = await import('~/lib/data/name-index');
    await loadNameIndex();
    const typingGapMs = 100;
    for (let length = 2; length <= 'sandpiper'.length; length++) {
      query.value = 'sandpiper'.slice(0, length);
      await vi.advanceTimersByTimeAsync(typingGapMs);
    }
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    await vi.waitFor(() => expect(search.outside.value.map((row) => row.key)).toEqual([IN_CELL_KEY]));
    expect(calls.filter((url) => url.pathname === '/v1/occurrence/search')).toHaveLength(1);
    stop();
  });

  it('without an area, matches listed species only', async () => {
    const calls = gbif();
    const { query, search, stop } = await setup(false);
    query.value = 'sandpiper';
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    await vi.waitFor(() => expect([...search.matchedKeys.value]).toEqual([LISTED_KEY]));
    expect(search.outside.value).toEqual([]);
    expect(calls.some((url) => url.pathname === '/v1/occurrence/search')).toBe(false);
    stop();
  });

  it('matches nothing from the previous text while the debounce holds the new one', async () => {
    gbif();
    const { query, search, stop } = await setup(true);
    query.value = 'sandpiper';
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    await vi.waitFor(() => expect(search.outside.value).toHaveLength(1));
    query.value = 'gull';
    await nextTick();
    expect([...search.matchedKeys.value]).toEqual([]);
    expect(search.outside.value).toEqual([]);
    stop();
  });

  it('keeps a species’ own name when its hit has none, and reports names pending and loading', async () => {
    stubNetwork((url) => {
      if (url.pathname === '/v1/occurrence/search') return facets(1, 'SPECIES_KEY', [[UNNAMED_KEY, 1]]);
      if (url.pathname.startsWith('/v1/species/')) return { results: [] };
      return snapshots({ names: NAMES })(url);
    });
    const { query, search, stop } = await setup(true);
    query.value = 'calidris sandi';
    expect(search.loading.value).toBe(false);
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    await vi.waitFor(() => expect(search.outside.value.map((row) => row.key)).toEqual([UNNAMED_KEY]));
    expect(search.outside.value[0]!.commonName).toBeUndefined();
    expect(search.namePendingKeys.value).toBeInstanceOf(Set);
    await vi.waitFor(() => expect(search.loading.value).toBe(false));
    stop();
  });

  it('finds nothing outside the list when GBIF leaves the facet out', async () => {
    stubNetwork((url) => {
      if (url.pathname === '/v1/occurrence/search') return { count: 0, results: [], facets: [] };
      if (url.pathname.startsWith('/v1/species/')) return { results: [] };
      return snapshots({ names: NAMES })(url);
    });
    const { query, search, stop } = await setup(true);
    query.value = 'sandpiper';
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    await vi.waitFor(() => expect([...search.matchedKeys.value]).toEqual([LISTED_KEY]));
    await vi.waitFor(() => expect(search.loading.value).toBe(false));
    expect(search.outside.value).toEqual([]);
    stop();
  });

  it('stays loading for a newer check when an older one is cancelled', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    stubNetwork(async (url) => {
      if (url.pathname === '/v1/occurrence/search') {
        await gate;
        return facets(7, 'SPECIES_KEY', [[IN_CELL_KEY, 7]]);
      }
      if (url.pathname.startsWith('/v1/species/')) return { results: [] };
      return snapshots({ names: NAMES })(url);
    });
    const { query, search, stop } = await setup(true);
    const { loadNameIndex } = await import('~/lib/data/name-index');
    await loadNameIndex();
    query.value = 'sa';
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    await vi.waitFor(() => expect(search.loading.value).toBe(true));
    query.value = 'san';
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    expect(search.loading.value).toBe(true);
    release();
    await vi.waitFor(() => expect(search.loading.value).toBe(false));
    stop();
  });

  it('checks again when a late provider adds hits, and marks hits whose names are still coming', async () => {
    let releaseSuggest!: () => void;
    const suggestHeld = new Promise<void>((resolve) => (releaseSuggest = resolve));
    let releaseCheck!: () => void;
    const checkHeld = new Promise<void>((resolve) => (releaseCheck = resolve));
    const checks: URL[] = [];
    stubNetwork(async (url) => {
      if (url.pathname === '/v1/occurrence/search') {
        checks.push(url);
        // The first check is still in flight when the late hits arrive.
        if (checks.length === 1) await checkHeld;
        return facets(7, 'SPECIES_KEY', [[IN_CELL_KEY, 7]]);
      }
      if (url.pathname === '/v1/species/search') {
        const knot = { key: 77, scientificName: 'Calidris canutus', rank: 'SPECIES' };
        return { results: [{ ...knot, vernacularNames: [{ vernacularName: 'Red knot', language: 'eng' }] }] };
      }
      if (url.pathname === '/v1/species/suggest') {
        await suggestHeld;
        return [{ key: 78, scientificName: 'Calidris knotti', rank: 'SPECIES' }];
      }
      return snapshots({ names: NAMES })(url);
    });
    vi.doMock('~/lib/photos/taxon-photos', () => ({ inatNames: () => new Promise(() => {}) }));
    const { query, search, stop } = await setup(true);
    query.value = 'knot';
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    await vi.waitFor(() => expect(checks).toHaveLength(1));
    expect([...search.namePendingKeys.value]).toEqual([77]);
    releaseSuggest();
    await vi.waitFor(() => expect(checks).toHaveLength(2));
    releaseCheck();
    await vi.waitFor(() => expect(search.loading.value).toBe(false));
    vi.doUnmock('~/lib/photos/taxon-photos');
    stop();
  });

  it('checks the area as soon as the debounced hits arrive, without a second pause', async () => {
    const calls = gbif();
    const { query, stop } = await setup(true);
    query.value = 'sa';
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS + 50);
    expect(calls.filter((url) => url.pathname === '/v1/occurrence/search')).toHaveLength(1);
    stop();
  });
});
