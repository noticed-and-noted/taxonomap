/** Reassembling a hex cell that overzoomed tiles return as clipped pieces. */
import { convexHull, convexOverlap, hullRing, mercatorPx, outerRings, type Pt } from '~/lib/map/hexPieces';

// A flat-topped hex centred on the origin, radius 2, and the pieces two tile
// slices cut it into at x = 0, each overhanging the cut by a 0.25 buffer.
const S = Math.sqrt(3);
const hex: Pt[] = [
  [2, 0],
  [1, S],
  [-1, S],
  [-2, 0],
  [-1, -S],
  [1, -S],
];
const left: Pt[] = [
  [0.25, S],
  [-1, S],
  [-2, 0],
  [-1, -S],
  [0.25, -S],
];
const right: Pt[] = [
  [2, 0],
  [1, S],
  [-0.25, S],
  [-0.25, -S],
  [1, -S],
];
// The neighbouring cell up and to the right shares the edge (2,0)-(1,√3).
const neighbour: Pt[] = hex.map(([x, y]) => [x + 3, y + S]);
const close = (r: Pt[]) => [...r, r[0] as Pt];
// Draw at 100 px per unit, so the half-pixel tolerances are small.
const toPx = (p: Pt): Pt => [p[0] * 100, p[1] * 100];

describe('convexOverlap', () => {
  it('tells pieces of one cell from cells that only share an edge', () => {
    expect(convexOverlap(left, right, 0.1)).toBe(true);
    expect(convexOverlap(hex, neighbour, 0.1)).toBe(false);
    expect(convexOverlap(right, neighbour, 0.1)).toBe(false);
  });
});

describe('convexHull', () => {
  it('drops interior and collinear points', () => {
    const pts: Pt[] = [
      [0, 0],
      [1, 0],
      [2, 0],
      [2, 2],
      [0, 2],
      [1, 1],
    ];
    expect(convexHull(pts).map((i) => pts[i])).toEqual([
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
    ]);
  });
});

describe('hullRing', () => {
  it('rebuilds the whole cell from its pieces, without the cut corners', () => {
    const ring = hullRing([close(left), close(right)], toPx);
    expect(ring).toHaveLength(7);
    expect(ring[0]).toEqual(ring[6]);
    expect(new Set(ring.slice(0, 6).map(String))).toEqual(new Set(hex.map(String)));
  });

  it('merges a corner seen from two tiles', () => {
    const nudged = hex.map(([x, y]) => [x + 1e-3, y] as Pt);
    expect(hullRing([close(hex), close(nudged)], toPx)).toHaveLength(7);
  });
});

describe('outerRings', () => {
  it('takes the outer ring of each polygon', () => {
    expect(outerRings({ type: 'Polygon', coordinates: [close(hex)] })).toEqual([close(hex)]);
    expect(outerRings({ type: 'MultiPolygon', coordinates: [[close(left)], [close(right)]] })).toHaveLength(2);
    expect(outerRings({ type: 'Point', coordinates: [0, 0] })).toEqual([]);
  });
});

describe('mercatorPx', () => {
  it('lays the world out flat, one 512 px tile at zoom 0, the antimeridian at either side', () => {
    expect(mercatorPx([0, 0], 0)).toEqual([256, 256]);
    expect(mercatorPx([-180, 0], 1)[0]).toBe(0);
    expect(mercatorPx([180, 0], 1)[0]).toBe(1024);
    expect(mercatorPx([0, 85.0511], 0)[1]).toBeCloseTo(0, 1);
    expect(mercatorPx([0, 90], 0)[1]).toBeLessThan(0.1);
  });
});
