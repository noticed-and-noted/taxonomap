/**
 * Exact record counts for hex cells, from an occurrence search over the cell.
 *
 * The tiles' counts are estimates: GBIF snaps records to tile pixels before
 * binning, so a pile of records just outside a cell can land in it. The
 * tooltip shows the estimate, then asks for the exact count once the pointer
 * rests on a cell; the selected-cell panel records the count it loads, so
 * the two always agree. Kept per filter and cell, most recent last.
 */
import { occurrenceCount, searchOccurrences, type Occurrence, type OccurrenceFilter } from '~/lib/gbif';

/** Counts kept; the oldest go first. */
const MAX_CELLS = 500;
/** How long the pointer rests on a cell before its exact count is fetched. */
export const HOVER_DELAY_MS = 250;

/** Cells per batched check: GBIF rejects search URLs past about 5 KB, roughly 25 hex polygons. */
const BATCH_CELLS = 20;
/** Records fetched per batch: sparse cells hold a few each, and a record is ~7 KB, so a full 300 page is 2 MB. */
const BATCH_RECORDS = 100;

const counts = new Map<string, number>();
const inFlight = new Map<string, Promise<number>>();
const checking = new Set<string>();
/** Each filter's JSON: a store hands out the same object until its filter changes, and the map asks for every cell. */
const filterKeys = new WeakMap<OccurrenceFilter, string>();
/**
 * WKTs counted at 0, by filter JSON, so the map can skip the lookup when a filter has none.
 * Kept apart from `counts`: a view can hold more sparse cells than MAX_CELLS, and an empty
 * cell forgotten with its count would be drawn again, checked again, and push out another.
 */
const emptyCells = new Map<string, Set<string>>();
/** Empty cells kept per filter: more than a view ever draws, so the loop above can't come back. */
const MAX_EMPTY_CELLS = 20_000;

function filterKeyOf(filter: OccurrenceFilter): string {
  let filterKey = filterKeys.get(filter);
  if (filterKey === undefined) {
    filterKey = JSON.stringify(filter);
    filterKeys.set(filter, filterKey);
  }
  return filterKey;
}

const keyOf = (filter: OccurrenceFilter, wkt: string) => `${filterKeyOf(filter)}|${wkt}`;

function markEmpty(filterKey: string, wkt: string, isEmpty: boolean) {
  const cells = emptyCells.get(filterKey) ?? new Set<string>();
  if (isEmpty) cells.add(wkt);
  else cells.delete(wkt);
  if (cells.size > MAX_EMPTY_CELLS) cells.delete(cells.values().next().value!);
  if (cells.size) emptyCells.set(filterKey, cells);
  else emptyCells.delete(filterKey);
}

/** Whether any cell is known to hold no records under a filter: a cheap check before `knownCount` on every cell. */
export function hasKnownEmpty(filter: OccurrenceFilter): boolean {
  return emptyCells.has(filterKeyOf(filter));
}

/** The exact count for a cell (its WKT) under a filter, if known. */
export function knownCount(filter: OccurrenceFilter, wkt: string): number | undefined {
  const filterKey = filterKeyOf(filter);
  return counts.get(`${filterKey}|${wkt}`) ?? (emptyCells.get(filterKey)?.has(wkt) ? 0 : undefined);
}

/** Record a cell's exact count. */
export function rememberCount(filter: OccurrenceFilter, wkt: string, count: number): void {
  const filterKey = filterKeyOf(filter);
  const key = `${filterKey}|${wkt}`;
  counts.delete(key);
  counts.set(key, count);
  markEmpty(filterKey, wkt, count === 0);
  if (counts.size > MAX_CELLS) counts.delete(counts.keys().next().value!);
}

/** Fetch (once, however often asked) and record a cell's exact count. */
export function fetchCount(filter: OccurrenceFilter, wkt: string): Promise<number> {
  const key = keyOf(filter, wkt);
  const known = knownCount(filter, wkt);
  if (known !== undefined) return Promise.resolve(known);
  let pending = inFlight.get(key);
  if (!pending) {
    pending = occurrenceCount({ ...filter, geometry: wkt })
      .then((count) => {
        rememberCount(filter, wkt, count);
        return count;
      })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
  }
  return pending;
}

/** A WKT polygon's rings (two for a MULTIPOLYGON split at the antimeridian), as [lng, lat] pairs. */
function ringsOf(wkt: string): [number, number][][] {
  return wkt
    .replace(/^\w+\(+|\)+$/g, '')
    .split(/\)+,\(+/)
    .map((ring) => ring.split(',').map((pair) => pair.split(' ').map(Number) as [number, number]));
}

/** Point in polygon, planar in lng/lat as GBIF's search tests WKT. */
function isInside(record: Occurrence, ring: [number, number][]): boolean {
  const lng = record.decimalLongitude ?? Number.NaN;
  const lat = record.decimalLatitude ?? Number.NaN;
  let isHit = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [currentLng, currentLat] = ring[index]!;
    const [previousLng, previousLat] = ring[previous]!;
    const crosses = currentLat > lat !== previousLat > lat;
    if (crosses && lng < ((previousLng - currentLng) * (lat - currentLat)) / (previousLat - currentLat) + currentLng)
      isHit = !isHit;
  }
  return isHit;
}

/** Fetch one batch's records and record each cell's exact count; true if any cell is empty. */
async function checkBatch(filter: OccurrenceFilter, wkts: string[]): Promise<boolean> {
  const keys = wkts.map((wkt) => keyOf(filter, wkt));
  keys.forEach((key) => checking.add(key));
  try {
    const page = await searchOccurrences({ ...filter, geometry: wkts }, { limit: BATCH_RECORDS });
    // Only a complete page says which cells are empty.
    if (page.results.length < page.count) return false;
    const cells = wkts.map(ringsOf);
    const hits = wkts.map(() => 0);
    for (const record of page.results) {
      const cell = cells.findIndex((rings) => rings.some((ring) => isInside(record, ring)));
      // A record no ring claims (one exactly on a cell edge) makes the tally unreliable.
      if (cell < 0) return false;
      hits[cell]!++;
    }
    wkts.forEach((wkt, index) => rememberCount(filter, wkt, hits[index]!));
    return hits.includes(0);
  } finally {
    keys.forEach((key) => checking.delete(key));
  }
}

/**
 * Exact counts for many sparse cells in a few requests: GBIF ORs repeated
 * geometries, so one search per batch fetches every record and each is
 * tallied to its cell. Cells already known or being fetched are skipped.
 * @returns Whether any cell turned out empty.
 */
export async function checkCells(filter: OccurrenceFilter, wkts: readonly string[]): Promise<boolean> {
  const todo = wkts.filter((wkt) => {
    const key = keyOf(filter, wkt);
    return knownCount(filter, wkt) === undefined && !inFlight.has(key) && !checking.has(key);
  });
  const batches: string[][] = [];
  for (let start = 0; start < todo.length; start += BATCH_CELLS) batches.push(todo.slice(start, start + BATCH_CELLS));
  const results = await Promise.all(batches.map((batch) => checkBatch(filter, batch)));
  return results.includes(true);
}

/**
 * Debounced exact counts for whatever cell is hovered: `hover` (re)starts the
 * wait for a new cell and `cancel` drops it; `onCount` hears only about the
 * cell still hovered when its count arrives.
 */
export function createHoverCounter(onCount: (wkt: string, count: number) => void, delayMs = HOVER_DELAY_MS) {
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
          (count) => current === cell && onCount(wkt, count),
          () => undefined, // The estimate stays up.
        );
      }, delayMs);
    },
    cancel,
  };
}
