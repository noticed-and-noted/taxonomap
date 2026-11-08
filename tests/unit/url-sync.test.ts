// @vitest-environment jsdom
import { __resetUrlSync, codecs, hrefWith, linkParams, syncFromUrl, urlAtom } from '~/stores/url-sync';

const flushMicrotasks = () => new Promise<void>((resolve) => queueMicrotask(resolve));

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
    const counter = urlAtom(codecs.int('n', 0, { history: 'replace' }));
    const before = history.length;
    counter.set(1);
    counter.set(2);
    counter.set(3);
    expect(location.search).toBe('');
    vi.advanceTimersByTime(350);
    expect(location.search).toBe('?n=3');
    expect(history.length).toBe(before);
  });

  it('keeps unrelated params and sorts keys', async () => {
    history.replaceState(null, '', '/?utm=x');
    const basisAtom = urlAtom(codecs.setOf('basis', ['B', 'A'] as const));
    basisAtom.set(['B', 'A']);
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

  it('hrefWith carries only map params', () => {
    const taxon = urlAtom(codecs.int('taxon', null, { scope: 'map' }));
    const focus = urlAtom(codecs.int('focus', null));
    taxon.set(5);
    focus.set(1);
    expect(hrefWith('/')).toBe('/?taxon=5');
    expect(hrefWith('/', { taxon: null })).toBe('/');
  });
});

describe('withHistoryMode', () => {
  it('forces replace for writes inside the callback', async () => {
    const { withHistoryMode } = await import('~/stores/url-sync');
    vi.useFakeTimers();
    const counter = urlAtom(codecs.int('anim', 0));
    const before = history.length;
    withHistoryMode('replace', () => counter.set(5));
    vi.advanceTimersByTime(350);
    expect(location.search).toBe('?anim=5');
    expect(history.length).toBe(before);
    vi.useRealTimers();
  });

  it('intSet parses a bounded, de-duplicated, numerically sorted list', () => {
    const codec = codecs.intSet('months', { min: 1, max: 12, limit: 3 });
    expect(codec.parse('12,4,x,4,13,2,1')).toEqual([1, 2, 4]);
    expect(codec.serialize([10, 2])).toBe('2,10');
  });
});

describe('url-sync edge cases', () => {
  it('writes nothing when a value changes and changes back before the write', async () => {
    const taxon = urlAtom(codecs.int('t2', null));
    const replace = vi.spyOn(history, 'replaceState');
    const push = vi.spyOn(history, 'pushState');
    taxon.set(1);
    taxon.set(null);
    await flushMicrotasks();
    expect([push.mock.calls.length, replace.mock.calls.length]).toEqual([0, 0]);
    push.mockRestore();
    replace.mockRestore();
  });

  it('a push supersedes a throttled replace', async () => {
    vi.useFakeTimers();
    const view = urlAtom(codecs.int('v2', 0, { history: 'replace' }));
    const taxon = urlAtom(codecs.int('t3', null));
    const before = history.length;
    view.set(4);
    taxon.set(7);
    await flushMicrotasks();
    expect(location.search).toBe('?t3=7&v2=4');
    expect(history.length).toBe(before + 1);
    // A reset drops a pending replace.
    view.set(5);
    __resetUrlSync();
    vi.advanceTimersByTime(350);
    expect(location.search).toBe('?t3=7&v2=4');
  });

  it('re-reads stores on popstate and after a page swap', () => {
    const taxon = urlAtom(codecs.int('t4', null));
    history.replaceState(null, '', '/?t4=3');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(taxon.get()).toBe(3);
    history.replaceState(null, '', '/?t4=4');
    document.dispatchEvent(new Event('astro:after-swap'));
    expect(taxon.get()).toBe(4);
  });

  it('puts map params back on same-site navigations to the map that do not set them', () => {
    const taxon = urlAtom(codecs.int('t5', null, { scope: 'map' }));
    const page = urlAtom(codecs.int('p5', null));
    taxon.set(9);
    page.set(1);
    const navigate = (to: string, navigationType = 'push') => {
      const navigationEvent = Object.assign(new Event('astro:before-preparation'), {
        to: new URL(to, location.href),
        navigationType,
      });
      document.dispatchEvent(navigationEvent);
      return navigationEvent.to.href;
    };
    expect(navigate('/')).toBe(`${location.origin}/?t5=9`);
    expect(navigate('/?t5=2')).toBe(`${location.origin}/?t5=2`);
    expect(navigate('/', 'traverse')).toBe(`${location.origin}/`);
    expect(navigate('/tree')).toBe(`${location.origin}/tree`);
    expect(navigate('https://elsewhere.test/')).toBe('https://elsewhere.test/');
  });

  it('remembers what the latest link asked for, not the params put back, and nothing after going back', () => {
    urlAtom(codecs.int('t8', null, { scope: 'map' })).set(9);
    const navigate = (to: string, navigationType = 'push') =>
      document.dispatchEvent(
        Object.assign(new Event('astro:before-preparation'), { to: new URL(to, location.href), navigationType }),
      );
    navigate('/?taxon=212');
    expect(linkParams().get('taxon')).toBe('212');
    expect(linkParams().has('t8')).toBe(false);
    navigate('/?taxon=212', 'traverse');
    expect(linkParams().has('taxon')).toBe(false);
  });

  it('keeps map params out of other pages but remembers their values', async () => {
    const taxon = urlAtom(codecs.int('t7', null, { scope: 'map' }));
    const focus = urlAtom(codecs.int('f7', null));
    taxon.set(9);
    await flushMicrotasks();
    history.pushState(null, '', '/tree');
    document.dispatchEvent(new Event('astro:after-swap'));
    expect(taxon.get()).toBe(9);
    focus.set(3);
    await flushMicrotasks();
    expect(location.search).toBe('?f7=3');
  });

  it('leaves stores alone when the URL matches them', () => {
    const taxon = urlAtom(codecs.int('t6', null));
    const seen = vi.fn();
    taxon.listen(seen);
    syncFromUrl('');
    expect(seen).not.toHaveBeenCalled();
  });

  it('hrefWith sets overrides', () => {
    expect(hrefWith('/tree', { focus: '212' })).toBe('/tree?focus=212');
  });

  it('codecs reject what they cannot read and write their values back', () => {
    expect(codecs.int('i', null).parse('1.5')).toBeUndefined();
    const boolCodec = codecs.bool('b');
    expect([boolCodec.parse('0'), boolCodec.parse('1'), boolCodec.parse('yes')]).toEqual([false, true, undefined]);
    expect([boolCodec.serialize(true), boolCodec.serialize(false)]).toEqual(['1', '0']);
    const enumCodec = codecs.enumOf('e', ['a', 'b'] as const, 'a');
    expect([enumCodec.parse('b'), enumCodec.parse('c'), enumCodec.serialize('b')]).toEqual(['b', undefined, 'b']);
    const set = codecs.setOf('s', ['x', 'y'] as const);
    expect(set.parse('y,z,x,y')).toEqual(['x', 'y']);
    expect(codecs.intSet('n').parse('3,-1')).toEqual([-1, 3]);
    const stringCodec = codecs.string('q', { pattern: /^[a-z]+$/ });
    expect([
      stringCodec.parse('abc'),
      stringCodec.parse('ABC'),
      stringCodec.serialize('abc'),
      stringCodec.serialize(null),
    ]).toEqual(['abc', undefined, 'abc', '']);
    expect(codecs.string('r').parse('Anything')).toBe('Anything');
  });
});
