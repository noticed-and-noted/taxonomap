import type { NamesSnapshot, TreeSnapshot, YearsSnapshot } from './types';

interface Snapshots {
  years: YearsSnapshot;
  names: NamesSnapshot;
  tree: TreeSnapshot;
}

const cache = new Map<string, Promise<unknown>>();

/**
 * Load a baked snapshot from /data/<name>.json (same origin, cached on demand
 * by the service worker). Resolves null if unavailable so callers can go live.
 */
export function loadSnapshot<K extends keyof Snapshots>(name: K): Promise<Snapshots[K] | null> {
  let pending = cache.get(name) as Promise<Snapshots[K] | null> | undefined;
  if (!pending) {
    pending = fetch(`/data/${name}.json`)
      .then((response) => (response.ok ? (response.json() as Promise<Snapshots[K]>) : null))
      .catch(() => null);
    cache.set(name, pending);
  }
  return pending;
}
