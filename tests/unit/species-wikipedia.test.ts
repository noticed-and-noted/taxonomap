/** A taxon's Wikipedia intro, found through Wikidata's GBIF taxon IDs, and its scientific name set apart. */
import { stubNetwork } from './helpers/network';

interface Wiki {
  /** GBIF key → Wikidata item. */
  items?: Record<number, string>;
  /** Wikidata item → its English article, or null for an item without one. */
  articles?: Record<string, { title: string; url: string } | null>;
  /** Article title → its intro text. */
  intros?: Record<string, string>;
}

function wiki({ items = {}, articles = {}, intros = {} }: Wiki) {
  return stubNetwork((url) => {
    const params = url.searchParams;
    if (url.host === 'www.wikidata.org' && params.get('list') === 'search') {
      const key = Number(params.get('srsearch')!.replace('haswbstatement:P846=', ''));
      return { query: { search: items[key] ? [{ title: items[key] }] : [] } };
    }
    if (url.host === 'www.wikidata.org' && params.get('action') === 'wbgetentities') {
      const item = params.get('ids')!;
      const article = articles[item];
      return { entities: { [item]: article ? { sitelinks: { enwiki: article } } : { sitelinks: {} } } };
    }
    if (url.host === 'en.wikipedia.org') {
      const title = params.get('titles')!;
      return { query: { pages: title in intros ? [{ extract: intros[title] }] : [{ missing: true }] } };
    }
    return undefined;
  });
}

const ROBIN_ARTICLE = { title: 'European robin', url: 'https://en.wikipedia.org/wiki/European_robin' };

async function load() {
  vi.resetModules();
  return import('~/lib/species/wikipedia');
}

afterEach(() => vi.unstubAllGlobals());

describe('wikipedia intro', () => {
  it('follows the GBIF key through Wikidata to the article, as paragraphs', async () => {
    const calls = wiki({
      items: { 2492462: 'Q25334' },
      articles: { Q25334: ROBIN_ARTICLE },
      intros: { 'European robin': 'The European robin is a bird.\n\n  It sings in winter.  \n' },
    });
    const { wikipediaIntro } = await load();
    expect(await wikipediaIntro(2492462)).toEqual({
      ...ROBIN_ARTICLE,
      paragraphs: ['The European robin is a bird.', 'It sings in winter.'],
    });
    expect(calls).toHaveLength(3);
    // Browsers may only call the APIs anonymously cross-origin with origin=*.
    expect(calls.every((call) => call.searchParams.get('origin') === '*')).toBe(true);
  });

  it('gives null when Wikidata has no item, the item has no article, or the intro is empty', async () => {
    wiki({
      items: { 1: 'Q1', 2: 'Q2', 3: 'Q3' },
      articles: { Q1: null, Q2: { title: 'Blank', url: 'u' }, Q3: { title: 'Gone', url: 'u' } },
      intros: { Blank: '\n\n' },
    });
    const { wikipediaIntro } = await load();
    expect(await wikipediaIntro(9)).toBeNull();
    expect(await wikipediaIntro(1)).toBeNull();
    expect(await wikipediaIntro(2)).toBeNull();
    expect(await wikipediaIntro(3)).toBeNull();
  });

  it('gives null when Wikidata returns an item without that entity', async () => {
    stubNetwork((url) =>
      url.searchParams.get('list') === 'search' ? { query: { search: [{ title: 'Q5' }] } } : { entities: {} },
    );
    const { wikipediaIntro } = await load();
    expect(await wikipediaIntro(5)).toBeNull();
  });
});

describe('paragraphs', () => {
  it('drops the brackets a removed pronunciation leaves, and keeps real ones', async () => {
    const { paragraphsOf } = await load();
    expect(paragraphsOf('The mallard () or wild duck ( ; Anas) is a duck (Anatidae).')).toEqual([
      'The mallard or wild duck ( ; Anas) is a duck (Anatidae).',
    ]);
    expect(paragraphsOf('The robin (; ) sings.')).toEqual(['The robin sings.']);
  });
});

describe('name runs', () => {
  it('splits a paragraph around each mention of the name', async () => {
    const { nameRuns } = await load();
    expect(nameRuns('Quercus robur, or Quercus robur L.', 'Quercus robur')).toEqual([
      { text: 'Quercus robur', isName: true },
      { text: ', or ', isName: false },
      { text: 'Quercus robur', isName: true },
      { text: ' L.', isName: false },
    ]);
  });

  it('treats the name literally, not as a pattern', async () => {
    const { nameRuns } = await load();
    expect(nameRuns('Quercus × rosacea (a hybrid)', 'Quercus × rosacea (a')).toEqual([
      { text: 'Quercus × rosacea (a', isName: true },
      { text: ' hybrid)', isName: false },
    ]);
    expect(nameRuns('No mention here.', 'Erithacus rubecula')).toEqual([{ text: 'No mention here.', isName: false }]);
  });
});
