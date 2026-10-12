// @vitest-environment jsdom
import { __resetUrlSync, codecs, hrefWith, syncFromUrl, urlAtom } from '~/stores/url-sync';

const flushMicrotasks = () => new Promise<void>((r) => queueMicrotask(r));

beforeEach(() => {
  __resetUrlSync();
  history.replaceState(null, '', '/');
  vi.useRealTimers();
});

describe('url-sync', () => {
  it('initialises from the URL and ignores invalid values', () => {
    history.replaceState(null, '', '/?taxon=212&photo=maybe');
    const taxon = urlAtom(codecs.int('taxon', null));
    const photo = urlAtom(codecs.bool('photo'));
    expect(taxon.get()).toBe(212);
    expect(photo.get()).toBe(false);
  });

  it('push-mode changes add a history entry; defaults are omitted', async () => {
    const taxon = urlAtom(codecs.int('taxon', null));
    const before = history.length;
    taxon.set(2492462);
    await flushMicrotasks();
    expect(location.search).toBe('?taxon=2492462');
    expect(history.length).toBe(before + 1);
    taxon.set(null);
    await flushMicrotasks();
    expect(location.search).toBe('');
  });

  it('replace-mode changes are throttled and do not add history', async () => {
    vi.useFakeTimers();
    const n = urlAtom(codecs.int('n', 0, { history: 'replace' }));
    const before = history.length;
    n.set(1);
    n.set(2);
    n.set(3);
    expect(location.search).toBe('');
    vi.advanceTimersByTime(350);
    expect(location.search).toBe('?n=3');
    expect(history.length).toBe(before);
  });

  it('keeps unrelated params and sorts keys', async () => {
    history.replaceState(null, '', '/?utm=x');
    const b = urlAtom(codecs.setOf('basis', ['B', 'A'] as const));
    b.set(['B', 'A']);
    await flushMicrotasks();
    expect(location.search).toBe('?basis=A%2CB&utm=x');
  });

  it('re-reads stores on back/forward without writing back', async () => {
    const taxon = urlAtom(codecs.int('taxon', null));
    taxon.set(1);
    await flushMicrotasks();
    taxon.set(2);
    await flushMicrotasks();
    history.replaceState(null, '', '/?taxon=1'); // simulate traversal
    syncFromUrl();
    expect(taxon.get()).toBe(1);
    await flushMicrotasks();
    expect(location.search).toBe('?taxon=1');
  });

  it('hrefWith carries only global params', () => {
    const taxon = urlAtom(codecs.int('taxon', null, { scope: 'global' }));
    const hex = urlAtom(codecs.string('hex'));
    taxon.set(5);
    hex.set('abc');
    expect(hrefWith('/tree')).toBe('/tree?taxon=5');
    expect(hrefWith('/tree', { taxon: null })).toBe('/tree');
  });
});

describe('withHistoryMode', () => {
  it('forces replace for writes inside the callback', async () => {
    const { withHistoryMode } = await import('~/stores/url-sync');
    vi.useFakeTimers();
    const n = urlAtom(codecs.int('anim', 0));
    const before = history.length;
    withHistoryMode('replace', () => n.set(5));
    vi.advanceTimersByTime(350);
    expect(location.search).toBe('?anim=5');
    expect(history.length).toBe(before);
    vi.useRealTimers();
  });
});
