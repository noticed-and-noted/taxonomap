import type { VernacularName } from '~/lib/gbif';

const ENGLISH = new Set(['eng', 'en']);

function tidy(s: string): string {
  const t = s.trim().replace(/\s+/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Most frequent English name (case-insensitive); a `preferred` flag wins. */
export function englishName(names: readonly VernacularName[]): string | null {
  const eng = names.filter((n) => n.language && ENGLISH.has(n.language) && n.vernacularName.trim());
  const preferred = eng.find((n) => n.preferred);
  if (preferred) return tidy(preferred.vernacularName);
  const tally = new Map<string, { name: string; n: number }>();
  for (const v of eng) {
    const k = v.vernacularName.trim().toLowerCase();
    const t = tally.get(k);
    if (t) {
      t.n++;
      // Keep the capitalised variant when there is one.
      if (/^[A-Z]/.test(v.vernacularName) && !/^[A-Z]/.test(t.name)) t.name = v.vernacularName.trim();
    } else tally.set(k, { name: v.vernacularName.trim(), n: 1 });
  }
  const best = [...tally.values()].sort((a, b) => b.n - a.n || a.name.length - b.name.length)[0];
  return best ? tidy(best.name) : null;
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

export function languageName(code: string | undefined): string {
  if (!code) return 'Other';
  const c = ISO3_TO_1[code] ?? code;
  try {
    displayNames ??= new Intl.DisplayNames(['en'], { type: 'language' });
    const n = displayNames.of(c);
    return n && n !== c ? n : code;
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
  for (const n of names) {
    const code = n.language || 'und';
    const set = groups.get(code) ?? new Set<string>();
    set.add(n.vernacularName.trim());
    groups.set(code, set);
  }
  return [...groups]
    .map(([code, set]) => ({
      code,
      language: languageName(code === 'und' ? undefined : code),
      names: [...set].slice(0, 6),
    }))
    .sort((a, b) =>
      a.code === 'eng'
        ? -1
        : b.code === 'eng'
          ? 1
          : b.names.length - a.names.length || a.language.localeCompare(b.language),
    )
    .slice(0, max);
}
