/**
 * A taxon's English Wikipedia intro: the article's opening section, before
 * its first heading, as plain paragraphs. Found exactly, not by name:
 * Wikidata links GBIF taxon keys (property P846) to items, and an item to
 * its article, so a species with no article of its own gets none rather
 * than its genus's. Three small requests, one after another.
 *
 * Isomorphic like ./data: build time goes through the Node transport
 * (User-Agent, disk cache); the /species/view fallback calls it in the browser.
 */
import { createHttp, sharedTransport, type Http } from '~/lib/gbif/http';
import { DAY } from '~/lib/util/time';

export const WIKIDATA_ORIGIN = 'https://www.wikidata.org';
export const WIKIPEDIA_ORIGIN = 'https://en.wikipedia.org';

const API_PATH = '/w/api.php';
// origin=* is MediaWiki's opt-in for anonymous cross-origin requests from browsers.
const COMMON = { format: 'json', formatversion: 2, origin: '*' };

export interface WikipediaIntro {
  title: string;
  url: string;
  paragraphs: string[];
}

interface WikiClients {
  wikidata: Http;
  wikipedia: Http;
}

// Made on first use, so build time picks up the Node transport configured before it.
let clients: WikiClients | undefined;

function wikiClients(): WikiClients {
  const options = { transport: sharedTransport(), defaultTtlMs: DAY, cacheSize: 200 };
  clients ??= {
    wikidata: createHttp({ ...options, base: WIKIDATA_ORIGIN }),
    wikipedia: createHttp({ ...options, base: WIKIPEDIA_ORIGIN }),
  };
  return clients;
}

/** The Wikidata item (Q…) whose GBIF taxon ID is `key`, or null. */
async function itemFor(key: number): Promise<string | null> {
  const response = await wikiClients().wikidata.getJson<{ query: { search: { title: string }[] } }>(API_PATH, {
    action: 'query',
    list: 'search',
    srsearch: `haswbstatement:P846=${key}`,
    srlimit: 1,
    srprop: '',
    ...COMMON,
  });
  return response.query.search[0]?.title ?? null;
}

/** The item's English Wikipedia article, or null when it has none. */
async function articleFor(item: string): Promise<{ title: string; url: string } | null> {
  const response = await wikiClients().wikidata.getJson<{
    entities: Record<string, { sitelinks?: { enwiki?: { title: string; url: string } } }>;
  }>(API_PATH, { action: 'wbgetentities', ids: item, props: 'sitelinks/urls', sitefilter: 'enwiki', ...COMMON });
  return response.entities[item]?.sitelinks?.enwiki ?? null;
}

/** An article's opening section as plain text. */
async function introOf(title: string): Promise<string> {
  const response = await wikiClients().wikipedia.getJson<{ query: { pages: { extract?: string }[] } }>(API_PATH, {
    action: 'query',
    prop: 'extracts',
    exintro: 1,
    explaintext: 1,
    titles: title,
    ...COMMON,
  });
  return response.query.pages[0]?.extract ?? '';
}

// Plain-text extracts drop pronunciations and leave their brackets: "The mallard () or wild duck".
const EMPTY_BRACKETS = /\s*\(\s*[,;:]*\s*\)/g;

/** Plain-text paragraphs, without the blank lines between them or brackets left empty. */
export function paragraphsOf(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.replace(EMPTY_BRACKETS, '').trim())
    .filter(Boolean);
}

/**
 * The English Wikipedia intro for a GBIF taxon.
 * @returns Null when Wikidata has no item for the key, the item has no English article, or the intro is empty.
 * @throws GbifRequestError or GbifUnavailableError when Wikidata or Wikipedia fail (the shared client's errors).
 */
export async function wikipediaIntro(key: number): Promise<WikipediaIntro | null> {
  const item = await itemFor(key);
  const article = item && (await articleFor(item));
  if (!article) return null;
  const paragraphs = paragraphsOf(await introOf(article.title));
  return paragraphs.length ? { title: article.title, url: article.url, paragraphs } : null;
}

/**
 * A paragraph split around each mention of a scientific name, so the page can set the name in italics.
 * @returns Alternating runs; `isName` marks the mentions.
 */
export function nameRuns(text: string, name: string): { text: string; isName: boolean }[] {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text
    .split(new RegExp(`(${escaped})`))
    .filter(Boolean)
    .map((part) => ({ text: part, isName: part === name }));
}
