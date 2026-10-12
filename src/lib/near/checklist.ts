/**
 * Personal checklist ("seen" ticks). Stored only in this browser's
 * localStorage (every access wrapped in try/catch); no location is stored.
 */
import { map } from 'nanostores';

export interface ChecklistEntry {
  key: number;
  scientificName: string;
  commonName?: string;
  /** ISO date the species was ticked. */
  seen: string;
}

const KEY = 'gbif-explorer:checklist:v1';

function read(): Record<string, ChecklistEntry> {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Record<string, ChecklistEntry>) : {};
  } catch {
    return {};
  }
}

/** Whether the browser lets us persist (private modes may not). */
export function storageAvailable(): boolean {
  try {
    const probe = `${KEY}:probe`;
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

export const $checklist = map<Record<string, ChecklistEntry>>(typeof window === 'undefined' ? {} : read());

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify($checklist.get()));
  } catch {
    /* storage unavailable: the checklist lasts for this page view only */
  }
}

export function toggleSeen(e: Omit<ChecklistEntry, 'seen'>): void {
  const id = String(e.key);
  const current = $checklist.get();
  if (current[id]) {
    const { [id]: _removed, ...rest } = current;
    $checklist.set(rest);
  } else {
    $checklist.setKey(id, { ...e, seen: new Date().toISOString().slice(0, 10) });
  }
  persist();
}

export function clearChecklist(): void {
  $checklist.set({});
  persist();
}

const csvCell = (v: string | number | undefined) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function checklistCsv(entries: readonly ChecklistEntry[]): string {
  const rows = [
    ['gbif_taxon_key', 'scientific_name', 'common_name', 'date_ticked', 'gbif_url'],
    ...entries.map((e) => [e.key, e.scientificName, e.commonName, e.seen, `https://www.gbif.org/species/${e.key}`]),
  ];
  return rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}
