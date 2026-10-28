/**
 * GBIF taxon key → iNaturalist taxon ID, remembered across visits. A match is
 * stable and costs a GBIF search (or an iNaturalist one) to find, so each
 * browser finds it once. Held in localStorage, newest last, capped.
 */
// v2: v1 could hold wrong matches for groups iNaturalist ranks differently (GBIF's order Cetacea).
const STORAGE_KEY = 'inat-ids-v2';
const MAX_ENTRIES = 3000;

let cachedIds: Map<number, number> | undefined;

/** Reads the saved pairs, ignoring anything malformed or unreadable (no storage, or not ours). */
function loadStored(): Map<number, number> {
  const stored = new Map<number, number>();
  try {
    const pairs = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as [number, number][];
    for (const [taxonKey, inatId] of pairs) {
      if (Number.isInteger(taxonKey) && Number.isInteger(inatId)) stored.set(taxonKey, inatId);
    }
  } catch {
    /* no storage, or not ours: start empty */
  }
  return stored;
}

function read(): Map<number, number> {
  cachedIds ??= loadStored();
  return cachedIds;
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...read()]));
  } catch {
    /* storage full or blocked: remembered for this visit only */
  }
}

/** The remembered iNaturalist taxon ID for a GBIF taxon key, if any. */
export const knownInatId = (key: number): number | undefined => read().get(key);

/** Drops a remembered match, e.g. one iNaturalist no longer recognises. */
export function forgetInatId(key: number): void {
  if (read().delete(key)) save();
}

/**
 * Remembers newly found matches, evicting the oldest beyond the cap.
 * @param found GBIF taxon key → iNaturalist taxon ID.
 */
export function rememberInatIds(found: ReadonlyMap<number, number>): void {
  const current = read();
  let hasChanged = false;
  for (const [taxonKey, inatId] of found) {
    if (current.get(taxonKey) === inatId) continue;
    current.delete(taxonKey);
    current.set(taxonKey, inatId);
    hasChanged = true;
  }
  if (!hasChanged) return;
  while (current.size > MAX_ENTRIES) current.delete(current.keys().next().value!);
  save();
}
