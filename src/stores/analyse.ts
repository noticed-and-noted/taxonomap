/**
 * Analyse mode's choices, in the URL so an analysis can be shared: the species (`ak`), the view (`av`, Migration or
 * Spread), the years included (`ayr`, its own range, apart from the When filter), Migration's month (`am`) and
 * Spread's year (`ay`).
 */
import { $fitOnSearch } from './fit-search';
import { flyToRecords } from './fly-to-taxa';
import { codecs, urlAtom, type UrlCodec } from './url-sync';

export const ANALYSE_VIEWS = ['migration', 'spread'] as const;
export type AnalyseView = (typeof ANALYSE_VIEWS)[number];

/** The earliest year Analyse offers: older records are too few and too patchy to show a pattern. */
export const ANALYSE_FIRST_YEAR = 2000;

/** Years included, first and last; null is every year Analyse offers. */
export type YearSpan = readonly [first: number, last: number] | null;

/** The last year Analyse offers: this one. */
export function analyseLastYear(): number {
  return new Date().getFullYear();
}

/** Clamps a span to the years Analyse offers, or null when it covers them all. */
export function clampYears(first: number, last: number): YearSpan {
  const lastYear = analyseLastYear();
  const from = Math.min(Math.max(first, ANALYSE_FIRST_YEAR), lastYear);
  const to = Math.min(Math.max(last, from), lastYear);
  return from === ANALYSE_FIRST_YEAR && to === lastYear ? null : [from, to];
}

const yearsCodec: UrlCodec<YearSpan> = {
  key: 'ayr',
  default: null,
  scope: 'map',
  history: 'replace',
  parse(raw) {
    const match = /^(\d{4})-(\d{4})$/.exec(raw);
    if (!match) return undefined;
    return clampYears(Number(match[1]), Number(match[2]));
  },
  // Never asked for the default (null): it is left out of the URL.
  serialize: (span) => `${span![0]}-${span![1]}`,
};

const monthCodec: UrlCodec<number> = {
  key: 'am',
  default: 1,
  scope: 'map',
  history: 'replace',
  parse: (raw) => (/^(?:[1-9]|1[0-2])$/.test(raw) ? Number(raw) : undefined),
  serialize: (month) => String(month),
};

const yearCodec: UrlCodec<number | null> = {
  key: 'ay',
  default: null,
  scope: 'map',
  history: 'replace',
  parse: (raw) => (/^\d{4}$/.test(raw) ? Number(raw) : undefined),
  // Never asked for the default (null): it is left out of the URL.
  serialize: (year) => String(year),
};

/** The species being analysed, by GBIF key; null shows the picker. */
export const $analyseTaxon = urlAtom(codecs.int('ak', null, { scope: 'map' }));
export const $analyseView = urlAtom(codecs.enumOf('av', ANALYSE_VIEWS, 'migration', { scope: 'map' }));
export const $analyseYears = urlAtom(yearsCodec);
/** Migration's month, 1 (January) to 12. */
export const $analyseMonth = urlAtom(monthCodec);
/** Spread's year; null is the last year included. */
export const $analyseYear = urlAtom(yearCodec);

/** The years a span covers, filling in every year Analyse offers for null. */
export function yearsIncluded(span: YearSpan): readonly [number, number] {
  return span ?? [ANALYSE_FIRST_YEAR, analyseLastYear()];
}

/** Picks a species and the view to open it in, and moves the map to its records when search does too. */
export function analyseSpecies(key: number, view: AnalyseView): void {
  $analyseTaxon.set(key);
  $analyseView.set(view);
  if ($fitOnSearch.get()) void flyToRecords({ taxonKey: key, year: yearsIncluded($analyseYears.get()) });
}

/** Drops Analyse's choices, so leaving it leaves nothing of it in the URL. */
export function resetAnalyse(): void {
  $analyseTaxon.set(null);
  $analyseView.set('migration');
  $analyseYears.set(null);
  $analyseMonth.set(monthCodec.default);
  $analyseYear.set(null);
}
