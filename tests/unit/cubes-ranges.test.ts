/** A view's H3 cells as number ranges: no gaps inside the view, merged, and searchable. */
import { latLngToCell } from 'h3-js';
import { inRanges, mergeRanges, overlapsRanges, viewRanges, type Bounds } from '~/lib/cubes/ranges';

const cellNumber = (lat: number, lng: number, resolution: number) => BigInt(`0x${latLngToCell(lat, lng, resolution)}`);

/** Points on a grid across a view, edges included. */
function pointsIn([west, south, east, north]: Bounds, steps = 24): [number, number][] {
  const points: [number, number][] = [];
  for (let row = 0; row <= steps; row++) {
    for (let column = 0; column <= steps; column++) {
      points.push([south + ((north - south) * row) / steps, west + ((east - west) * column) / steps]);
    }
  }
  return points;
}

describe('viewRanges', () => {
  const views: [string, Bounds, number][] = [
    ['Europe at resolution 4', [-10, 35, 35, 57.5], 4],
    ['Britain at resolution 5', [-7, 50.2, 4.2, 55.8], 5],
    ['beside the antimeridian', [170, -50, 179.9, -35], 4],
    ['a coarse view at resolution 1', [-40, -20, 40, 20], 1],
  ];

  it.each(views)('covers every cell in view: %s', (_name, bounds, resolution) => {
    const ranges = viewRanges(bounds, resolution);
    for (const [lat, lng] of pointsIn(bounds)) expect(inRanges(cellNumber(lat, lng, resolution), ranges)).toBe(true);
  });

  it('returns sorted ranges that do not overlap', () => {
    const ranges = viewRanges([-10, 35, 35, 57.5], 4);
    ranges.forEach(([first, last], index) => {
      expect(first <= last).toBe(true);
      if (index) expect(first > ranges[index - 1]![1] + 1n).toBe(true);
    });
  });

  it('leaves out cells far from the view', () => {
    const ranges = viewRanges([-7, 50.2, 4.2, 55.8], 5);
    expect(inRanges(cellNumber(-33.9, 151.2, 5), ranges)).toBe(false);
  });
});

describe('mergeRanges', () => {
  it('joins overlapping and touching ranges, keeping one inside another, and leaves gaps', () => {
    expect(
      mergeRanges([
        [20n, 30n],
        [1n, 5n],
        [6n, 8n],
        [1n, 3n],
        [22n, 25n],
        [40n, 50n],
      ]),
    ).toEqual([
      [1n, 8n],
      [20n, 30n],
      [40n, 50n],
    ]);
  });

  it('keeps an empty list empty', () => {
    expect(mergeRanges([])).toEqual([]);
  });
});

describe('inRanges and overlapsRanges', () => {
  const ranges: [bigint, bigint][] = [
    [10n, 20n],
    [30n, 40n],
  ];

  it('finds a cell inside a range and misses one between or beyond them', () => {
    expect([10n, 15n, 40n].map((cell) => inRanges(cell, ranges))).toEqual([true, true, true]);
    expect([5n, 25n, 45n].map((cell) => inRanges(cell, ranges))).toEqual([false, false, false]);
    expect(inRanges(1n, [])).toBe(false);
  });

  it('tells whether a row group’s cell span meets any range', () => {
    expect(overlapsRanges(18n, 32n, ranges)).toBe(true);
    expect(overlapsRanges(21n, 29n, ranges)).toBe(false);
  });
});
