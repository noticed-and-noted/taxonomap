// @vitest-environment jsdom
/** Name search over a cell's species: listed species match by key, others are checked in the cell. */
import { effectScope, ref } from 'vue';
import type { NameRow } from '~/lib/data/types';
import type { SpeciesRow } from '~/lib/species/groups';
import { facets, nums, snapshots, stubNetwork } from './helpers/network';

const LISTED_KEY = 2481139;
const IN_CELL_KEY = 2481745;
const ELSEWHERE_KEY = 2481800;

const NAMES: NameRow[] = [
  [LISTED_KEY, 'S', 'Calidris alba', 'Sanderling sandpiper', 30],
  [IN_CELL_KEY, 'S', 'Calidris minutilla', 'Least sandpiper', 20],
  [ELSEWHERE_KEY, 'S', 'Calidris pusilla', 'Semipalmated sandpiper', 10],
];

const LISTED: SpeciesRow[] = [{ key: LISTED_KEY, scientificName: 'Calidris alba', records: 99 }];

function gbif() {
  return stubNetwork((url) => {
    if (url.pathname === '/v1/occurrence/search') return facets(7, 'SPECIES_KEY', [[IN_CELL_KEY, 7]]);
    if (url.pathname.startsWith('/v1/species/')) return [];
    return snapshots({ names: NAMES })(url);
  });
}

async function setup(withArea: boolean) {
  vi.resetModules();
  const { useCellNameSearch } = await import('~/components/vue/useCellNameSearch');
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
    await vi.advanceTimersByTimeAsync(250);
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

  it('without an area, matches listed species only', async () => {
    const calls = gbif();
    const { query, search, stop } = await setup(false);
    query.value = 'sandpiper';
    await vi.advanceTimersByTimeAsync(250);
    await vi.waitFor(() => expect([...search.matchedKeys.value]).toEqual([LISTED_KEY]));
    expect(search.outside.value).toEqual([]);
    expect(calls.some((url) => url.pathname === '/v1/occurrence/search')).toBe(false);
    stop();
  });
});
