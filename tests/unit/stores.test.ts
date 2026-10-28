// @vitest-environment jsdom
/** The explorer and Near me stores: their URL formats and the actions that reset them. */

async function stores(search = '') {
  vi.resetModules();
  history.replaceState(null, '', `/${search}`);
  return {
    ...(await import('~/stores/explorer')),
    ...(await import('~/stores/near')),
  };
}

const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve));

describe('explorer URL state', () => {
  it('reads and clamps the map view, dates and selected cell', async () => {
    const loaded = await stores('?view=200,-90,30&when=y:2020..1990&hex=1.5,2.25,7&uncert=100');
    expect(loaded.$mapView.get()).toEqual({ lng: 180, lat: -85, zoom: 22 });
    expect(loaded.$dateRange.get()).toEqual({ unit: 'y', from: '1990-01-01', to: '2020-12-31' });
    expect(loaded.$selectedHex.get()).toEqual([1.5, 2.25, 7]);
    expect(loaded.$maxUncertainty.get()).toBe(100);
  });

  it('falls back to defaults for malformed values', async () => {
    const loaded = await stores('?view=a,b,c&when=d:2021-02-30..&hex=0,95&uncert=50&panel=nope');
    expect(loaded.$mapView.get()).toEqual(loaded.DEFAULT_VIEW);
    expect(loaded.$dateRange.get()).toBeNull();
    expect(loaded.$selectedHex.get()).toBeNull();
    expect(loaded.$maxUncertainty.get()).toBeNull();
    expect(loaded.$panel.get()).toBe('none');
  });

  it('writes compact values back to the URL', async () => {
    const loaded = await stores();
    loaded.$dateRange.set({ unit: 'm', from: '1990-03-01', to: '2000-06-30' });
    loaded.$selectedHex.set([1.23456, -2]);
    await flush();
    expect(new URLSearchParams(location.search).get('when')).toBe('m:1990-03..2000-06');
    expect(new URLSearchParams(location.search).get('hex')).toBe('1.2346,-2.0000');
    loaded.$selectedHex.set([1, 2, 9]);
    await flush();
    expect(new URLSearchParams(location.search).get('hex')).toBe('1.0000,2.0000,9');
  });

  it('writes the map view rounded, as viewParam does', async () => {
    const loaded = await stores();
    vi.useFakeTimers();
    loaded.$mapView.set({ lng: 1.234, lat: -5.678, zoom: 3.45 });
    vi.advanceTimersByTime(350);
    vi.useRealTimers();
    expect(new URLSearchParams(location.search).get('view')).toBe('1.23,-5.68,3.5');
    expect(loaded.viewParam({ lng: 0, lat: 0, zoom: 2 })).toBe('0.00,0.00,2.0');
  });

  it('clears the cell and its panel together', async () => {
    const loaded = await stores('?hex=1,2&panel=hex');
    loaded.$hexGeometry.set({ ring: [], wkt: '', tileTotal: 1 });
    loaded.clearHexSelection();
    expect([loaded.$selectedHex.get(), loaded.$hexGeometry.get()]).toEqual([null, null]);
    expect(loaded.$panel.get()).toBe('none');
  });

  it('leaves another panel open when clearing the cell', async () => {
    const loaded = await stores('?panel=filters');
    loaded.clearHexSelection();
    expect(loaded.$panel.get()).toBe('filters');
  });
});

describe('near me URL state', () => {
  it('rounds the location and rejects impossible ones', async () => {
    expect((await stores('?at=51.50739,-0.12776')).$nearAt.get()).toEqual({ lat: 51.507, lng: -0.128 });
    expect((await stores('?at=95,0')).$nearAt.get()).toBeNull();
    expect((await stores('?r=3')).$nearRadius.get()).toBe(2);
    expect((await stores('?r=25')).$nearRadius.get()).toBe(25);
  });

  it('writes a chosen radius', async () => {
    const loaded = await stores();
    vi.useFakeTimers();
    loaded.$nearRadius.set(10);
    vi.advanceTimersByTime(350);
    vi.useRealTimers();
    expect(new URLSearchParams(location.search).get('r')).toBe('10');
  });

  it('rounds a dropped pin before storing it', async () => {
    const loaded = await stores();
    loaded.setNearLocation(51.50739, -0.12776);
    expect(loaded.$nearAt.get()).toEqual({ lat: 51.507, lng: -0.128 });
  });

  it('drops every near-me parameter on exit', async () => {
    const loaded = await stores('?near=1&at=51.5,-0.1&r=10&month=1&tab=recent');
    loaded.exitNearMode();
    await flush();
    expect(location.search).toBe('');
  });

  it('frames wider radii with lower zooms, within limits', async () => {
    const { zoomForRadius } = await stores();
    expect(zoomForRadius(1)).toBeCloseTo(13.6);
    expect(zoomForRadius(10)).toBeLessThan(zoomForRadius(2));
    expect(zoomForRadius(10_000)).toBe(6);
    expect(zoomForRadius(0.01)).toBe(14);
  });
});

describe('months', () => {
  it('are dropped when the range stops being in whole years', async () => {
    const loaded = await stores('?months=3,4&when=y:2020..2021');
    expect(loaded.$months.get()).toEqual([3, 4]);
    loaded.$dateRange.set({ unit: 'd', from: '2020-01-01', to: '2020-02-01' });
    expect(loaded.$months.get()).toEqual([]);
  });
});
