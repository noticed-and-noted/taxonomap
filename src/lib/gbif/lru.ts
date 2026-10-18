interface Entry<V> {
  value: V;
  expires: number;
}

/**
 * Small LRU with per-entry TTL. Expired entries are kept (until evicted) so
 * they can be served as a stale fallback when GBIF is unavailable.
 */
export class LruCache<V> {
  readonly #max: number;
  readonly #map = new Map<string, Entry<V>>();
  readonly #now: () => number;

  constructor(max = 300, now: () => number = Date.now) {
    this.#max = max;
    this.#now = now;
  }

  get size(): number {
    return this.#map.size;
  }

  /** Fresh value only; refreshes recency. */
  get(key: string): V | undefined {
    const e = this.#map.get(key);
    if (!e) return undefined;
    this.#touch(key, e);
    return e.expires > this.#now() ? e.value : undefined;
  }

  /** Any value, fresh or expired; does not refresh recency. */
  peek(key: string): V | undefined {
    return this.#map.get(key)?.value;
  }

  set(key: string, value: V, ttlMs: number): void {
    this.#map.delete(key);
    this.#map.set(key, { value, expires: this.#now() + ttlMs });
    // Oldest first (Maps keep insertion order); deleting while iterating is safe.
    for (const oldest of this.#map.keys()) {
      if (this.#map.size <= this.#max) break;
      this.#map.delete(oldest);
    }
  }

  clear(): void {
    this.#map.clear();
  }

  #touch(key: string, e: Entry<V>): void {
    this.#map.delete(key);
    this.#map.set(key, e);
  }
}
