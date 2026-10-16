/** The What filter's taxa: names for display, and adding, replacing and removing taxa. */
import type { NameRow } from '~/lib/data/types';
import type { NameHit } from '~/lib/gbif';
import { snapshots, stubNetwork } from './helpers/network';

const NAMES: NameRow[] = [[212, 'C', 'Aves', 'Birds', 10]];

async function load() {
  vi.resetModules();
  const explorer = await import('~/stores/explorer');
  const taxon = await import('~/stores/taxon');
  return { ...explorer, ...taxon };
}

const robin = { key: 2492462, scientificName: 'Erithacus rubecula', rank: 'SPECIES' as const };

afterEach(() => vi.unstubAllGlobals());

describe('lookupTaxon', () => {
  it('uses the name index, then GBIF, then gives up', async () => {
    stubNetwork((url) => {
      if (url.pathname === '/v1/species/359')
        return { key: 359, scientificName: 'Mammalia', rank: 'CLASS', vernacularName: 'Mammals' };
      return snapshots({ names: NAMES })(url);
    });
    const { lookupTaxon } = await load();
    await expect(lookupTaxon(212)).resolves.toEqual({
      key: 212,
      scientificName: 'Aves',
      rank: 'CLASS',
      commonName: 'Birds',
    });
    await expect(lookupTaxon(359)).resolves.toEqual({
      key: 359,
      scientificName: 'Mammalia',
      rank: 'CLASS',
      commonName: 'Mammals',
    });
    await expect(lookupTaxon(1)).resolves.toBeNull();
  });
});

describe('taxonFromHit', () => {
  it('keeps the display fields of a search hit', async () => {
    const { taxonFromHit } = await load();
    const indexHit: NameHit = { ...robin, count: 5, source: 'index' };
    const liveHit: NameHit = { ...robin, commonName: 'Robin', source: 'suggest' };
    expect(taxonFromHit(indexHit)).toEqual(robin);
    expect(taxonFromHit(liveHit)).toEqual({ ...robin, commonName: 'Robin' });
  });
});

describe('taxon selection', () => {
  beforeEach(() => stubNetwork(snapshots({ names: NAMES })));

  it('adds taxa in key order, refusing duplicates and a full list', async () => {
    const s = await load();
    expect(s.addTaxon(robin)).toBe('added');
    expect(s.addTaxon({ key: 212, scientificName: 'Aves', rank: 'CLASS' })).toBe('added');
    expect(s.$taxonKeys.get()).toEqual([212, 2492462]);
    expect(s.addTaxon(robin)).toBe('already');
    s.$taxonKeys.set(Array.from({ length: s.MAX_TAXA }, (_, i) => i + 1));
    expect(s.addTaxon(robin)).toBe('full');
  });

  it('clears the selected cell whenever the taxa change', async () => {
    const s = await load();
    const select = () => {
      s.$selectedHex.set([1, 2]);
      s.$panel.set('hex');
    };
    select();
    s.addTaxon(robin);
    expect(s.$selectedHex.get()).toBeNull();
    expect(s.$panel.get()).toBe('none');
    select();
    s.removeTaxon(robin.key);
    expect(s.$selectedHex.get()).toBeNull();
    expect(s.$taxonKeys.get()).toEqual([]);
  });

  it('publishes placeholders at once, then the names', async () => {
    const s = await load();
    const seen: string[][] = [];
    const off = s.$taxa.subscribe((t) => seen.push(t.map((x) => x.scientificName)));
    s.$taxonKeys.set([212]);
    await vi.waitFor(() => expect(s.$taxa.get()[0]?.scientificName).toBe('Aves'));
    expect(seen).toContainEqual(['Taxon 212']);
    off();
  });

  it('shows a picked taxon by name straight away (no lookup)', async () => {
    const s = await load();
    const off = s.$taxa.listen(() => {});
    s.addTaxon(robin);
    expect(s.$taxa.get()[0]?.scientificName).toBe('Erithacus rubecula');
    off();
  });
});
