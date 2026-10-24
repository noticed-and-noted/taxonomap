/** Merging checklist distributions into introduced countries. */
import { summariseDistributions } from '~/lib/species/distribution';

describe('summariseDistributions', () => {
  it('lists introduced countries once, with invasive ones also introduced, and leaves native out', () => {
    const summary = summariseDistributions([
      { country: 'SE', establishmentMeans: 'NATIVE', source: 'A' },
      { country: 'SE', establishmentMeans: 'INTRODUCED', source: 'B' },
      { country: 'GB', establishmentMeans: 'NATURALISED', source: 'B' },
      { country: 'RS', establishmentMeans: 'INVASIVE', source: 'C' },
      { country: 'BR', establishmentMeans: 'INTRODUCED', source: 'C' },
      { country: 'BR', establishmentMeans: 'INTRODUCED', source: 'C' },
    ]);
    expect(summary).toEqual({ introduced: ['BR', 'GB', 'RS', 'SE'], invasive: ['RS'], sources: 2 });
  });

  it('ignores rows without a country, a known establishment or a trusted source, and returns null when nothing is left', () => {
    expect(
      summariseDistributions([
        { locality: 'North America', establishmentMeans: 'INTRODUCED' },
        { country: 'DK' },
        { country: 'IT', establishmentMeans: 'UNCERTAIN', source: 'A' },
        { country: 'BE', establishmentMeans: 'NATIVE', source: 'A' },
        { country: 'SE', establishmentMeans: 'INTRODUCED' },
        { country: 'SE', establishmentMeans: 'INTRODUCED', source: '  ' },
        { country: 'CN', establishmentMeans: 'INTRODUCED', source: 'Catálogo Taxonômico da Fauna do Brasil' },
      ]),
    ).toBeNull();
  });
});
