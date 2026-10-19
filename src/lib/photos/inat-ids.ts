/**
 * GBIF taxon key → iNaturalist taxon ID, remembered across visits. A match is
 * stable and costs a GBIF search (or an iNaturalist one) to find, so each
 * browser finds it once. Held in localStorage, newest last, capped.
 */
const KEY = 'inat-ids';
const MAX = 3000;

let ids: Map<number, number> | undefined;

function read(): Map<number, number> {
  if (!ids) {
    ids = new Map();
    try {
      for (const [k, v] of JSON.parse(localStorage.getItem(KEY) ?? '[]') as [number, number][]) {
        if (Number.isInteger(k) && Number.isInteger(v)) ids.set(k, v);
      }
    } catch {
      /* no storage, or not ours: start empty */
    }
  }
  return ids;
}

export const knownInatId = (key: number): number | undefined => read().get(key);

export function forgetInatId(key: number): void {
  if (read().delete(key)) save();
}

export function rememberInatIds(found: ReadonlyMap<number, number>): void {
  const m = read();
  let changed = false;
  for (const [k, v] of found) {
    if (m.get(k) === v) continue;
    m.delete(k);
    m.set(k, v);
    changed = true;
  }
  if (!changed) return;
  while (m.size > MAX) m.delete(m.keys().next().value!);
  save();
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify([...read()]));
  } catch {
    /* storage full or blocked: remembered for this visit only */
  }
}
