/**
 * What each word of a scientific name means, from English Wiktionary. Its
 * "Translingual" entries cover taxonomic words (genus names, many epithets)
 * and say where they come from; failing that, the word's Latin entry gives
 * its plain meaning. One request per word, plus one when the Latin entry is
 * an inflected form (officinale → officinalis).
 *
 * Isomorphic like ./wikipedia: build time goes through the Node transport;
 * the /species/view fallback calls it in the browser.
 */
import { createHttp, sharedTransport, type Http } from '~/lib/gbif/http';
import { DAY } from '~/lib/util/time';

export const WIKTIONARY_ORIGIN = 'https://en.wiktionary.org';

const API_PATH = '/w/api.php';
// origin=* is MediaWiki's opt-in for anonymous cross-origin requests from browsers.
const COMMON = { format: 'json', formatversion: 2, origin: '*' };

const LANGUAGE_HEADING = /^== (.+) ==$/;
const ETYMOLOGY_HEADING = /^={3,4} Etymology( \d+)? ={3,4}$/;
const DEFINITION_HEADING = /^={3,4} (Noun|Proper noun|Adjective|Participle|Verb) ={3,4}$/;
const ANY_HEADING = /^={2,} .+ ={2,}$/;
// Wiktionary's own notes on an unfinished etymology, not part of it.
const PLACEHOLDER = /etymology is (missing|incomplete)/i;
const GLOSS = /“([^”]+)”/g;
// "From Latin anas (“duck”), from Proto-Italic …": only the first clause with a gloss is the word's source.
const CLAUSE_BREAK = /,\s*(?=from\b)/i;
const SOURCE_LANGUAGE = /\bfrom ((?:Ancient |Medieval |New |Late |Classical )?(?:Greek|Latin))\b/i;
// Usage labels such as "(botany)" or "(relational)" before a definition.
const LEADING_LABELS = /^(\([^)]*\)\s*)+/;
const FORM_OF = /\b(?:singular|plural) of (\p{L}+)\.?$/u;
const NAME_WORD = /^\p{L}+$/u;

/** One word of a scientific name and what it means. */
export interface NamePart {
  word: string;
  /** The language it comes from, when Wiktionary says. */
  language?: string;
  meanings: string[];
  url: string;
}

type WordMeaning = Pick<NamePart, 'language' | 'meanings'>;

// Made on first use, so build time picks up the Node transport configured before it.
let client: Http | undefined;

function wiktionary(): Http {
  client ??= createHttp({
    transport: sharedTransport(),
    defaultTtlMs: DAY,
    cacheSize: 200,
    base: WIKTIONARY_ORIGIN,
  });
  return client;
}

/** A Wiktionary entry as plain text, with "== Language ==" headings; empty when there is none. */
async function entryText(title: string): Promise<string> {
  const response = await wiktionary().getJson<{ query: { pages: { extract?: string }[] } }>(API_PATH, {
    action: 'query',
    prop: 'extracts',
    explaintext: 1,
    exsectionformat: 'wiki',
    redirects: 1,
    titles: title,
    ...COMMON,
  });
  return response.query.pages[0]?.extract ?? '';
}

/** The lines of one language's section of an entry, or an empty list when it has none. */
function languageSection(entry: string, language: string): string[] {
  const lines = entry.split('\n').map((line) => line.trim());
  const start = lines.findIndex((line) => line === `== ${language} ==`);
  if (start < 0) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => LANGUAGE_HEADING.test(line));
  return end < 0 ? rest : rest.slice(0, end);
}

/** The non-empty lines under the first heading matching `heading`, up to the next heading. */
function linesUnder(section: string[], heading: RegExp): string[] {
  const start = section.findIndex((line) => heading.test(line));
  if (start < 0) return [];
  const rest = section.slice(start + 1);
  const end = rest.findIndex((line) => ANY_HEADING.test(line));
  return (end < 0 ? rest : rest.slice(0, end)).filter(Boolean);
}

/** Where a taxonomic word comes from, read from its Translingual etymology. */
function fromEtymology(section: string[]): WordMeaning | null {
  const etymology = linesUnder(section, ETYMOLOGY_HEADING).find((line) => !PLACEHOLDER.test(line));
  const clause = etymology?.split(CLAUSE_BREAK).find((part) => part.includes('“'));
  if (!clause) return null;

  const meanings = Array.from(clause.matchAll(GLOSS), ([, gloss]) => gloss ?? '').filter(Boolean);
  const language = clause.match(SOURCE_LANGUAGE)?.[1];
  return language ? { language, meanings } : { meanings };
}

/** A Latin entry's first definition: the line after its headword. */
function firstDefinition(section: string[]): string | undefined {
  return linesUnder(section, DEFINITION_HEADING)[1];
}

/**
 * What a Wiktionary entry says its word means.
 * @param entry The entry's plain text, as the extracts API gives it with `exsectionformat=wiki`.
 * @returns Null when the entry has no usable etymology or Latin definition (an inflected form among them).
 */
export function readEntry(entry: string): WordMeaning | null {
  const translingual = fromEtymology(languageSection(entry, 'Translingual'));
  if (translingual) return translingual;

  const definition = firstDefinition(languageSection(entry, 'Latin'));
  if (!definition || FORM_OF.test(definition)) return null;
  return { language: 'Latin', meanings: [definition.replace(LEADING_LABELS, '')] };
}

/**
 * The Latin word an inflected entry is a form of, without its vowel-length marks, as Wiktionary titles it.
 * @returns Null when the entry's first Latin definition isn't an inflected form.
 */
export function lemmaOf(entry: string): string | null {
  const lemma = firstDefinition(languageSection(entry, 'Latin'))?.match(FORM_OF)?.[1];
  return lemma ? lemma.normalize('NFD').replace(/\p{M}/gu, '') : null;
}

const pageUrl = (title: string) => `${WIKTIONARY_ORIGIN}/wiki/${encodeURIComponent(title)}`;

/** One word's meaning, following an inflected Latin form to its dictionary form once. */
async function partFor(word: string): Promise<NamePart | null> {
  const entry = await entryText(word);
  const meaning = readEntry(entry);
  if (meaning) return { word, ...meaning, url: pageUrl(word) };

  const lemma = lemmaOf(entry);
  const lemmaMeaning = lemma ? readEntry(await entryText(lemma)) : null;
  return lemma && lemmaMeaning ? { word, ...lemmaMeaning, url: pageUrl(lemma) } : null;
}

/**
 * What each word of a scientific name means, in the name's order.
 * @param canonicalName The name without authorship ("Anas platyrhynchos"); hybrid marks are skipped.
 * @returns Null when Wiktionary explains none of the words.
 * @throws GbifRequestError or GbifUnavailableError when Wiktionary fails (the shared client's errors).
 */
export async function nameMeaning(canonicalName: string): Promise<NamePart[] | null> {
  const words = canonicalName.split(/\s+/).filter((word) => NAME_WORD.test(word));
  const parts = await Promise.all(words.map(partFor));
  const found = parts.filter((part): part is NamePart => part !== null);
  return found.length ? found : null;
}
