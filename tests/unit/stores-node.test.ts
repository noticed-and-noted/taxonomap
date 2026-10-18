/** The URL-synced stores outside a browser (at build time): defaults, and no writes. */
import { DEFAULT_RAMP } from '~/lib/ramp';

it('start at their defaults and never touch the URL', async () => {
  const sync = await import('~/stores/url-sync');
  const taxon = sync.urlAtom(sync.codecs.int('taxon', 5));
  expect(taxon.get()).toBe(5);
  taxon.set(6);
  sync.syncFromUrl();
  expect(taxon.get()).toBe(5);
  expect(sync.hrefWith('/tree')).toBe('/tree');
});

it('keep the default ramp without a window or document', async () => {
  const { $ramp, setRamp } = await import('~/stores/ramp');
  expect($ramp.get()).toBe(DEFAULT_RAMP);
  vi.stubGlobal('localStorage', { setItem: vi.fn(), removeItem: vi.fn() });
  setRamp('magma');
  expect($ramp.get()).toBe('magma');
  vi.unstubAllGlobals();
});

it('give the tree page its URL state', async () => {
  const tree = await import('~/stores/tree');
  expect([tree.$treeFocus.get(), tree.$treeLayout.get(), tree.$treeMetric.get()]).toEqual([null, 'auto', 'records']);
});
