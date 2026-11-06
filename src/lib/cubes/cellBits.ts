/**
 * H3 cell numbers worked out from their bits, without h3-js, so the cell panel can use them without
 * loading the library. A cell number holds its resolution (4 bits) and one 3-bit digit per resolution;
 * digits past the cell's own resolution are 7.
 */

/** The records index's cells: the cubes' finest resolution. */
export const RECORD_RESOLUTION = 5;

/** An inclusive range of H3 cell numbers. */
export type CellRange = [first: bigint, last: bigint];

const MAX_RESOLUTION = 15;
const DIGIT_BITS = 3n;
const RESOLUTION_SHIFT = 52n;
const RESOLUTION_MASK = 0xfn;
const DIGIT_MASK = 7n;
// The highest child digit; 7 marks an unused digit.
const LAST_DIGIT = 6n;
const HEX_PATTERN = /^[0-9a-f]{15,16}$/i;

const digitShift = (resolution: number) => BigInt(MAX_RESOLUTION - resolution) * DIGIT_BITS;

/**
 * An H3 cell's number from its hex string.
 * @returns the number, or null when the text isn't an H3 cell's hex form
 */
export function cellNumber(cell: string): bigint | null {
  return HEX_PATTERN.test(cell) ? BigInt(`0x${cell}`) : null;
}

/** A cell number's resolution (0 to 15). */
export function resolutionOf(cell: bigint): number {
  return Number((cell >> RESOLUTION_SHIFT) & RESOLUTION_MASK);
}

/**
 * Every descendant of `cell` at a finer (or the same) resolution, as one range of cell numbers: their
 * extra digits run from all 0 to all 6.
 */
export function descendantRange(cell: bigint, resolution: number): CellRange {
  const own = resolutionOf(cell);
  let first = (cell & ~(RESOLUTION_MASK << RESOLUTION_SHIFT)) | (BigInt(resolution) << RESOLUTION_SHIFT);
  let last = first;
  for (let digit = own + 1; digit <= resolution; digit += 1) {
    first &= ~(DIGIT_MASK << digitShift(digit));
    last = (last & ~(DIGIT_MASK << digitShift(digit))) | (LAST_DIGIT << digitShift(digit));
  }
  return [first, last];
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
