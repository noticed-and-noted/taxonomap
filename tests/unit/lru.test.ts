import { LruCache } from '~/lib/gbif/lru';

describe('LruCache', () => {
  it('evicts the least recently used entry', () => {
    const c = new LruCache<number>(2);
    c.set('a', 1, 1000);
    c.set('b', 2, 1000);
    c.get('a');
    c.set('c', 3, 1000);
    expect(c.peek('a')).toBe(1);
    expect(c.peek('b')).toBeUndefined();
    expect(c.size).toBe(2);
  });

  it('hides expired entries from get but keeps them for peek', () => {
    let now = 0;
    const c = new LruCache<string>(10, () => now);
    c.set('k', 'v', 100);
    expect(c.get('k')).toBe('v');
    now = 101;
    expect(c.get('k')).toBeUndefined();
    expect(c.peek('k')).toBe('v');
  });
});
