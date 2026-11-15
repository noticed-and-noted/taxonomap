import { classificationOf, isAnimal } from '~/lib/species/data';
import { speciesPath } from '~/lib/species/links';
import { englishName, groupByLanguage, languageName, otherEnglishNames, slugify } from '~/lib/species/names';

/** A key with no IOC override, so names are picked by frequency. */
const ROBIN_KEY = 2492462;

/** Troglodytes troglodytes: "Winter Wren" is most frequent, IOC says "Eurasian Wren". */
const WREN_KEY = 5231438;

describe('species helpers', () => {
  it('slugifies scientific names', () => {
    expect(slugify('Erithacus rubecula')).toBe('erithacus-rubecula');
    expect(slugify('Æchmea × «hybrida» L.')).toBe('chmea-hybrida-l');
    expect(slugify('')).toBe('species');
  });

  it('links pre-rendered species to static pages and others to the fallback', () => {
    const manifest = { '2492462': 'erithacus-rubecula' };
    expect(speciesPath(2492462, manifest)).toBe('/species/2492462/erithacus-rubecula/');
    expect(speciesPath(1, manifest)).toBe('/species/view/1');
    expect(speciesPath(1, null)).toBe('/species/view/1');
  });

  it('picks the most common English name, preferring flagged names', () => {
    const name = (vernacularName: string, language = 'eng', preferred?: boolean) => ({
      vernacularName,
      language,
      ...(preferred !== undefined && { preferred }),
    });
    expect(
      englishName(
        [name('robin'), name('European Robin'), name('european robin'), name('Rouge-gorge', 'fra')],
        ROBIN_KEY,
      ),
    ).toBe('European Robin');
    // Preferred flags don't count: several checklists each flag their own pick.
    expect(englishName([name('Robin'), name('Robin'), name('Redbreast', 'eng', true)], ROBIN_KEY)).toBe('Robin');
    expect(englishName([name('Rouge-gorge', 'fra')], ROBIN_KEY)).toBeNull();
    // Equal counts: the capitalised variant, then the shorter name.
    expect(
      englishName([name('robin'), name('Robin'), name('Redbreast robin'), name('redbreast robin')], ROBIN_KEY),
    ).toBe('Robin');
    expect(englishName([name('VESPER BATS')], ROBIN_KEY)).toBe('Vesper bats');
  });

  it('uses the IOC name for birds where it differs from the most frequent one', () => {
    const wren = ['Winter Wren', 'Winter Wren', 'Eurasian Wren'].map((vernacularName) => ({
      vernacularName,
      language: 'eng',
    }));
    expect(englishName(wren, WREN_KEY)).toBe('Eurasian Wren');
    // The same name with no list at all, as when the vernacular request fails.
    expect(englishName([], WREN_KEY)).toBe('Eurasian Wren');
    expect(otherEnglishNames(wren, 4, WREN_KEY)).toEqual(['Winter Wren']);
    expect(englishName(wren, ROBIN_KEY)).toBe('Winter Wren');
  });

  it('lists the other English names, split, without notes or names that extend one already kept', () => {
    const english = (...names: string[]) => names.map((vernacularName) => ({ vernacularName, language: 'eng' }));
    const pigeon = english(
      'Rock Dove',
      'Rock Dove',
      'rock pigeon',
      'Feral Pigeon/Rock Dove',
      'Rock Pigeon (Feral Pigeon)',
      'Common Pigeon',
    );
    expect(otherEnglishNames(pigeon, 4, ROBIN_KEY)).toEqual(['Rock Pigeon', 'Feral Pigeon', 'Common Pigeon']);
    expect(otherEnglishNames(pigeon, 1, ROBIN_KEY)).toEqual(['Rock Pigeon']);
    expect(otherEnglishNames(english('Gull', 'Gulls', 'Indet. Gull', 'Seagull', 'Seagulls'), 4, ROBIN_KEY)).toEqual([
      'Seagull',
    ]);
    expect(otherEnglishNames([{ vernacularName: 'Goéland', language: 'fra' }], 4, ROBIN_KEY)).toEqual([]);
  });

  it('names languages, falling back to the code', () => {
    expect(languageName(undefined)).toBe('Other');
    expect(languageName('qqq')).toBe('qqq');
    expect(languageName('not a code')).toBe('not a code');
  });

  it('puts names without a language under Other, and orders ties by language', () => {
    const groups = groupByLanguage([
      { vernacularName: 'Robin', language: 'eng' },
      { vernacularName: 'Rotkehlchen', language: 'deu' },
      { vernacularName: 'Petirrojo', language: 'spa' },
      { vernacularName: 'Mystery' } as never,
    ]);
    expect(groups.map((group) => group.language)).toEqual(['English', 'German', 'Other', 'Spanish']);
  });

  it('sentence-cases names written all in capitals', () => {
    const groups = groupByLanguage([
      { vernacularName: 'VESPER BATS', language: 'eng' },
      { vernacularName: 'Glattnasen', language: 'deu' },
    ]);
    expect(groups.map((group) => group.names)).toEqual([['Vesper bats'], ['Glattnasen']]);
  });

  it('groups names by language with English first', () => {
    const groups = groupByLanguage([
      { vernacularName: 'Rotkehlchen', language: 'deu' },
      { vernacularName: 'Robin', language: 'eng' },
      { vernacularName: 'Rouge-gorge', language: 'fra' },
      { vernacularName: 'Rouge-gorge familier', language: 'fra' },
    ]);
    expect(groups[0]).toMatchObject({ code: 'eng', language: 'English' });
    expect(groups[1]).toMatchObject({
      code: 'fra',
      language: 'French',
      names: ['Rouge-gorge', 'Rouge-gorge familier'],
    });
    expect(languageName('cym')).toBe('Welsh');
  });

  it('drops names that differ only in case, keeping the capitalised one', () => {
    const groups = groupByLanguage([
      { vernacularName: 'european robin', language: 'eng' },
      { vernacularName: 'European Robin', language: 'eng' },
      { vernacularName: 'European robin', language: 'eng' },
    ]);
    expect(groups[0]?.names).toEqual(['European Robin']);
  });

  it('derives the classification from higher keys', () => {
    expect(
      classificationOf({
        key: 1,
        scientificName: 'x',
        rank: 'SPECIES',
        kingdom: 'Animalia',
        kingdomKey: 1,
        genus: 'Erithacus',
        genusKey: 2492460,
      }).map((taxon) => taxon.rank),
    ).toEqual(['KINGDOM', 'GENUS']);
  });

  it('counts only the animal kingdom as animal', () => {
    expect(isAnimal([{ key: 1, name: 'Animalia', rank: 'KINGDOM' }])).toBe(true);
    expect(isAnimal([{ key: 6, name: 'Plantae', rank: 'KINGDOM' }])).toBe(false);
    expect(isAnimal([])).toBe(false);
  });
});
