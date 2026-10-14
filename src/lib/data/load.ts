import type { NamesSnapshot, TreeSnapshot, YearsSnapshot } from './types';

interface Snapshots {
  years: YearsSnapshot;
  names: NamesSnapshot;
  tree: TreeSnapshot;
}

const cache = new Map<string, Promise<unknown>>();

/**
 * Load a baked snapshot from /data/<name>.json (same origin, precached by
 * the service worker). Resolves null if unavailable so callers can go live.
 */
export function loadSnapshot<K extends keyof Snapshots>(name: K): Promise<Snapshots[K] | null> {
  let p = cache.get(name) as Promise<Snapshots[K] | null> | undefined;
  if (!p) {
    p = fetch(`/data/${name}.json`)
      .then((r) => (r.ok ? (r.json() as Promise<Snapshots[K]>) : null))
      .catch(() => null);
    cache.set(name, p);
  }
  return p;
}
