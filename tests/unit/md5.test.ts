import { md5 } from '~/lib/gbif/md5';
import { thumbnailUrl } from '~/lib/gbif/images';

describe('md5', () => {
  it.each([
    ['', 'd41d8cd98f00b204e9800998ecf8427e'],
    ['abc', '900150983cd24fb0d6963f7d28e17f72'],
    ['The quick brown fox jumps over the lazy dog', '9e107d9d372bb6826bd81d3542a419d6'],
    ['ü€', '692010ce814aec196e81dfdd38d997ba'],
  ])('md5(%j)', (input, hex) => {
    expect(md5(input)).toBe(hex);
  });

  it('matches the GBIF image cache address verified against the live API', () => {
    expect(
      thumbnailUrl({
        occurrenceKey: 5937962161,
        url: 'https://live.staticflickr.com/65535/55022647247_e96641313b_b.jpg',
      }),
    ).toMatch(/\/v1\/image\/cache\/400x\/occurrence\/5937962161\/media\/b24c9f13340fdc3795334/);
  });
});
