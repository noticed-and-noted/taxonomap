/**
 * The When filter's date range: a rolling preset ("last 5 years") or a fixed
 * range picked by year, month or day. Dates are ISO "YYYY-MM-DD" strings, so
 * they compare as strings and go to GBIF unchanged.
 *
 * Whole years filter with `year` (cheap density map tiles); anything finer
 * needs `eventDate`, which only the adhoc tiles honour.
 */
import { MONTH_NAMES, MONTHS } from './format';

export type DateUnit = 'y' | 'm' | 'd';

export const PRESETS = {
  '1w': 'Last week',
  '1m': 'Last month',
  '1y': 'Last year',
  '2y': 'Last 2 years',
  '5y': 'Last 5 years',
  '10y': 'Last 10 years',
  '100y': 'Last 100 years',
} as const;
export type Preset = keyof typeof PRESETS;

export type DateRange = { preset: Preset } | { unit: DateUnit; from: string | null; to: string | null };

/** GBIF rejects interpreted dates before 1500. */
export const MIN_YEAR = 1500;

/** Length of a year, month or day key ("2020", "2020-03", "2020-03-12"). */
export const KEY_LENGTH: Record<DateUnit, number> = { y: 4, m: 7, d: 10 };

const pad = (value: number) => String(value).padStart(2, '0');
/** A date as `YYYY-MM-DD` in local time. */
export const isoDate = (date: Date): string =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** First day of the year, month or day that `iso` (or its key) falls in. */
export function startOf(iso: string, unit: DateUnit): string {
  const key = iso.slice(0, KEY_LENGTH[unit]);
  return unit === 'y' ? `${key}-01-01` : unit === 'm' ? `${key}-01` : key;
}

/** Last day of the year, month or day that `iso` (or its key) falls in. */
export function endOf(iso: string, unit: DateUnit): string {
  const key = iso.slice(0, KEY_LENGTH[unit]);
  if (unit === 'y') return `${key}-12-31`;
  if (unit === 'm') return `${key}-${pad(new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)), 0).getDate())}`;
  return key;
}

/** `today` moved back by a preset's span, clamped to the month's end (31 Mar − 1 month is 28/29 Feb). */
function presetStart(preset: Preset, today: Date): string {
  const days = parseInt(preset, 10);
  const date = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (preset.endsWith('w')) date.setDate(date.getDate() - 7 * days);
  else {
    const day = date.getDate();
    if (preset.endsWith('m')) date.setMonth(date.getMonth() - days);
    else date.setFullYear(date.getFullYear() - days);
    if (date.getDate() !== day) date.setDate(0);
  }
  return isoDate(date);
}

/** The range as concrete dates (presets roll with `today`); a null end is open. */
export function resolveRange(range: DateRange, today = new Date()): { from: string | null; to: string | null } {
  return 'preset' in range
    ? { from: presetStart(range.preset, today), to: isoDate(today) }
    : { from: range.from, to: range.to };
}

/** The GBIF filter fields for a range. */
export function rangeFilter(range: DateRange, today = new Date()): { year?: [number, number]; eventDate?: string } {
  if ('preset' in range || range.unit !== 'y') {
    const { from, to } = resolveRange(range, today);
    return { eventDate: `${from ?? '*'},${to ?? '*'}` };
  }
  return { year: rangeYears(range, today)! };
}

/** The years a range touches, for the year slider (null: no range). */
export function rangeYears(range: DateRange | null, today = new Date()): [number, number] | null {
  if (!range) return null;
  const { from, to } = resolveRange(range, today);
  return [from ? Number(from.slice(0, 4)) : MIN_YEAR, to ? Number(to.slice(0, 4)) : today.getFullYear()];
}

/** A whole-years range, as the year slider sets it. */
export const yearsRange = (from: number, to: number): DateRange => ({
  unit: 'y',
  from: `${Math.min(from, to)}-01-01`,
  to: `${Math.max(from, to)}-12-31`,
});

/** "2020", "Mar 2020" or "12 Mar 2020". */
export function formatDate(iso: string, unit: DateUnit): string {
  const [yearPart, monthPart, dayPart] = iso.split('-');
  if (unit === 'y') return yearPart!;
  const month = MONTHS[Number(monthPart) - 1];
  return unit === 'm' ? `${month} ${yearPart}` : `${Number(dayPart)} ${month} ${yearPart}`;
}

/** Human-readable label for a range, e.g. "1990–2000". */
export function rangeLabel(range: DateRange): string {
  if ('preset' in range) return PRESETS[range.preset];
  const fromLabel = range.from && formatDate(range.from, range.unit);
  const toLabel = range.to && formatDate(range.to, range.unit);
  if (fromLabel && toLabel)
    return fromLabel === toLabel
      ? fromLabel
      : range.unit === 'y'
        ? `${fromLabel}–${toLabel}`
        : `${fromLabel} – ${toLabel}`;
  return fromLabel ? `Since ${fromLabel}` : toLabel ? `Up to ${toLabel}` : 'Any time';
}

/** A valid year, month or day key for `unit`, from MIN_YEAR on. */
export function validKey(key: string, unit: DateUnit): boolean {
  if (key.length !== KEY_LENGTH[unit] || !/^\d{4}(-\d{2}(-\d{2})?)?$/.test(key)) return false;
  if (Number(key.slice(0, 4)) < MIN_YEAR) return false;
  // Round-trips only for real dates (no 2021-02-30 or month 13).
  return isoDate(new Date(`${startOf(key, unit)}T00:00`)) === startOf(key, unit);
}

/**
 * A typed date as a year, month or day key, at the precision typed: "2020",
 * "Mar 2020", "12 March 2020", ISO "2020-03-12", or day-first "03/2020",
 * "12/03/2020". Null when it isn't a real date.
 */
export function parseDateInput(text: string): string | null {
  const normalised = text.trim().toLowerCase().replace(/,/g, ' ').replace(/\s+/g, ' ');
  let year: string | undefined;
  let month: string | undefined;
  let day: string | undefined;
  let match: RegExpExecArray | null;
  if ((match = /^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/.exec(normalised))) [, year, month, day] = match;
  else if ((match = /^(?:(\d{1,2})[/.])?(\d{1,2})[/.](\d{4})$/.exec(normalised))) [, day, month, year] = match;
  else if ((match = /^(?:(\d{1,2}) )?([a-z]{3,})\.? (\d{4})$/.exec(normalised))) {
    const name = match[2]!;
    const monthIndex = MONTH_NAMES.findIndex((monthName) => monthName.toLowerCase().startsWith(name));
    if (monthIndex < 0) return null;
    [day, month, year] = [match[1], String(monthIndex + 1), match[3]];
  } else return null;
  const key = [year, month && pad(Number(month)), day && month && pad(Number(day))].filter(Boolean).join('-');
  return validKey(key, keyUnit(key)) ? key : null;
}

/** The unit a key is at, from its length. */
export const keyUnit = (key: string): DateUnit => (key.length === 4 ? 'y' : key.length === 7 ? 'm' : 'd');

/** URL form: a preset ("5y") or "unit:from..to" with keys at the unit's length ("y:2020..2022", "d:2019-03-12.."). */
export function parseRange(raw: string): DateRange | undefined {
  if (raw in PRESETS) return { preset: raw as Preset };
  const match = /^([ymd]):([\d-]*)\.\.([\d-]*)$/.exec(raw);
  if (!match) return undefined;
  const unit = match[1] as DateUnit;
  let [start, end] = [match[2]!, match[3]!];
  if ((start && !validKey(start, unit)) || (end && !validKey(end, unit)) || (!start && !end)) return undefined;
  if (start && end && start > end) [start, end] = [end, start];
  return { unit, from: start ? startOf(start, unit) : null, to: end ? endOf(end, unit) : null };
}

/** The URL form of a range: its preset name, or `unit:from..to`. */
export function serializeRange(range: DateRange): string {
  if ('preset' in range) return range.preset;
  const keyLength = KEY_LENGTH[range.unit];
  return `${range.unit}:${range.from?.slice(0, keyLength) ?? ''}..${range.to?.slice(0, keyLength) ?? ''}`;
}
