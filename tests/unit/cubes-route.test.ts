/** The cube slice a filter asks for: its taxa (each a rank and name), and the years, months, record types and media. */
import { cubeFilters, cubeQueryFor, LIFE } from '~/lib/cubes/route';

const lookup = vi.fn(async (key: number) => {
  if (key === 212) return { scientificName: 'Aves', rank: 'CLASS' };
  if (key === 5219243) return { scientificName: 'Vulpes vulpes', rank: 'SPECIES' };
  if (key === 1) return { scientificName: 'Abc d e', rank: 'SUBSPECIES' };
  return null;
});

beforeEach(() => lookup.mockClear());

describe('cubeFilters', () => {
  it('reads years, months (either form), record types and media as bits', () => {
    expect(cubeFilters({})).toEqual({ year: null, months: null, basis: null, media: 0 });
    expect(
      cubeFilters({ year: [2000, 2010], months: [3, 4], basisOfRecord: ['PRESERVED_SPECIMEN'], hasImage: true }),
    ).toEqual({ year: [2000, 2010], months: [3, 4], basis: ['PRESERVED_SPECIMEN'], media: 1 });
    expect(cubeFilters({ month: 6, hasSound: true, months: [], basisOfRecord: [] })).toMatchObject({
      months: [6],
      basis: null,
      media: 2,
    });
    expect(cubeFilters({ hasImage: true, hasSound: true }).media).toBe(3);
  });
});

describe('cubeQueryFor', () => {
  it('is all of life with no taxon', async () => {
    expect(await cubeQueryFor({ year: [2000, 2020] }, lookup)).toEqual({
      taxa: [LIFE],
      year: [2000, 2020],
      months: null,
      basis: null,
      media: 0,
    });
    expect(lookup).not.toHaveBeenCalled();
  });

  it('names every taxon at its rank, from either form of the taxon filter', async () => {
    expect((await cubeQueryFor({ taxonKey: 212 }, lookup))?.taxa).toEqual([{ rank: 'class', taxon: 'Aves' }]);
    expect((await cubeQueryFor({ taxonKeys: [212, 5219243] }, lookup))?.taxa).toEqual([
      { rank: 'class', taxon: 'Aves' },
      { rank: 'species', taxon: 'Vulpes vulpes' },
    ]);
  });

  it('is null when any taxon can’t be named or is at a rank the cubes don’t hold', async () => {
    expect(await cubeQueryFor({ taxonKey: 7 }, lookup)).toBeNull();
    expect(await cubeQueryFor({ taxonKeys: [212, 1] }, lookup)).toBeNull();
  });
});
