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

const pad = (n: number) => String(n).padStart(2, '0');
export const isoDate = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** First day of the year, month or day that `iso` (or its key) falls in. */
export function startOf(iso: string, unit: DateUnit): string {
  const k = iso.slice(0, KEY_LENGTH[unit]);
  return unit === 'y' ? `${k}-01-01` : unit === 'm' ? `${k}-01` : k;
}

/** Last day of the year, month or day that `iso` (or its key) falls in. */
export function endOf(iso: string, unit: DateUnit): string {
  const k = iso.slice(0, KEY_LENGTH[unit]);
  if (unit === 'y') return `${k}-12-31`;
  if (unit === 'm') return `${k}-${pad(new Date(Number(k.slice(0, 4)), Number(k.slice(5, 7)), 0).getDate())}`;
  return k;
}

/** `today` moved back by a preset's span, clamped to the month's end (31 Mar − 1 month is 28/29 Feb). */
function presetStart(p: Preset, today: Date): string {
  const n = parseInt(p, 10);
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (p.endsWith('w')) d.setDate(d.getDate() - 7 * n);
  else {
    const day = d.getDate();
    if (p.endsWith('m')) d.setMonth(d.getMonth() - n);
    else d.setFullYear(d.getFullYear() - n);
    if (d.getDate() !== day) d.setDate(0);
  }
  return isoDate(d);
}

/** The range as concrete dates (presets roll with `today`); a null end is open. */
export function resolveRange(r: DateRange, today = new Date()): { from: string | null; to: string | null } {
  return 'preset' in r ? { from: presetStart(r.preset, today), to: isoDate(today) } : { from: r.from, to: r.to };
}

/** The GBIF filter fields for a range. */
export function rangeFilter(r: DateRange, today = new Date()): { year?: [number, number]; eventDate?: string } {
  if ('preset' in r || r.unit !== 'y') {
    const { from, to } = resolveRange(r, today);
    return { eventDate: `${from ?? '*'},${to ?? '*'}` };
  }
  return { year: rangeYears(r, today)! };
}

/** The years a range touches, for the year slider (null: no range). */
export function rangeYears(r: DateRange | null, today = new Date()): [number, number] | null {
  if (!r) return null;
  const { from, to } = resolveRange(r, today);
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
  const [y, m, d] = iso.split('-');
  if (unit === 'y') return y!;
  const month = MONTHS[Number(m) - 1];
  return unit === 'm' ? `${month} ${y}` : `${Number(d)} ${month} ${y}`;
}

export function rangeLabel(r: DateRange): string {
  if ('preset' in r) return PRESETS[r.preset];
  const a = r.from && formatDate(r.from, r.unit);
  const b = r.to && formatDate(r.to, r.unit);
  if (a && b) return a === b ? a : r.unit === 'y' ? `${a}–${b}` : `${a} – ${b}`;
  return a ? `Since ${a}` : b ? `Up to ${b}` : 'Any time';
}

/** A valid year, month or day key for `unit`, from MIN_YEAR on. */
export function validKey(k: string, unit: DateUnit): boolean {
  if (k.length !== KEY_LENGTH[unit] || !/^\d{4}(-\d{2}(-\d{2})?)?$/.test(k)) return false;
  if (Number(k.slice(0, 4)) < MIN_YEAR) return false;
  // Round-trips only for real dates (no 2021-02-30 or month 13).
  return isoDate(new Date(`${startOf(k, unit)}T00:00`)) === startOf(k, unit);
}

/**
 * A typed date as a year, month or day key, at the precision typed: "2020",
 * "Mar 2020", "12 March 2020", ISO "2020-03-12", or day-first "03/2020",
 * "12/03/2020". Null when it isn't a real date.
 */
export function parseDateInput(text: string): string | null {
  const t = text.trim().toLowerCase().replace(/,/g, ' ').replace(/\s+/g, ' ');
  let y: string | undefined;
  let m: string | undefined;
  let d: string | undefined;
  let r: RegExpExecArray | null;
  if ((r = /^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/.exec(t))) [, y, m, d] = r;
  else if ((r = /^(?:(\d{1,2})[/.])?(\d{1,2})[/.](\d{4})$/.exec(t))) [, d, m, y] = r;
  else if ((r = /^(?:(\d{1,2}) )?([a-z]{3,})\.? (\d{4})$/.exec(t))) {
    const name = r[2]!;
    const i = MONTH_NAMES.findIndex((n) => n.toLowerCase().startsWith(name));
    if (i < 0) return null;
    [d, m, y] = [r[1], String(i + 1), r[3]];
  } else return null;
  const key = [y, m && pad(Number(m)), d && m && pad(Number(d))].filter(Boolean).join('-');
  return validKey(key, keyUnit(key)) ? key : null;
}

/** The unit a key is at, from its length. */
export const keyUnit = (key: string): DateUnit => (key.length === 4 ? 'y' : key.length === 7 ? 'm' : 'd');

/** URL form: a preset ("5y") or "unit:from..to" with keys at the unit's length ("y:2020..2022", "d:2019-03-12.."). */
export function parseRange(raw: string): DateRange | undefined {
  if (raw in PRESETS) return { preset: raw as Preset };
  const m = /^([ymd]):([\d-]*)\.\.([\d-]*)$/.exec(raw);
  if (!m) return undefined;
  const unit = m[1] as DateUnit;
  let [a, b] = [m[2]!, m[3]!];
  if ((a && !validKey(a, unit)) || (b && !validKey(b, unit)) || (!a && !b)) return undefined;
  if (a && b && a > b) [a, b] = [b, a];
  return { unit, from: a ? startOf(a, unit) : null, to: b ? endOf(b, unit) : null };
}

export function serializeRange(r: DateRange): string {
  if ('preset' in r) return r.preset;
  const n = KEY_LENGTH[r.unit];
  return `${r.unit}:${r.from?.slice(0, n) ?? ''}..${r.to?.slice(0, n) ?? ''}`;
}
