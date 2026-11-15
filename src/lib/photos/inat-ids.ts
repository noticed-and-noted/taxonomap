/**
 * GBIF taxon key → iNaturalist taxon ID and English name, remembered across visits. A match is
 * stable and costs a GBIF search to find, so each browser finds it once;
 * remembering the name too means a row named before needs no request at all. Held in
 * localStorage, newest last, capped.
 */
// v4: v3 could hold a higher taxon matched as one of its species (the cell's record list asked at the wrong rank).
// Entries are [key, id] or [key, id, name | null]: pairs still read, just without a name.
const STORAGE_KEY = 'inat-ids-v4';
const MAX_ENTRIES = 3000;

/** A remembered match: the name is null when iNaturalist has none, and absent when not yet seen. */
export interface InatMatch {
  id: number;
  name?: string | null;
}

type StoredEntry = [number, number, (string | null)?];

let cachedMatches: Map<number, InatMatch> | undefined;

/** One stored entry as a match, or null when it is malformed. */
function parseEntry([taxonKey, inatId, name]: StoredEntry): [number, InatMatch] | null {
  if (!Number.isInteger(taxonKey) || !Number.isInteger(inatId)) return null;
  const hasName = typeof name === 'string' || name === null;
  return [taxonKey, { id: inatId, ...(hasName && { name }) }];
}

/** Reads the saved entries, ignoring anything malformed or unreadable (no storage, or not ours). */
function loadStored(): Map<number, InatMatch> {
  const stored = new Map<number, InatMatch>();
  try {
    const entries = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as StoredEntry[];
    for (const entry of entries) {
      const parsed = Array.isArray(entry) ? parseEntry(entry) : null;
      if (parsed) stored.set(...parsed);
    }
  } catch {
    /* no storage, or not ours: start empty */
  }
  return stored;
}

function read(): Map<number, InatMatch> {
  cachedMatches ??= loadStored();
  return cachedMatches;
}

function save() {
  const entries = [...read()].map(([taxonKey, match]): StoredEntry =>
    match.name === undefined ? [taxonKey, match.id] : [taxonKey, match.id, match.name],
  );
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    /* storage full or blocked: remembered for this visit only */
  }
}

/** The remembered iNaturalist taxon ID for a GBIF taxon key, if any. */
export const knownInatId = (key: number): number | undefined => read().get(key)?.id;

/**
 * The remembered iNaturalist name for a GBIF taxon key: a name, null when iNaturalist has
 * none, or undefined when it hasn't been seen.
 */
export const knownInatName = (key: number): string | null | undefined => read().get(key)?.name;

/** Drops a remembered match, e.g. one iNaturalist no longer recognises. */
export function forgetInatId(key: number): void {
  if (read().delete(key)) save();
}

/** Whether `next` adds nothing to what is remembered as `current`. */
function isSame(current: InatMatch | undefined, next: InatMatch): boolean {
  return current?.id === next.id && (next.name === undefined || current.name === next.name);
}

/**
 * Remembers newly found matches, evicting the oldest beyond the cap. A match without a name
 * keeps the name already remembered for the same ID.
 * @param found GBIF taxon key → iNaturalist match.
 */
export function rememberInatMatches(found: ReadonlyMap<number, InatMatch>): void {
  const current = read();
  let hasChanged = false;
  for (const [taxonKey, match] of found) {
    const previous = current.get(taxonKey);
    if (isSame(previous, match)) continue;
    const keptName = previous?.id === match.id ? previous.name : undefined;
    const name = match.name === undefined ? keptName : match.name;
    current.delete(taxonKey);
    current.set(taxonKey, { id: match.id, ...(name !== undefined && { name }) });
    hasChanged = true;
  }
  if (!hasChanged) return;
  while (current.size > MAX_ENTRIES) current.delete(current.keys().next().value!);
  save();
}
