import { classificationOf } from '~/lib/species/data';
import { speciesPath } from '~/lib/species/links';
import { englishName, groupByLanguage, languageName, slugify } from '~/lib/species/names';

describe('species helpers', () => {
  it('slugifies scientific names', () => {
    expect(slugify('Erithacus rubecula')).toBe('erithacus-rubecula');
    expect(slugify('Æchmea × «hybrida» L.')).toBe('chmea-hybrida-l');
    expect(slugify('')).toBe('species');
  });

  it('links pre-rendered species to static pages and others to the fallback', () => {
    const manifest = { '2492462': 'erithacus-rubecula' };
    expect(speciesPath(2492462, manifest)).toBe('/species/2492462/erithacus-rubecula');
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
      englishName([name('robin'), name('European Robin'), name('european robin'), name('Rouge-gorge', 'fra')]),
    ).toBe('European Robin');
    // Preferred flags don't count: several checklists each flag their own pick.
    expect(englishName([name('Robin'), name('Robin'), name('Redbreast', 'eng', true)])).toBe('Robin');
    expect(englishName([name('Rouge-gorge', 'fra')])).toBeNull();
    // Equal counts: the capitalised variant, then the shorter name.
    expect(englishName([name('robin'), name('Robin'), name('Redbreast robin'), name('redbreast robin')])).toBe('Robin');
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
});
