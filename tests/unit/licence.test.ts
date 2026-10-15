import { parseLicence, usableImages } from '~/lib/gbif/licence';
import type { Occurrence } from '~/lib/gbif/types';

describe('licence', () => {
  it.each([
    ['http://creativecommons.org/licenses/by/4.0/legalcode', 'CC-BY'],
    ['https://creativecommons.org/licenses/by-nc/4.0/', 'CC-BY-NC'],
    ['http://creativecommons.org/publicdomain/zero/1.0/legalcode', 'CC0'],
    ['CC_BY_4_0', 'CC-BY'],
    ['CC_BY_NC_4_0', 'CC-BY-NC'],
    ['CC0_1_0', 'CC0'],
    ['CC BY-NC 4.0', 'CC-BY-NC'],
    ['https://creativecommons.org/licenses/by-sa/4.0/', 'CC-BY-SA'],
    ['https://creativecommons.org/licenses/by-nd/3.0/', 'CC-BY-ND'],
    ['https://creativecommons.org/licenses/by-nc-nd/4.0/', 'CC-BY-NC-ND'],
    ['http://creativecommons.org/licenses/by-nd-nc/1.0/', 'CC-BY-NC-ND'],
    ['cc-by-nc-sa', 'CC-BY-NC-SA'],
    ['CC BY-SA 4.0', 'CC-BY-SA'],
    ['https://creativecommons.org/publicdomain/mark/1.0/', null],
    ['Copyright', null],
    ['Copyright by the creator. For license and creator details, see https://example.org', null],
    ['', null],
  ])('parses %j → %s', (raw, expected) => {
    expect(parseLicence(raw)).toBe(expected);
  });

  const occ = (license: string, media: NonNullable<Occurrence['media']>): Occurrence => ({
    key: 1,
    datasetKey: 'd',
    license,
    publisher: 'Pub',
    media,
  });

  it('uses a CC media licence, else falls back to the record licence', () => {
    const imgs = usableImages(
      occ('http://creativecommons.org/licenses/by/4.0/legalcode', [
        { type: 'StillImage', identifier: 'a.jpg' }, // empty → record CC-BY
        { type: 'StillImage', identifier: 'b.jpg', license: 'Copyright by the creator, see …' }, // free text → record
        { type: 'StillImage', identifier: 'c.jpg', license: 'CC0_1_0', creator: 'Ann' }, // own CC licence wins
        { type: 'StillImage', identifier: 'e.jpg', license: 'https://creativecommons.org/licenses/by-sa/4.0/' }, // own SA licence wins
        { type: 'StillImage', identifier: 'f.jpg', license: 'https://creativecommons.org/publicdomain/mark/1.0/' }, // own CC, unknown
        { type: 'Sound', identifier: 'd.mp3' }, // not an image
        { type: 'StillImage' }, // no URL
      ]),
    );
    expect(imgs.map((i) => [i.url, i.licence])).toEqual([
      ['a.jpg', 'CC-BY'],
      ['b.jpg', 'CC-BY'],
      ['c.jpg', 'CC0'],
      ['e.jpg', 'CC-BY-SA'],
    ]);
    expect(imgs[2]).toMatchObject({ creator: 'Ann', publisher: 'Pub', datasetKey: 'd', occurrenceKey: 1 });
  });

  it('drops unlicensed media on records with a disallowed licence', () => {
    expect(usableImages(occ('Copyright', [{ identifier: 'x.jpg' }]))).toEqual([]);
  });

  it('lets unlicensed media inherit a ShareAlike record licence', () => {
    const imgs = usableImages(occ('https://creativecommons.org/licenses/by-sa/4.0/', [{ identifier: 'x.jpg' }]));
    expect(imgs.map((i) => i.licence)).toEqual(['CC-BY-SA']);
  });
});
