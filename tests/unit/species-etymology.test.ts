/** What each word of a scientific name means, read from Wiktionary's plain-text entries. */
import { stubNetwork } from './helpers/network';

const PLATYRHYNCHOS = `== Translingual ==

=== Alternative forms ===
platyrhynchus

=== Etymology ===
From Ancient Greek πλατύς (platús, “wide, flat”) and ῥύγχος (rhúnkhos, “snout, beak”).

=== Noun ===
platyrhynchos

a specific epithet for a flat-nosed organism`;

const ANAS = `== Translingual ==

=== Etymology ===
From Latin anas (“duck”), from Proto-Italic *anats, from Proto-Indo-European *h₂énh₂ts (“duck”).

=== Proper noun ===
Anas f

A taxonomic genus within the family Anatidae – many dabbling ducks.

== Latin ==

=== Etymology ===
This etymology is incomplete. You can help Wiktionary by elaborating on the origins of this term.`;

// A Translingual section with no etymology, so the Latin entry answers.
const LEO = `== Translingual ==

=== Symbol ===
leo

(international standards) ISO 639-3 language code for Mengisa.

== Latin ==

=== Etymology ===
Borrowed from Ancient Greek λέων (léōn).

=== Noun ===
leō m (genitive leōnis); third declension

lion
lion's skin`;

const OFFICINALE = `== Latin ==

=== Adjective ===
officīnāle

nominative/accusative/vocative neuter singular of officīnālis`;

const OFFICINALIS = `== Latin ==

=== Etymology ===
From officīna + -ālis.

=== Adjective ===
officīnālis (neuter officīnāle); third-declension two-termination adjective

(relational) workshop, laboratory, office
(botany) medicinal`;

const ENTRIES: Record<string, string> = {
  Anas: ANAS,
  platyrhynchos: PLATYRHYNCHOS,
  officinale: OFFICINALE,
  officinalis: OFFICINALIS,
};

async function load() {
  vi.resetModules();
  return import('~/lib/species/etymology');
}

afterEach(() => vi.unstubAllGlobals());

describe('readEntry', () => {
  it('reads a Translingual etymology: its source language and every gloss', async () => {
    const { readEntry } = await load();
    expect(readEntry(PLATYRHYNCHOS)).toEqual({ language: 'Ancient Greek', meanings: ['wide, flat', 'snout, beak'] });
  });

  it('keeps only the first clause of a chain of sources', async () => {
    const { readEntry } = await load();
    expect(readEntry(ANAS)).toEqual({ language: 'Latin', meanings: ['duck'] });
  });

  it('gives the glosses alone when the etymology names no source language', async () => {
    const { readEntry } = await load();
    const coined = '== Translingual ==\n\n=== Etymology ===\nCoined by Linnaeus (“little bird”).';
    expect(readEntry(coined)).toEqual({ meanings: ['little bird'] });
  });

  it('falls back to the first Latin definition', async () => {
    const { readEntry } = await load();
    expect(readEntry(LEO)).toEqual({ language: 'Latin', meanings: ['lion'] });
  });

  it('prefers the adjective sense, and skips place names', async () => {
    const { readEntry, lemmaOf } = await load();
    const regia = `== Latin ==\n\n=== Noun ===\nrēgia f\n\na royal palace\n\n=== Adjective ===\nrēgia\n\ninflection of rēgius:`;
    const orthosia = `== Latin ==\n\n=== Proper noun ===\nOrthosia f\n\na town in Phoenicia`;
    expect(readEntry(regia)).toBeNull();
    expect(lemmaOf(regia)).toBe('regius');
    expect(readEntry(orthosia)).toBeNull();
  });

  it('keeps the gloss an inflected form gives, and trims a dangling dash', async () => {
    const { readEntry } = await load();
    const minimus = `== Latin ==\n\n=== Adjective ===\nminimus\n\nsuperlative degree of parvus (“smallest”)`;
    const montanus = `== Latin ==\n\n=== Adjective ===\nmontānus\n\nof or pertaining to a mountain, especially—`;
    expect(readEntry(minimus)).toEqual({ language: 'Latin', meanings: ['smallest'] });
    expect(readEntry(montanus)?.meanings).toEqual(['of or pertaining to a mountain, especially']);
  });

  it('drops usage labels, and gives null for an inflected form or an empty entry', async () => {
    const { readEntry } = await load();
    expect(readEntry(OFFICINALIS)?.meanings).toEqual(['workshop, laboratory, office']);
    expect(readEntry(OFFICINALE)).toBeNull();
    expect(readEntry('')).toBeNull();
  });
});

describe('lemmaOf', () => {
  it('names the dictionary form of an inflected Latin entry, without vowel-length marks', async () => {
    const { lemmaOf } = await load();
    expect(lemmaOf(OFFICINALE)).toBe('officinalis');
    expect(lemmaOf(LEO)).toBeNull();
  });
});

describe('nameMeaning', () => {
  function wiktionary() {
    return stubNetwork((url) => {
      const title = url.searchParams.get('titles')!;
      return { query: { pages: title in ENTRIES ? [{ extract: ENTRIES[title] }] : [{ missing: true }] } };
    });
  }

  it('explains each word in order, linking each to its entry', async () => {
    const calls = wiktionary();
    const { nameMeaning } = await load();
    expect(await nameMeaning('Anas platyrhynchos')).toEqual([
      { word: 'Anas', language: 'Latin', meanings: ['duck'], url: 'https://en.wiktionary.org/wiki/Anas' },
      {
        word: 'platyrhynchos',
        language: 'Ancient Greek',
        meanings: ['wide, flat', 'snout, beak'],
        url: 'https://en.wiktionary.org/wiki/platyrhynchos',
      },
    ]);
    // Browsers may only call the API anonymously cross-origin with origin=*.
    expect(calls.every((call) => call.searchParams.get('origin') === '*')).toBe(true);
  });

  it('follows an inflected form to its dictionary form, and skips words it cannot explain', async () => {
    wiktionary();
    const { nameMeaning } = await load();
    expect(await nameMeaning('Taraxacum officinale')).toEqual([
      {
        word: 'officinale',
        language: 'Latin',
        meanings: ['workshop, laboratory, office'],
        url: 'https://en.wiktionary.org/wiki/officinalis',
      },
    ]);
  });

  it('skips hybrid marks, and gives null when no word is explained', async () => {
    const calls = wiktionary();
    const { nameMeaning } = await load();
    expect(await nameMeaning('Mentha × piperita')).toBeNull();
    expect(calls.map((call) => call.searchParams.get('titles'))).toEqual(['Mentha', 'piperita']);
  });
});
