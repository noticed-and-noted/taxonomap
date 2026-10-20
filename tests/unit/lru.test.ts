import { LruCache } from '~/lib/gbif/lru';

describe('LruCache', () => {
  it('evicts the least recently used entry', () => {
    const cache = new LruCache<number>(2);
    cache.set('a', 1, 1000);
    cache.set('b', 2, 1000);
    cache.get('a');
    cache.set('c', 3, 1000);
    expect(cache.peek('a')).toBe(1);
    expect(cache.peek('b')).toBeUndefined();
    expect(cache.size).toBe(2);
  });

  it('hides expired entries from get but keeps them for peek', () => {
    let now = 0;
    const cache = new LruCache<string>(10, () => now);
    cache.set('k', 'v', 100);
    expect(cache.get('k')).toBe('v');
    now = 101;
    expect(cache.get('k')).toBeUndefined();
    expect(cache.peek('k')).toBe('v');
  });
});
