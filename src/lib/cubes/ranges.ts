/**
 * Which H3 cells a map view needs, as ranges of cell numbers.
 *
 * Inside one taxon the cubes are sorted by cell, and the children of one H3 cell are a contiguous run of
 * numbers (their extra digits go 0–6). So a view's cells come down to a few ranges, and a row group whose
 * cell statistics miss every range is skipped without downloading it.
 */
import { cellToCenterChild, gridDisk, latLngToCell, polygonToCells } from 'h3-js';

/** An inclusive range of H3 cell numbers. */
export type CellRange = [first: bigint, last: bigint];

/** [west, south, east, north] in degrees. */
export type Bounds = readonly [number, number, number, number];

const MAX_RESOLUTION = 15;
const DIGIT_BITS = 3n;
// The highest child digit; 7 marks an unused digit.
const LAST_DIGIT = 6n;
// Cover the view with cells this many resolutions coarser, then take each one's children: few cells to
// cover with, and ranges that still hug the view.
const COARSER_BY = 2;

/** Every child of `cell` at `resolution`, as a range of cell numbers. */
function childRange(cell: string, coarse: number, resolution: number): CellRange {
  const first = BigInt(`0x${cellToCenterChild(cell, resolution)}`);
  let last = first;
  for (let digit = coarse + 1; digit <= resolution; digit += 1) {
    last |= LAST_DIGIT << (BigInt(MAX_RESOLUTION - digit) * DIGIT_BITS);
  }
  return [first, last];
}

/** Points along a view's edges per side, corners included. */
const EDGE_STEPS = 8;

/** [lat, lng] points along the edges of a view, and its centre. */
function edgePoints([west, south, east, north]: Bounds): [number, number][] {
  const points: [number, number][] = [[(south + north) / 2, (west + east) / 2]];
  for (let step = 0; step <= EDGE_STEPS; step += 1) {
    const [lat, lng] = [south + ((north - south) * step) / EDGE_STEPS, west + ((east - west) * step) / EDGE_STEPS];
    points.push([south, lng], [north, lng], [lat, west], [lat, east]);
  }
  return points;
}

const compare = (left: bigint, right: bigint) => (left < right ? -1 : left > right ? 1 : 0);

/** Sorted ranges with overlapping and touching ones joined. */
export function mergeRanges(ranges: readonly CellRange[]): CellRange[] {
  const sorted = [...ranges].sort(([left], [right]) => compare(left, right));
  const merged: CellRange[] = [];
  for (const [first, last] of sorted) {
    const previous = merged.at(-1);
    if (previous && first <= previous[1] + 1n) previous[1] = last > previous[1] ? last : previous[1];
    else merged.push([first, last]);
  }
  return merged;
}

/**
 * The cell ranges at `resolution` that cover a view.
 * @param bounds the view, under 180° wide
 * @returns sorted, non-overlapping ranges
 */
export function viewRanges([west, south, east, north]: Bounds, resolution: number): CellRange[] {
  const coarse = Math.max(0, resolution - COARSER_BY);
  const loop = [
    [south, west],
    [south, east],
    [north, east],
    [north, west],
  ];
  // polygonToCells keeps only cells whose centre is inside, so the cells under points along the edges
  // join them (coarse cells can be wider than a ring reaches), and a ring around each covers the rest.
  const edges = edgePoints([west, south, east, north]).map(([lat, lng]) => latLngToCell(lat, lng, coarse));
  const inside = [...edges, ...polygonToCells(loop, coarse)];
  const cover = new Set(inside.flatMap((cell) => gridDisk(cell, 1)));
  return mergeRanges([...cover].map((cell) => childRange(cell, coarse, resolution)));
}

/** Whether a cell number falls in any of the ranges (binary search). */
export function inRanges(cell: bigint, ranges: readonly CellRange[]): boolean {
  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const [first, last] = ranges[middle]!;
    if (cell < first) high = middle - 1;
    else if (cell > last) low = middle + 1;
    else return true;
  }
  return false;
}

/** Whether [first, last] overlaps any of the ranges: if not, a row group with those cell stats is skipped. */
export function overlapsRanges(first: bigint, last: bigint, ranges: readonly CellRange[]): boolean {
  return ranges.some(([rangeFirst, rangeLast]) => first <= rangeLast && last >= rangeFirst);
}
