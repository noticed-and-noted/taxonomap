/** Which cube rows fall under a query: any of its taxa, and its years, months, record types and media. */
import { matchesFilters, matchesQuery, matchesTaxa, needsFilterColumns } from '~/lib/cubes/match';
import { LIFE } from '~/lib/cubes/route';
import { cellRow, cubeQuery } from './helpers/cubes';

const birds = { rank: 'class', taxon: 'Aves' } as const;
const fox = { rank: 'species', taxon: 'Vulpes vulpes' } as const;

describe('matchesTaxa', () => {
  it('keeps every row for life, and rows under any of the taxa otherwise', () => {
    const bee = cellRow({ class: 'Insecta', species: 'Apis mellifera' });
    expect(matchesTaxa(bee, [LIFE])).toBe(true);
    expect(matchesTaxa(bee, [birds])).toBe(false);
    expect(matchesTaxa(cellRow(), [fox, birds])).toBe(true);
  });
});

describe('matchesFilters', () => {
  it('keeps rows in the year range, dropping undated ones', () => {
    const filters = cubeQuery({ year: [2010, 2030] });
    expect(matchesFilters(cellRow(), filters)).toBe(true);
    expect(matchesFilters(cellRow({ year: 2001 }), filters)).toBe(false);
    expect(matchesFilters(cellRow({ year: 2031 }), filters)).toBe(false);
    expect(matchesFilters(cellRow({ year: null }), filters)).toBe(false);
  });

  it('keeps rows in the months and record types asked for', () => {
    expect(matchesFilters(cellRow(), cubeQuery({ months: [4, 5] }))).toBe(true);
    expect(matchesFilters(cellRow({ month: null }), cubeQuery({ months: [5] }))).toBe(false);
    expect(matchesFilters(cellRow(), cubeQuery({ basis: ['PRESERVED_SPECIMEN'] }))).toBe(false);
    expect(matchesFilters(cellRow({ basisofrecord: null }), cubeQuery({ basis: ['HUMAN_OBSERVATION'] }))).toBe(false);
  });

  it('keeps rows with any of the media asked for, as GBIF ORs them', () => {
    expect(matchesFilters(cellRow({ media: 0 }), cubeQuery({ media: 1 }))).toBe(false);
    expect(matchesFilters(cellRow({ media: 2 }), cubeQuery({ media: 3 }))).toBe(true);
    expect(matchesFilters(cellRow({ media: 2 }), cubeQuery({ media: 1 }))).toBe(false);
  });
});

describe('needsFilterColumns', () => {
  it('is only for months, record types or media: years and taxa need just the lean map cube', () => {
    expect(needsFilterColumns(cubeQuery({ year: [2000, 2010] }))).toBe(false);
    expect(needsFilterColumns(cubeQuery({ months: [5] }))).toBe(true);
    expect(needsFilterColumns(cubeQuery({ basis: ['PRESERVED_SPECIMEN'] }))).toBe(true);
    expect(needsFilterColumns(cubeQuery({ media: 1 }))).toBe(true);
  });
});

describe('matchesQuery', () => {
  it('needs both the taxa and the filters', () => {
    expect(matchesQuery(cellRow(), cubeQuery({ taxa: [birds], year: [2020, 2020] }))).toBe(true);
    expect(matchesQuery(cellRow(), cubeQuery({ taxa: [fox], year: [2020, 2020] }))).toBe(false);
    expect(matchesQuery(cellRow(), cubeQuery({ taxa: [birds], year: [2019, 2019] }))).toBe(false);
  });
});
