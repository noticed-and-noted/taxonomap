/**
 * A cell's panel from its cube rows: the taxon and year filter, the count and months (scaled for a
 * sample), classes and species as facets most recorded first, one class's species, and the unscaled
 * count the records index lists.
 */
import { listedRecords, matchesQuery, speciesCounts, summariseCell } from '~/lib/cubes/cellSummary';
import type { CellRow } from '~/lib/cubes/reader';
import type { CubeQuery } from '~/lib/cubes/route';

const life: CubeQuery = { rank: 'life', taxon: 'Life', year: null };
const birds: CubeQuery = { rank: 'class', taxon: 'Aves', year: null };

function row(overrides: Partial<CellRow>): CellRow {
  return {
    cell: 1n,
    kingdom: 'Animalia',
    phylum: 'Chordata',
    class: 'Aves',
    order: 'Passeriformes',
    family: 'Turdidae',
    genus: 'Turdus',
    species: 'Turdus merula',
    specieskey: 9,
    year: 2020,
    month: 5,
    records: 2n,
    ...overrides,
  };
}

const ROWS = [
  row({}),
  row({ month: 6, records: 3n }),
  row({ species: 'Erithacus rubecula', genus: 'Erithacus', specieskey: 7, records: 1n, year: 2001 }),
  row({ class: 'Insecta', species: 'Apis mellifera', specieskey: 4, records: 10n, month: null }),
  row({ species: null, specieskey: null, records: 5n }),
  row({ class: null, species: null, specieskey: null, records: 1n }),
];

const classKeyOf = (name: string) => (name === 'Aves' ? 212 : -1);

describe('matchesQuery', () => {
  it('keeps every row for life, and only the taxon’s rows otherwise', () => {
    expect(matchesQuery(ROWS[3]!, life)).toBe(true);
    expect(matchesQuery(ROWS[3]!, birds)).toBe(false);
    expect(matchesQuery(ROWS[0]!, { rank: 'species', taxon: 'Turdus merula', year: null })).toBe(true);
  });

  it('keeps rows in the year range, dropping undated ones', () => {
    const recent: CubeQuery = { ...life, year: [2010, 2030] };
    expect(matchesQuery(ROWS[0]!, recent)).toBe(true);
    expect(matchesQuery(ROWS[2]!, recent)).toBe(false);
    expect(matchesQuery(row({ year: null }), recent)).toBe(false);
  });
});

describe('summariseCell', () => {
  it('counts the whole cell: records, months, classes and species, scaled up', () => {
    const summary = summariseCell(ROWS, life, 2, classKeyOf, { classes: 50, species: 200 });
    expect(summary.count).toBe(44);
    expect(summary.months[4]).toBe(2 * (2 + 1 + 5 + 1));
    expect(summary.months[5]).toBe(6);
    expect(summary.classes).toEqual([
      { name: '212', count: 22, label: 'Aves' },
      { name: '-1', count: 20, label: 'Insecta' },
    ]);
    expect(summary.species).toEqual([
      { name: '4', count: 20, label: 'Apis mellifera' },
      { name: '9', count: 10, label: 'Turdus merula' },
      { name: '7', count: 2, label: 'Erithacus rubecula' },
    ]);
  });

  it('keeps to the taxon and the limits', () => {
    const summary = summariseCell(ROWS, birds, 1, classKeyOf, { classes: 1, species: 1 });
    expect(summary.count).toBe(11);
    expect(summary.classes).toEqual([{ name: '212', count: 11, label: 'Aves' }]);
    expect(summary.species).toEqual([{ name: '9', count: 5, label: 'Turdus merula' }]);
  });
});

describe('speciesCounts', () => {
  it('lists one class’s species', () => {
    expect(speciesCounts(ROWS, life, 1, { limit: 10, className: 'Insecta' })).toEqual([
      { name: '4', count: 10, label: 'Apis mellifera' },
    ]);
  });
});

describe('listedRecords', () => {
  it('counts the records under the query, for one species if asked, unscaled', () => {
    expect(listedRecords(ROWS, birds, null)).toBe(11);
    expect(listedRecords(ROWS, birds, 9)).toBe(5);
    expect(listedRecords(ROWS, { ...life, year: [2000, 2005] }, null)).toBe(1);
  });
});
