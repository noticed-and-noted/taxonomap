/** When the cubes can draw the map, and which slice of them: one taxon or all of life, years, not the plain world view. */
import { cubeQueryFor, cubesCanServe } from '~/lib/cubes/route';

const birds = { scientificName: 'Aves', rank: 'CLASS' };
const lookup = vi.fn(async (key: number) =>
  key === 212 ? birds : key === 1 ? { scientificName: 'Abc d', rank: 'SUBSPECIES' } : null,
);

beforeEach(() => lookup.mockClear());

describe('cubesCanServe', () => {
  it('takes one taxon or none, with or without years, once zoomed in', () => {
    expect(cubesCanServe({}, 3)).toBe(true);
    expect(cubesCanServe({ taxonKey: 212 }, 4)).toBe(true);
    expect(cubesCanServe({ taxonKeys: [212] }, 4)).toBe(true);
    expect(cubesCanServe({ taxonKeys: [], exactTaxon: false, year: null }, 4)).toBe(true);
  });

  it('takes the world view only with a year range: without one, GBIF’s cached tiles are quicker', () => {
    expect(cubesCanServe({ taxonKey: 212 }, 1.5)).toBe(false);
    expect(cubesCanServe({ taxonKey: 212, year: [2010, 2019] }, 1.5)).toBe(true);
  });

  it('leaves several taxa and every other filter to GBIF', () => {
    expect(cubesCanServe({ taxonKeys: [212, 359] }, 4)).toBe(false);
    expect(cubesCanServe({ basisOfRecord: ['PRESERVED_SPECIMEN'] }, 4)).toBe(false);
    expect(cubesCanServe({ hasImage: true }, 4)).toBe(false);
    expect(cubesCanServe({ exactTaxon: true }, 4)).toBe(false);
  });
});

describe('cubeQueryFor', () => {
  it('is all of life with no taxon', async () => {
    expect(await cubeQueryFor({ year: [2000, 2020] }, 1, lookup)).toEqual({
      rank: 'life',
      taxon: 'Life',
      year: [2000, 2020],
    });
    expect(lookup).not.toHaveBeenCalled();
  });

  it('is the taxon’s name at its rank, from either form of the taxon filter', async () => {
    const expected = { rank: 'class', taxon: 'Aves', year: null };
    expect(await cubeQueryFor({ taxonKey: 212 }, 4, lookup)).toEqual(expected);
    expect(await cubeQueryFor({ taxonKeys: [212] }, 4, lookup)).toEqual(expected);
  });

  it('is null for a taxon it can’t name, a rank the cubes don’t hold, or a filter they can’t serve', async () => {
    expect(await cubeQueryFor({ taxonKey: 7 }, 4, lookup)).toBeNull();
    expect(await cubeQueryFor({ taxonKey: 1 }, 4, lookup)).toBeNull();
    expect(await cubeQueryFor({ taxonKey: 212, hasSound: true }, 4, lookup)).toBeNull();
    expect(lookup).toHaveBeenCalledTimes(2);
  });
});
