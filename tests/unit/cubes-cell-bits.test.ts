/** H3 cell numbers from their bits: parsing, resolution, and descendants as one range, checked against h3-js. */
import { cellToChildren, latLngToCell } from 'h3-js';
import { cellNumber, descendantRange, resolutionOf } from '~/lib/cubes/cellBits';

const asNumber = (cell: string) => BigInt(`0x${cell}`);

describe('cellNumber', () => {
  it('reads an H3 cell’s hex text, and nothing else', () => {
    const cell = latLngToCell(51.5, -0.1, 4);
    expect(cellNumber(cell)).toBe(asNumber(cell));
    expect(cellNumber('3:0,0')).toBeNull();
    expect(cellNumber('')).toBeNull();
  });
});

describe('resolutionOf', () => {
  it('reads the resolution bits', () => {
    for (const resolution of [0, 2, 5, 9]) {
      expect(resolutionOf(asNumber(latLngToCell(-33.9, 151.2, resolution)))).toBe(resolution);
    }
  });
});

describe('descendantRange', () => {
  it('spans exactly from the first to the last descendant, as h3-js lists them', () => {
    for (const [coarse, fine] of [
      [2, 5],
      [4, 5],
      [3, 4],
    ] as const) {
      const cell = latLngToCell(51.5, -0.1, coarse);
      const children = cellToChildren(cell, fine).map(asNumber);
      const [first, last] = descendantRange(asNumber(cell), fine);
      expect(first).toBe(children.reduce((low, child) => (child < low ? child : low)));
      expect(last).toBe(children.reduce((high, child) => (child > high ? child : high)));
    }
  });

  it('is the cell itself at its own resolution', () => {
    const cell = asNumber(latLngToCell(0, 0, 5));
    expect(descendantRange(cell, 5)).toEqual([cell, cell]);
  });
});
