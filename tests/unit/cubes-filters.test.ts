/** Which filters cube mode answers: the set ones it can't, by name, and the date ranges it can (whole years). */
import { isCubeRange, unsupportedFilters } from '~/lib/cubes/filters';

describe('unsupportedFilters', () => {
  it('names only the set filters the cubes can’t answer', () => {
    expect(unsupportedFilters({ taxonKeys: [212], year: [2000, 2010], months: [3], hasImage: true })).toEqual([]);
    expect(
      unsupportedFilters({ exactTaxon: true, iucn: ['EN'], publishers: [], maxUncertaintyM: 100, hasSound: false }),
    ).toEqual(['exact taxon', 'IUCN Red List', 'location accuracy']);
    expect(unsupportedFilters({ eventDate: '2020-01-01,*', continents: ['EUROPE'] })).toEqual([
      'dates that aren’t whole years',
      'continent',
    ]);
  });
});

describe('isCubeRange', () => {
  it('takes no range or whole years, not presets or months and days', () => {
    expect(isCubeRange(null)).toBe(true);
    expect(isCubeRange({ unit: 'y', from: '2000-01-01', to: null })).toBe(true);
    expect(isCubeRange({ unit: 'm', from: '2000-01-01', to: null })).toBe(false);
    expect(isCubeRange({ preset: '1m' })).toBe(false);
  });
});
