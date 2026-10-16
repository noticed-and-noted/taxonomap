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

const flush = () => new Promise<void>((r) => queueMicrotask(r));

describe('explorer URL state', () => {
  it('reads and clamps the map view, years and selected cell', async () => {
    const s = await stores('?view=200,-90,30&years=2020-1990&hex=1.5,2.25&uncert=100');
    expect(s.$mapView.get()).toEqual({ lng: 180, lat: -85, zoom: 22 });
    expect(s.$yearRange.get()).toEqual([1990, 2020]);
    expect(s.$selectedHex.get()).toEqual([1.5, 2.25]);
    expect(s.$maxUncertainty.get()).toBe(100);
  });

  it('falls back to defaults for malformed values', async () => {
    const s = await stores('?view=a,b,c&years=1990&hex=0,95&uncert=50&panel=nope');
    expect(s.$mapView.get()).toEqual(s.DEFAULT_VIEW);
    expect(s.$yearRange.get()).toBeNull();
    expect(s.$selectedHex.get()).toBeNull();
    expect(s.$maxUncertainty.get()).toBeNull();
    expect(s.$panel.get()).toBe('none');
  });

  it('writes compact values back to the URL', async () => {
    const s = await stores();
    s.$yearRange.set([1990, 2000]);
    s.$selectedHex.set([1.23456, -2]);
    await flush();
    expect(new URLSearchParams(location.search).get('years')).toBe('1990-2000');
    expect(new URLSearchParams(location.search).get('hex')).toBe('1.2346,-2.0000');
  });

  it('clears the cell, its records and its panel together', async () => {
    const s = await stores('?hex=1,2&pts=1&rec=5&panel=hex');
    s.$hexGeometry.set({ ring: [], wkt: '', tileTotal: 1 });
    s.clearHexSelection();
    expect([s.$selectedHex.get(), s.$showRecords.get(), s.$selectedRecord.get(), s.$hexGeometry.get()]).toEqual([
      null,
      false,
      null,
      null,
    ]);
    expect(s.$panel.get()).toBe('none');
  });

  it('leaves another panel open when clearing the cell', async () => {
    const s = await stores('?panel=filters');
    s.clearHexSelection();
    expect(s.$panel.get()).toBe('filters');
  });
});

describe('near me URL state', () => {
  it('rounds the location and rejects impossible ones', async () => {
    expect((await stores('?at=51.50739,-0.12776')).$nearAt.get()).toEqual({ lat: 51.507, lng: -0.128 });
    expect((await stores('?at=95,0')).$nearAt.get()).toBeNull();
    expect((await stores('?r=3')).$nearRadius.get()).toBe(2);
    expect((await stores('?r=25')).$nearRadius.get()).toBe(25);
  });

  it('rounds a dropped pin before storing it', async () => {
    const s = await stores();
    s.setNearLocation(51.50739, -0.12776);
    expect(s.$nearAt.get()).toEqual({ lat: 51.507, lng: -0.128 });
  });

  it('drops every near-me parameter on exit', async () => {
    const s = await stores('?near=1&at=51.5,-0.1&r=10&month=1&tab=recent');
    s.exitNearMode();
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
