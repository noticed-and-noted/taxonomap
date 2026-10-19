/** The When filter's date ranges: rounding to a unit, presets, GBIF fields, labels and the URL form. */
import {
  endOf,
  parseRange,
  rangeFilter,
  rangeLabel,
  rangeYears,
  resolveRange,
  serializeRange,
  startOf,
  yearsRange,
} from '~/lib/dates';

const today = new Date(2026, 2, 31);

describe('date ranges', () => {
  it('round a date out to its year, month or day', () => {
    expect(startOf('2024-02-17', 'y')).toBe('2024-01-01');
    expect(endOf('2024-02-17', 'm')).toBe('2024-02-29');
    expect(endOf('2023-02', 'm')).toBe('2023-02-28');
    expect(endOf('2024', 'y')).toBe('2024-12-31');
    expect(startOf('2024-02-17', 'd')).toBe('2024-02-17');
  });

  it('roll presets back from today, clamped to the month end', () => {
    expect(resolveRange({ preset: '1w' }, today)).toEqual({ from: '2026-03-24', to: '2026-03-31' });
    expect(resolveRange({ preset: '1m' }, today).from).toBe('2026-02-28');
    expect(resolveRange({ preset: '100y' }, today).from).toBe('1926-03-31');
  });

  it('filter whole years by year and anything finer by eventDate', () => {
    expect(rangeFilter(yearsRange(2022, 2020), today)).toEqual({ year: [2020, 2022] });
    expect(rangeFilter({ unit: 'y', from: null, to: '1950-12-31' }, today)).toEqual({ year: [1500, 1950] });
    expect(rangeFilter({ unit: 'd', from: '2019-03-12', to: null }, today)).toEqual({ eventDate: '2019-03-12,*' });
    expect(rangeFilter({ preset: '2y' }, today)).toEqual({ eventDate: '2024-03-31,2026-03-31' });
    expect(rangeYears({ preset: '2y' }, today)).toEqual([2024, 2026]);
    expect(rangeYears(null)).toBeNull();
  });

  it('label ranges by their unit', () => {
    expect(rangeLabel(yearsRange(1990, 2000))).toBe('1990–2000');
    expect(rangeLabel(yearsRange(2001, 2001))).toBe('2001');
    expect(rangeLabel({ unit: 'm', from: '2020-03-01', to: '2022-06-30' })).toBe('Mar 2020 – Jun 2022');
    expect(rangeLabel({ unit: 'd', from: '2019-03-12', to: null })).toBe('Since 12 Mar 2019');
    expect(rangeLabel({ preset: '5y' })).toBe('Last 5 years');
  });

  it('round-trip the URL form and reject bad dates', () => {
    for (const raw of ['5y', 'y:2020..2022', 'm:2020-03..2022-06', 'd:2019-03-12..', 'y:..1950']) {
      expect(serializeRange(parseRange(raw)!)).toBe(raw);
    }
    expect(parseRange('d:2021-03-01..2021-01-15')).toEqual({ unit: 'd', from: '2021-01-15', to: '2021-03-01' });
    for (const raw of ['3y', 'y:..', 'd:2021-02-30..', 'm:2021-13..', 'y:1499..2000', 'y:2020-01..', '1990-2000']) {
      expect(parseRange(raw)).toBeUndefined();
    }
  });
});

describe('typed dates', () => {
  it('read years, months and days in common forms', async () => {
    const { parseDateInput } = await import('~/lib/dates');
    expect(parseDateInput(' 2020 ')).toBe('2020');
    expect(parseDateInput('Mar 2020')).toBe('2020-03');
    expect(parseDateInput('march, 2020')).toBe('2020-03');
    expect(parseDateInput('12 Mar 2020')).toBe('2020-03-12');
    expect(parseDateInput('2020-3-7')).toBe('2020-03-07');
    expect(parseDateInput('12/03/2020')).toBe('2020-03-12');
    expect(parseDateInput('03/2020')).toBe('2020-03');
    for (const bad of ['', 'soon', '31 Feb 2021', '13/2020', 'Ma 2020', 'Foo 2020', '1499'])
      expect(parseDateInput(bad)).toBeNull();
  });
});

describe('open-ended ranges', () => {
  const day = (from: string | null, to: string | null) => ({ unit: 'd' as const, from, to });

  it('filter with a * for the open end', () => {
    expect(rangeFilter(day(null, '2020-05-01'), today)).toEqual({ eventDate: '*,2020-05-01' });
    expect(rangeFilter(day('2020-05-01', null), today)).toEqual({ eventDate: '2020-05-01,*' });
  });

  it('span from the first year, or to this year', () => {
    expect(rangeYears(day(null, '2020-05-01'), today)![0]).toBeLessThan(1900);
    expect(rangeYears(day('2020-05-01', null), today)).toEqual([2020, 2026]);
  });

  it('read as a label', () => {
    expect(rangeLabel(day('2020-05-01', '2020-05-01'))).toBe('1 May 2020');
    expect(rangeLabel(day('2020-05-01', null))).toBe('Since 1 May 2020');
    expect(rangeLabel(day(null, '2020-05-01'))).toBe('Up to 1 May 2020');
    expect(rangeLabel(day(null, null))).toBe('Any time');
  });
});
