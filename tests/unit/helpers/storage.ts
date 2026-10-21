/**
 * A plain in-memory Storage. Newer Node ships its own localStorage global,
 * which shadows jsdom's, so store tests stub this one instead.
 * @returns An empty Storage.
 */
export function memoryStorage(): Storage {
  const storage = new Map<string, string>();
  return {
    get length() {
      return storage.size;
    },
    clear: () => storage.clear(),
    getItem: (key) => storage.get(key) ?? null,
    key: (index) => [...storage.keys()][index] ?? null,
    removeItem: (key) => void storage.delete(key),
    setItem: (key, value) => void storage.set(key, String(value)),
  };
}
