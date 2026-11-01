/** A browser-rendered species page takes iNaturalist's name, keeping GBIF's when it has none. */
import type { SpeciesData } from '~/lib/species/data';

const inatNames = vi.hoisted(() =>
  vi.fn<(taxa: { key: number; rank: string }[]) => Promise<Map<number, string | null>>>(),
);
vi.mock('~/lib/photos/taxon-photos', () => ({ inatNames }));

const data = {
  key: 7,
  rank: 'SUBSPECIES',
  canonicalName: 'Turdus merula azorensis',
  commonName: 'GBIF name',
} as SpeciesData;

afterEach(() => inatNames.mockReset());

describe('withInatName', () => {
  it('names the page as iNaturalist does, at the taxon’s own rank', async () => {
    inatNames.mockResolvedValue(new Map([[7, 'Azores Blackbird']]));
    const { withInatName } = await import('~/lib/species/inat-name');
    expect((await withInatName(data)).commonName).toBe('Azores Blackbird');
    expect(inatNames).toHaveBeenCalledWith([{ key: 7, rank: 'SUBSPECIES' }]);
  });

  it('keeps the data as it was when iNaturalist has no name or fails', async () => {
    const { withInatName } = await import('~/lib/species/inat-name');
    inatNames.mockResolvedValue(new Map([[7, null]]));
    expect(await withInatName(data)).toBe(data);
    inatNames.mockRejectedValue(new Error('down'));
    expect(await withInatName(data)).toBe(data);
  });
});
