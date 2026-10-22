import { capitalise } from '~/lib/format';
import type { VernacularName } from '~/lib/gbif';

const ENGLISH = new Set(['eng', 'en']);

function tidy(text: string): string {
  return capitalise(text.trim().replace(/\s+/g, ' '));
}

/** A matching name is shown instead of the main one when it is at least this share as common. */
const COMMON_MATCH_SHARE = 0.5;

interface NameTally {
  name: string;
  count: number;
}

/** Distinct names (case-insensitive) with how often each appears, most frequent then shortest first. */
function tallyNames(names: readonly VernacularName[]): NameTally[] {
  const tally = new Map<string, NameTally>();
  for (const name of names) {
    const lowered = name.vernacularName.trim().toLowerCase();
    const tallyEntry = tally.get(lowered);
    if (tallyEntry) {
      tallyEntry.count++;
      // Keep the capitalised variant when there is one.
      if (/^[A-Z]/.test(name.vernacularName) && !/^[A-Z]/.test(tallyEntry.name))
        tallyEntry.name = name.vernacularName.trim();
    } else tally.set(lowered, { name: name.vernacularName.trim(), count: 1 });
  }
  return [...tally.values()].sort((left, right) => right.count - left.count || left.name.length - right.name.length);
}

/**
 * Most frequent English name (case-insensitive); a `preferred` flag wins.
 * @param isWanted Picks a name to show instead (e.g. one matching a search) when it is about as common
 *   as the top name, so "Rock pigeon" beats an equally common "Rock dove" but one old alias doesn't win.
 */
export function englishName(names: readonly VernacularName[], isWanted?: (name: string) => boolean): string | null {
  const eng = names.filter((name) => name.language && ENGLISH.has(name.language) && name.vernacularName.trim());
  const tally = tallyNames(eng);
  const wanted = isWanted && tally.find((entry) => isWanted(entry.name));
  if (wanted && tally[0] && wanted.count >= tally[0].count * COMMON_MATCH_SHARE) return tidy(wanted.name);
  const preferred = eng.find((name) => name.preferred);
  if (preferred) return tidy(preferred.vernacularName);
  return tally[0] ? tidy(tally[0].name) : null;
}

/** URL slug from a scientific name: "Erithacus rubecula" → "erithacus-rubecula". */
export function slugify(name: string): string {
  return (
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'species'
  );
}

/** ISO 639-3 → 639-1 for the languages GBIF lists most often (Intl prefers 2-letter codes). */
const ISO3_TO_1: Record<string, string> = {
  eng: 'en',
  fra: 'fr',
  deu: 'de',
  spa: 'es',
  por: 'pt',
  ita: 'it',
  nld: 'nl',
  swe: 'sv',
  nor: 'no',
  nob: 'nb',
  nno: 'nn',
  dan: 'da',
  fin: 'fi',
  isl: 'is',
  pol: 'pl',
  ces: 'cs',
  slk: 'sk',
  slv: 'sl',
  hrv: 'hr',
  srp: 'sr',
  bos: 'bs',
  hun: 'hu',
  ron: 'ro',
  bul: 'bg',
  ell: 'el',
  tur: 'tr',
  rus: 'ru',
  ukr: 'uk',
  bel: 'be',
  lit: 'lt',
  lav: 'lv',
  est: 'et',
  gle: 'ga',
  cym: 'cy',
  gla: 'gd',
  eus: 'eu',
  cat: 'ca',
  glg: 'gl',
  zho: 'zh',
  jpn: 'ja',
  kor: 'ko',
  ara: 'ar',
  heb: 'he',
  fas: 'fa',
  hin: 'hi',
  ben: 'bn',
  tam: 'ta',
  tel: 'te',
  mar: 'mr',
  urd: 'ur',
  tha: 'th',
  vie: 'vi',
  ind: 'id',
  msa: 'ms',
  tgl: 'tl',
  swa: 'sw',
  afr: 'af',
  zul: 'zu',
  xho: 'xh',
  amh: 'am',
  epo: 'eo',
  lat: 'la',
  mlt: 'mt',
  ltz: 'lb',
  fao: 'fo',
  sme: 'se',
  kaz: 'kk',
  uzb: 'uz',
  aze: 'az',
  kat: 'ka',
  hye: 'hy',
  mon: 'mn',
  nep: 'ne',
  sin: 'si',
  khm: 'km',
  lao: 'lo',
  mya: 'my',
  mri: 'mi',
  haw: 'haw',
};

let displayNames: Intl.DisplayNames | null | undefined;

/** English name of a language code (ISO 639-1 or -3); "Other" for none, the code itself if unknown. */
export function languageName(code: string | undefined): string {
  if (!code) return 'Other';
  const isoCode = ISO3_TO_1[code] ?? code;
  try {
    displayNames ??= new Intl.DisplayNames(['en'], { type: 'language' });
    const label = displayNames.of(isoCode);
    return label && label !== isoCode ? label : code;
  } catch {
    return code;
  }
}

export interface NamesByLanguage {
  language: string;
  code: string;
  names: string[];
}

/** Group vernacular names by language: English first, then by name count. */
export function groupByLanguage(names: readonly VernacularName[], max = 40): NamesByLanguage[] {
  const groups = new Map<string, Set<string>>();
  for (const name of names) {
    const code = name.language || 'und';
    const set = groups.get(code) ?? new Set<string>();
    set.add(name.vernacularName.trim());
    groups.set(code, set);
  }
  return [...groups]
    .map(([code, set]) => ({
      code,
      language: languageName(code === 'und' ? undefined : code),
      names: [...set].slice(0, 6),
    }))
    .sort((left, right) =>
      left.code === 'eng'
        ? -1
        : right.code === 'eng'
          ? 1
          : right.names.length - left.names.length || left.language.localeCompare(right.language),
    )
    .slice(0, max);
}
