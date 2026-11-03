import { LruCache } from '~/lib/gbif/lru';

/** Enough for the files a few keystrokes touch; search must never hold every name in memory. */
const MAX_FILES_HELD = 32;

const held = new LruCache<Promise<unknown>>(MAX_FILES_HELD);

/** Fetches a file; a load isn't aborted with its query, as the next keystroke usually wants the same file. */
async function fetchFile<Content>(path: string): Promise<Content> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Name-search file ${path} answered ${response.status}`);
  return (await response.json()) as Content;
}

/**
 * A static search file from the small in-memory cache, else fetched. A failed load isn't kept, so the
 * next search tries again.
 * @throws Error when the file can't be fetched.
 */
export function loadSearchFile<Content>(path: string): Promise<Content> {
  const existing = held.get(path);
  if (existing) return existing as Promise<Content>;
  const loading = fetchFile<Content>(path);
  held.set(path, loading, Number.POSITIVE_INFINITY);
  loading.catch(() => held.delete(path));
  return loading;
}
