// @vitest-environment jsdom
/** The cell panel's data when answers arrive out of order: only the latest cell and group ever show. */
import { effectScope, nextTick } from 'vue';
import type { SpeciesRow } from '~/lib/species/groups';

const calls = vi.hoisted(() => ({
  facets: [] as ((value: unknown) => void)[],
  topSpecies: [] as ((value: unknown) => void)[],
}));

const FACETS = { count: 9, facets: { classKey: [], month: [], speciesKey: [] } };
const rowsOf = (key: number): SpeciesRow[] => [{ key, scientificName: `Species ${key}`, records: 1 }];

vi.mock('~/lib/gbif', async (original) => ({
  ...(await original<typeof import('~/lib/gbif')>()),
  namedOccurrenceFacets: () => new Promise((resolve) => calls.facets.push(resolve)),
}));

vi.mock('~/lib/species/groups', () => ({
  namedClasses: async () => [],
  topSpecies: () => new Promise((resolve) => calls.topSpecies.push(resolve)),
}));

vi.mock('~/lib/data/load', () => ({ loadSnapshot: async () => null }));
vi.mock('~/lib/data/name-index', () => ({ loadNameIndex: async () => null }));

const CELL = { ring: [] as [number, number][], wkt: 'POLYGON((0 0,1 0,1 1,0 0))', tileTotal: 9 };
const OTHER_CELL = { ...CELL, wkt: 'POLYGON((5 5,6 5,6 6,5 5))' };

async function setup() {
  vi.resetModules();
  calls.facets = [];
  calls.topSpecies = [];
  const explorer = await import('~/stores/explorer');
  const { useHexSummary } = await import('~/composables/useHexSummary');
  explorer.$hexGeometry.set(null);
  const scope = effectScope();
  const summary = scope.run(() => useHexSummary())!;
  return { explorer, summary, stop: () => scope.stop() };
}

/** Lets pending promise callbacks run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('useHexSummary races', () => {
  it('drops a cell’s counts and lists once another cell is picked', async () => {
    const { explorer, summary, stop } = await setup();
    explorer.$hexGeometry.set(CELL);
    await vi.waitFor(() => expect(calls.facets).toHaveLength(1));
    // A reload supersedes the run before its counts land.
    calls.facets[0]!(FACETS);
    void summary.reload();
    await settle();
    expect(summary.count.value).toBeNull();

    // This time the counts land, and the lists are superseded instead.
    calls.facets[1]!(FACETS);
    await vi.waitFor(() => expect(calls.topSpecies).toHaveLength(1));
    expect(summary.count.value).toBe(9);
    calls.topSpecies[0]!(rowsOf(1));
    explorer.$hexGeometry.set(OTHER_CELL);
    await nextTick();
    await settle();
    expect(summary.species.value).toEqual([]);
    stop();
  });

  it('ignores a group pick with no cell or for the group already shown', async () => {
    const { summary, stop } = await setup();
    await summary.pickGroup(212);
    expect(summary.group.value).toBeNull();
    stop();
  });

  it('keeps a group’s late list without showing it, and drops one a newer pick superseded', async () => {
    const { explorer, summary, stop } = await setup();
    explorer.$hexGeometry.set(CELL);
    await vi.waitFor(() => expect(calls.facets).toHaveLength(1));
    calls.facets[0]!(FACETS);
    await vi.waitFor(() => expect(calls.topSpecies).toHaveLength(1));
    calls.topSpecies[0]!(rowsOf(1));
    await vi.waitFor(() => expect(summary.cellSpecies.value).toEqual(rowsOf(1)));
    await summary.pickGroup(null);

    // Birds are still loading when the viewer goes back to the whole cell.
    const birds = summary.pickGroup(212);
    await summary.pickGroup(null);
    calls.topSpecies[1]!(rowsOf(2));
    await birds;
    expect(summary.species.value).toEqual(rowsOf(1));
    await summary.pickGroup(212);
    expect(summary.species.value).toEqual(rowsOf(2));

    // Mammals are superseded by fish before they answer.
    const mammals = summary.pickGroup(359);
    const fish = summary.pickGroup(204);
    calls.topSpecies[2]!(rowsOf(3));
    calls.topSpecies[3]!(rowsOf(4));
    await Promise.all([mammals, fish]);
    expect(summary.species.value).toEqual(rowsOf(4));
    // The superseded group was never kept, so picking it again asks again.
    void summary.pickGroup(359);
    expect(calls.topSpecies).toHaveLength(5);
    stop();
  });
});
