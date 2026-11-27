/**
 * Analyse mode's choices, in the URL so an analysis can be shared: the species (`ak`), the view (`av`, Migration or
 * Spread) and the years included (`ayr`, its own range, apart from the When filter).
 */
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

/** The species being analysed, by GBIF key; null shows the picker. */
export const $analyseTaxon = urlAtom(codecs.int('ak', null, { scope: 'map' }));
export const $analyseView = urlAtom(codecs.enumOf('av', ANALYSE_VIEWS, 'migration', { scope: 'map' }));
export const $analyseYears = urlAtom(yearsCodec);

/** Picks a species and the view to open it in. */
export function analyseSpecies(key: number, view: AnalyseView): void {
  $analyseTaxon.set(key);
  $analyseView.set(view);
}

/** Drops Analyse's choices, so leaving it leaves nothing of it in the URL. */
export function resetAnalyse(): void {
  $analyseTaxon.set(null);
  $analyseView.set('migration');
  $analyseYears.set(null);
}
