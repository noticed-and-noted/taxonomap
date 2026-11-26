// @vitest-environment jsdom
/** The map page's mode: how it reads from the URL and how switching resets the other modes. */

async function loadModeStores(search = '') {
  vi.resetModules();
  history.replaceState(null, '', `/${search}`);
  return {
    ...(await import('~/stores/explorer')),
    ...(await import('~/stores/near')),
    ...(await import('~/stores/mode')),
    ...(await import('~/stores/filters')),
    ...(await import('~/stores/map-messages')),
    ...(await import('~/lib/filter-groups')),
  };
}

describe('map mode', () => {
  beforeEach(() => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia;
  });

  it('reads the mode from the URL, keeping old Near me links', async () => {
    expect((await loadModeStores('')).$mode.get()).toBe('explore');
    expect((await loadModeStores('?near=1')).$mode.get()).toBe('near');
    expect((await loadModeStores('?analyse=1')).$mode.get()).toBe('analyse');
    expect((await loadModeStores('?near=1&analyse=1')).$mode.get()).toBe('near');
  });

  it('leaving Near me drops its location, radius and record total', async () => {
    const loaded = await loadModeStores('?near=1&at=51.5,-0.1&r=10');
    loaded.$nearTotal.set(1204);
    loaded.$nearPanelOpen.set(false);
    loaded.setMapMode('analyse');
    expect(loaded.$nearTotal.get()).toBeNull();
    expect(loaded.$nearPanelOpen.get()).toBe(true);
    expect(loaded.$mode.get()).toBe('analyse');
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

  it('coming back to Explore opens its results beside the map', async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia;
    const loaded = await loadModeStores('?analyse=1');
    loaded.setMapMode('explore');
    expect(loaded.$panel.get()).toBe('results');
  });

  it('keeps the Explore results closed on phones, where they would cover the map', async () => {
    const loaded = await loadModeStores('?near=1');
    loaded.setMapMode('explore');
    expect(loaded.$panel.get()).toBe('none');
  });

  it('going back to Explore clears both other modes', async () => {
    const loaded = await loadModeStores('?analyse=1');
    loaded.$analysePanelOpen.set(false);
    loaded.setMapMode('explore');
    expect(loaded.$analysePanelOpen.get()).toBe(true);
    expect(loaded.$analyseMode.get()).toBe(false);
    expect(loaded.$nearMode.get()).toBe(false);
  });

  it('entering Analyse clears every filter and closes a filter flyout it does not offer', async () => {
    const loaded = await loadModeStores('?taxon=212&uncert=100');
    loaded.$railOpen.set('what');
    loaded.setMapMode('analyse');
    expect(loaded.$occurrenceFilter.get()).toEqual({});
    expect(loaded.$railOpen.get()).toBeNull();
  });

  it('keeps an offered flyout open on the way into Analyse', async () => {
    const loaded = await loadModeStores('');
    loaded.$railOpen.set('how');
    loaded.setMapMode('analyse');
    expect(loaded.$railOpen.get()).toBe('how');
    loaded.setMapMode('explore');
    loaded.$railOpen.set('settings');
    loaded.setMapMode('analyse');
    expect(loaded.$railOpen.get()).toBe('settings');
  });

  it('offers only How and Where in Analyse, every group elsewhere', async () => {
    const loaded = await loadModeStores('?analyse=1');
    expect(loaded.$visibleFilterGroups.get().map((group) => group.id)).toEqual(['where', 'how']);
    loaded.setMapMode('explore');
    expect(loaded.$visibleFilterGroups.get()).toEqual(loaded.FILTER_GROUPS);
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
