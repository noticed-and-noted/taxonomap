import { capitalise } from '~/lib/format';
import type { VernacularName } from '~/lib/gbif';

const ENGLISH = new Set(['eng', 'en']);

function tidy(text: string): string {
  return capitalise(text.trim().replace(/\s+/g, ' '));
}

/** True for a non-blank English name. */
export function isEnglish(name: VernacularName): boolean {
  return Boolean(name.language && ENGLISH.has(name.language) && name.vernacularName.trim());
}

/**
 * Most frequent English name (case-insensitive). `preferred` flags are ignored: many checklists
 * each flag their own pick, and search results carry no flags, so counting is what gives the
 * same name wherever the list came from.
 */
export function englishName(names: readonly VernacularName[]): string | null {
  const best = byFrequency(names.filter(isEnglish).map((name) => name.vernacularName))[0];
  return best ? tidy(best) : null;
}

/** Distinct names (case-insensitive), most frequent first, then shortest. */
function byFrequency(texts: readonly string[]): string[] {
  const tally = new Map<string, { name: string; n: number }>();
  for (const text of texts) {
    const trimmed = text.trim();
    const lowered = trimmed.toLowerCase();
    const tallyEntry = tally.get(lowered);
    if (tallyEntry) {
      tallyEntry.n++;
      // Keep the capitalised variant when there is one.
      if (/^[A-Z]/.test(trimmed) && !/^[A-Z]/.test(tallyEntry.name)) tallyEntry.name = trimmed;
    } else tally.set(lowered, { name: trimmed, n: 1 });
  }
  return [...tally.values()]
    .sort((left, right) => right.n - left.n || left.name.length - right.name.length)
    .map((entry) => entry.name);
}

/** Splits combined names such as "Feral Pigeon/Rock Dove" and "Rock Pigeon (Feral Pigeon)". */
const COMBINED_NAME_SEPARATORS = /[/()]/;

/** Names with this in them are notes, not names ("Indet. Gull"). */
const NOTE_MARKER = '.';

/**
 * The other English names worth searching by, most frequent first, after `englishName`'s pick.
 * A name that extends one already kept ("Gulls" after "Gull") is dropped, since prefix search finds it anyway.
 * @param max Most names to return.
 */
export function otherEnglishNames(names: readonly VernacularName[], max: number): string[] {
  const main = englishName(names);
  if (!main) return [];
  const parts = names
    .filter(isEnglish)
    .flatMap((name) => name.vernacularName.split(COMBINED_NAME_SEPARATORS))
    .filter((part) => part.trim() && !part.includes(NOTE_MARKER));
  const kept = [main.toLowerCase()];
  const others: string[] = [];
  for (const name of byFrequency(parts)) {
    if (others.length >= max) break;
    const lowered = tidy(name).toLowerCase();
    if (kept.some((keptName) => lowered.startsWith(keptName))) continue;
    kept.push(lowered);
    others.push(tidy(name));
  }
  return others;
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
  // Keyed by lower case so "Robin" and "robin" show once, keeping the capitalised variant.
  const groups = new Map<string, Map<string, string>>();
  for (const name of names) {
    const code = name.language || 'und';
    const variants = groups.get(code) ?? new Map<string, string>();
    const trimmed = name.vernacularName.trim();
    const lowered = trimmed.toLowerCase();
    const seen = variants.get(lowered);
    if (!seen || (/^[A-Z]/.test(trimmed) && !/^[A-Z]/.test(seen))) variants.set(lowered, trimmed);
    groups.set(code, variants);
  }
  return [...groups]
    .map(([code, variants]) => ({
      code,
      language: languageName(code === 'und' ? undefined : code),
      names: [...variants.values()].slice(0, 6),
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
