/**
 * Exact record counts for hex cells, from an occurrence search over the cell.
 *
 * The tiles' counts are estimates: GBIF snaps records to tile pixels before
 * binning, so a pile of records just outside a cell can land in it. The
 * tooltip shows the estimate, then asks for the exact count once the pointer
 * rests on a cell; the selected-cell panel records the count it loads, so
 * the two always agree. Kept per filter and cell, most recent last.
 */
import { occurrenceCount, type OccurrenceFilter } from '~/lib/gbif';

/** Counts kept; the oldest go first. */
const MAX_CELLS = 500;
/** How long the pointer rests on a cell before its exact count is fetched. */
export const HOVER_DELAY_MS = 250;

const counts = new Map<string, number>();
const inFlight = new Map<string, Promise<number>>();

const keyOf = (filter: OccurrenceFilter, wkt: string) => `${JSON.stringify(filter)}|${wkt}`;

/** The exact count for a cell (its WKT) under a filter, if known. */
export function knownCount(filter: OccurrenceFilter, wkt: string): number | undefined {
  return counts.get(keyOf(filter, wkt));
}

/** Record a cell's exact count. */
export function rememberCount(filter: OccurrenceFilter, wkt: string, n: number): void {
  const key = keyOf(filter, wkt);
  counts.delete(key);
  counts.set(key, n);
  if (counts.size > MAX_CELLS) counts.delete(counts.keys().next().value!);
}

/** Fetch (once, however often asked) and record a cell's exact count. */
export function fetchCount(filter: OccurrenceFilter, wkt: string): Promise<number> {
  const key = keyOf(filter, wkt);
  const known = counts.get(key);
  if (known !== undefined) return Promise.resolve(known);
  let p = inFlight.get(key);
  if (!p) {
    p = occurrenceCount({ ...filter, geometry: wkt })
      .then((n) => {
        rememberCount(filter, wkt, n);
        return n;
      })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, p);
  }
  return p;
}

/**
 * Debounced exact counts for whatever cell is hovered: `hover` (re)starts the
 * wait for a new cell and `cancel` drops it; `onCount` hears only about the
 * cell still hovered when its count arrives.
 */
export function createHoverCounter(onCount: (wkt: string, n: number) => void, delayMs = HOVER_DELAY_MS) {
  let current: { filter: OccurrenceFilter; wkt: string } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    clearTimeout(timer);
    timer = undefined;
    current = null;
  };
  return {
    /** The pointer is on this cell; the same cell again keeps the running wait. */
    hover(filter: OccurrenceFilter, wkt: string) {
      if (current?.wkt === wkt && current.filter === filter) return;
      cancel();
      if (knownCount(filter, wkt) !== undefined) return;
      const cell = { filter, wkt };
      current = cell;
      timer = setTimeout(() => {
        fetchCount(filter, wkt).then(
          (n) => current === cell && onCount(wkt, n),
          () => undefined, // The estimate stays up.
        );
      }, delayMs);
    },
    cancel,
  };
}
