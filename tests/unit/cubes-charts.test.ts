/** Sums over the charts cube: records per year under the filters (every year shown), and a taxon's total. */
import { taxonTotal, yearCounts } from '~/lib/cubes/charts';
import { chartRow, cubeQuery, cubeSet } from './helpers/cubes';

const birds = { rank: 'class', taxon: 'Aves' } as const;
const fox = { rank: 'species', taxon: 'Vulpes vulpes' } as const;

const cubes = cubeSet({
  scale: 2,
  chartRows: vi.fn(async (taxon) =>
    taxon.taxon === 'Aves'
      ? [
          chartRow({ year: 2001, records: 2n }),
          chartRow({ year: 2000, records: 1n, month: 1 }),
          chartRow({ year: null }),
        ]
      : [chartRow({ taxon: 'Vulpes vulpes', year: 2001, records: 5n })],
  ),
});

describe('yearCounts', () => {
  it('sums every taxon’s years, oldest first, scaled, leaving out undated records and the year range', async () => {
    expect(await yearCounts(cubes, cubeQuery({ taxa: [birds, fox], year: [2001, 2001] }))).toEqual([
      [2000, 2],
      [2001, 14],
    ]);
  });

  it('keeps to the other filters', async () => {
    expect(await yearCounts(cubes, cubeQuery({ taxa: [birds], months: [1] }))).toEqual([[2000, 2]]);
  });
});

describe('taxonTotal', () => {
  it('counts all of a taxon’s records, dated or not, scaled', async () => {
    expect(await taxonTotal(cubes, birds)).toBe(8);
  });
});
