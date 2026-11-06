/**
 * A cell's panel from its cube rows: the count and months (scaled for a sample), classes and species as
 * facets most recorded first, one class's species, and the unscaled count the records index lists.
 */
import { listedRecords, speciesCounts, summariseCell } from '~/lib/cubes/cellSummary';
import { cellRow, cubeQuery } from './helpers/cubes';

const life = cubeQuery();
const birds = cubeQuery({ taxa: [{ rank: 'class', taxon: 'Aves' }] });

const ROWS = [
  cellRow({ records: 2n }),
  cellRow({ month: 6, records: 3n }),
  cellRow({ species: 'Erithacus rubecula', genus: 'Erithacus', specieskey: 7, records: 1n, year: 2001 }),
  cellRow({ class: 'Insecta', species: 'Apis mellifera', specieskey: 4, records: 10n, month: null }),
  cellRow({ species: null, specieskey: null, records: 5n }),
  cellRow({ class: null, species: null, specieskey: null, records: 1n }),
];

const classKeyOf = (name: string) => (name === 'Aves' ? 212 : -1);

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

  it('keeps to the taxa, the filters and the limits', () => {
    const summary = summariseCell(ROWS, birds, 1, classKeyOf, { classes: 1, species: 1 });
    expect(summary.count).toBe(11);
    expect(summary.classes).toEqual([{ name: '212', count: 11, label: 'Aves' }]);
    expect(summary.species).toEqual([{ name: '9', count: 5, label: 'Turdus merula' }]);
    expect(summariseCell(ROWS, cubeQuery({ months: [6] }), 1, classKeyOf, { classes: 9, species: 9 }).count).toBe(3);
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
    expect(listedRecords(ROWS, cubeQuery({ year: [2000, 2005] }), null)).toBe(1);
  });
});
