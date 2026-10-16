import { compact, countryName, distance, full, plural } from '~/lib/format';

describe('format', () => {
  it('formats counts compactly and in full', () => {
    expect(compact(1_234_567)).toBe('1.2M');
    expect(compact(950)).toBe('950');
    expect(full(1_234_567)).toBe('1,234,567');
  });

  it('pluralises with the count', () => {
    expect(plural(1, 'record')).toBe('1 record');
    expect(plural(12_345, 'record')).toBe('12,345 records');
    expect(plural(2, 'species', 'species')).toBe('2 species');
  });

  it('names countries, falling back to the code', () => {
    expect(countryName('gb')).toBe('United Kingdom');
    expect(countryName('not a code')).toBe('not a code');
  });

  it('shows distances in metres or kilometres', () => {
    expect(distance(100)).toBe('100 m');
    expect(distance(10_000)).toBe('10 km');
  });
});
