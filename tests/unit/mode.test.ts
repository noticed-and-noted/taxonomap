// @vitest-environment jsdom
/** The map page's mode: how it reads from the URL and how switching resets the other modes. */

async function loadModeStores(search = '') {
  vi.resetModules();
  history.replaceState(null, '', `/${search}`);
  return {
    ...(await import('~/stores/explorer')),
    ...(await import('~/stores/near')),
    ...(await import('~/stores/mode')),
  };
}

describe('map mode', () => {
  it('reads the mode from the URL, keeping old Near me links', async () => {
    expect((await loadModeStores('')).$mapMode.get()).toBe('explore');
    expect((await loadModeStores('?near=1')).$mapMode.get()).toBe('near');
    expect((await loadModeStores('?analyse=1')).$mapMode.get()).toBe('analyse');
    expect((await loadModeStores('?near=1&analyse=1')).$mapMode.get()).toBe('near');
  });

  it('leaving Near me drops its location and radius', async () => {
    const loaded = await loadModeStores('?near=1&at=51.5,-0.1&r=10');
    loaded.setMapMode('analyse');
    expect(loaded.$mapMode.get()).toBe('analyse');
    expect(loaded.$nearAt.get()).toBeNull();
    expect(loaded.$nearRadius.get()).toBe(loaded.DEFAULT_RADIUS_KM);
  });

  it('entering another mode closes the selected cell and its panel', async () => {
    const loaded = await loadModeStores('?hex=1.5,2.25,7&panel=hex');
    loaded.setMapMode('near');
    expect(loaded.$selectedHex.get()).toBeNull();
    expect(loaded.$panel.get()).toBe('none');
    expect(loaded.$nearMode.get()).toBe(true);
  });

  it('going back to Explore clears both other modes', async () => {
    const loaded = await loadModeStores('?analyse=1');
    loaded.setMapMode('explore');
    expect(loaded.$analyseMode.get()).toBe(false);
    expect(loaded.$nearMode.get()).toBe(false);
  });

  it('offers every mode in the switches, in order', async () => {
    const { MAP_MODES } = await loadModeStores();
    const { MODE_OPTIONS } = await import('~/lib/map-modes');
    expect(MODE_OPTIONS.map((option) => option.value)).toEqual(MAP_MODES);
  });

  it('does nothing when asked for the mode it is already in', async () => {
    const loaded = await loadModeStores('?near=1&at=51.5,-0.1');
    loaded.setMapMode('near');
    expect(loaded.$nearAt.get()).toEqual({ lat: 51.5, lng: -0.1 });
  });
});
