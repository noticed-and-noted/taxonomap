// @vitest-environment jsdom
/**
 * Cube mode keeps only the filters the cubes answer: turning it on, or a filter set while it's on,
 * clears the rest and names them; turning it off forgets the notice; whole-year ranges stay.
 */
async function load() {
  vi.resetModules();
  const explorer = await import('~/stores/explorer');
  // A fresh store keeps the URL of the test before, so start from no filters.
  explorer.clearFilters();
  return {
    explorer,
    cubes: await import('~/stores/cubes'),
    publisher: await import('~/stores/publisher'),
    mode: await import('~/stores/cubeMode'),
  };
}

describe('cube mode store', () => {
  it('clears unsupported filters when cube mode starts on, keeping the ones the cubes hold', async () => {
    const { explorer, cubes, mode } = await load();
    explorer.$iucn.set(['EN']);
    explorer.$hasPhoto.set(true);
    explorer.$dateRange.set({ unit: 'y', from: '2000-01-01', to: '2010-12-31' });
    cubes.$cubesOn.set(true);
    const stop = mode.startCubeMode();
    expect(explorer.$iucn.get()).toEqual([]);
    expect(explorer.$hasPhoto.get()).toBe(true);
    expect(explorer.$dateRange.get()).not.toBeNull();
    expect(mode.$clearedForCubes.get()).toEqual(['IUCN Red List']);
    stop();
  });

  it('clears a filter set while on (a link, say), and forgets the notice when turned off', async () => {
    const { explorer, cubes, publisher, mode } = await load();
    const stop = mode.startCubeMode();
    cubes.$cubesOn.set(true);
    expect(mode.$clearedForCubes.get()).toEqual([]);
    explorer.$dateRange.set({ preset: '1m' });
    expect(explorer.$dateRange.get()).toBeNull();
    publisher.$publisherKeys.set(['abc']);
    explorer.$exactTaxon.set(true);
    explorer.$continents.set(['EUROPE']);
    explorer.$maxUncertainty.set(100);
    expect([explorer.$exactTaxon.get(), explorer.$continents.get(), explorer.$maxUncertainty.get()]).toEqual([
      false,
      [],
      null,
    ]);
    expect(publisher.$publisherKeys.get()).toEqual([]);
    cubes.$cubesOn.set(false);
    expect(mode.$clearedForCubes.get()).toEqual([]);
    explorer.$iucn.set(['EN']);
    expect(explorer.$iucn.get()).toEqual(['EN']);
    stop();
    cubes.$cubesOn.set(true);
    expect(explorer.$iucn.get()).toEqual(['EN']);
  });
});
