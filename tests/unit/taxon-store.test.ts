/** The What filter's taxa: names for display, and adding, replacing and removing taxa. */
import type { NameRow } from '~/lib/data/types';
import type { NameHit } from '~/lib/gbif';
import { json, snapshots, stubNetwork } from './helpers/network';

const NAMES: NameRow[] = [[212, 'C', 'Aves', 'Birds', 10]];

async function load() {
  vi.resetModules();
  const explorer = await import('~/stores/explorer');
  const taxon = await import('~/stores/taxon');
  return { ...explorer, ...taxon };
}

const robin = { key: 2492462, scientificName: 'Erithacus rubecula', rank: 'SPECIES' as const };

afterEach(() => vi.unstubAllGlobals());

describe('lookupTaxonRank', () => {
  it('answers from the name index, else GBIF’s species API, without asking for common names', async () => {
    const calls = stubNetwork((url) => {
      if (url.pathname === '/v1/species/359')
        return { key: 359, scientificName: 'Mammalia Linnaeus', canonicalName: 'Mammalia', rank: 'CLASS' };
      if (url.pathname === '/v1/species/360') return { key: 360, scientificName: 'Reptilia', rank: 'CLASS' };
      return snapshots({ names: NAMES })(url);
    });
    const { lookupTaxonRank } = await load();
    await expect(lookupTaxonRank(212)).resolves.toMatchObject({ scientificName: 'Aves', rank: 'CLASS' });
    // Loaded now, so the next index hit needs no wait.
    await expect(lookupTaxonRank(212)).resolves.toMatchObject({ scientificName: 'Aves' });
    await expect(lookupTaxonRank(359)).resolves.toEqual({ scientificName: 'Mammalia', rank: 'CLASS' });
    await expect(lookupTaxonRank(360)).resolves.toEqual({ scientificName: 'Reptilia', rank: 'CLASS' });
    await expect(lookupTaxonRank(1)).resolves.toBeNull();
    expect(calls.some((url) => url.pathname.endsWith('/vernacularNames') || url.host.includes('inaturalist'))).toBe(
      false,
    );
  });
});

describe('lookupTaxon', () => {
  it('uses the name index, then GBIF, then gives up', async () => {
    stubNetwork((url) => {
      if (url.pathname === '/v1/species/359')
        return { key: 359, scientificName: 'Mammalia', rank: 'CLASS', vernacularName: 'Mammal class' };
      // Named by englishName(), like everywhere else, not by GBIF's own vernacularName.
      if (url.pathname === '/v1/species/359/vernacularNames') {
        return {
          results: [
            { vernacularName: 'Mammals', language: 'eng' },
            { vernacularName: 'Mammals', language: 'eng' },
            { vernacularName: 'Mammifères', language: 'fra' },
          ],
        };
      }
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

  it('names a taxon as iNaturalist does, without asking GBIF for its names', async () => {
    const calls = stubNetwork((url) => {
      if (url.pathname === '/v1/species/359') return { key: 359, scientificName: 'Mammalia', rank: 'CLASS' };
      if (url.pathname === '/v1/occurrence/search' && url.searchParams.get('datasetKey'))
        return { results: [{ key: 1, taxonID: '40151' }], count: 1, endOfRecords: true };
      if (url.host === 'api.inaturalist.org' && url.pathname === '/v2/taxa/40151')
        return { results: [{ id: 40151, name: 'Mammalia', rank_level: 50, preferred_common_name: 'Mammals' }] };
      return snapshots({ names: NAMES })(url);
    });
    const { lookupTaxon } = await load();
    await expect(lookupTaxon(359)).resolves.toEqual({
      key: 359,
      scientificName: 'Mammalia',
      rank: 'CLASS',
      commonName: 'Mammals',
    });
    expect(calls.some((url) => url.pathname.endsWith('/vernacularNames'))).toBe(false);
  });

  it('keeps a taxon whose common names fail to load', async () => {
    stubNetwork((url) => {
      if (url.pathname === '/v1/species/44') return { key: 44, scientificName: 'Chordata', rank: 'PHYLUM' };
      if (url.pathname === '/v1/species/44/vernacularNames') return json({ message: 'down' }, 500);
      return snapshots({ names: NAMES })(url);
    });
    const { lookupTaxon } = await load();
    await expect(lookupTaxon(44)).resolves.toEqual({ key: 44, scientificName: 'Chordata', rank: 'PHYLUM' });
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
    const store = await load();
    expect(store.addTaxon(robin)).toBe('added');
    expect(store.addTaxon({ key: 212, scientificName: 'Aves', rank: 'CLASS' })).toBe('added');
    expect(store.$taxonKeys.get()).toEqual([212, 2492462]);
    expect(store.addTaxon(robin)).toBe('already');
    store.$taxonKeys.set(Array.from({ length: store.MAX_TAXA }, (_unused, index) => index + 1));
    expect(store.addTaxon(robin)).toBe('full');
  });

  it('clears the selected cell whenever the taxa change', async () => {
    const store = await load();
    const select = () => {
      store.$selectedHex.set([1, 2]);
      store.$panel.set('hex');
    };
    select();
    store.addTaxon(robin);
    expect(store.$selectedHex.get()).toBeNull();
    expect(store.$panel.get()).toBe('none');
    select();
    store.removeTaxon(robin.key);
    expect(store.$selectedHex.get()).toBeNull();
    expect(store.$taxonKeys.get()).toEqual([]);
  });

  it('publishes placeholders at once, then the names', async () => {
    const store = await load();
    const seen: string[][] = [];
    const off = store.$taxa.subscribe((list) => seen.push(list.map((taxon) => taxon.scientificName)));
    store.$taxonKeys.set([212]);
    expect(store.$taxa.get()[0]?.loading).toBe(true);
    await vi.waitFor(() => expect(store.$taxa.get()[0]?.scientificName).toBe('Aves'));
    expect(seen).toContainEqual(['Taxon 212']);
    expect(store.$taxa.get()[0]?.loading).toBeUndefined();
    off();
  });

  it('keeps placeholders for taxa it cannot name, and drops answers for a selection that moved on', async () => {
    stubNetwork(snapshots({}));
    const store = await load();
    const off = store.$taxa.listen(() => {});
    store.$taxonKeys.set([1]);
    store.$taxonKeys.set([2]);
    await vi.waitFor(() =>
      expect(store.$taxa.get()).toEqual([{ key: 2, scientificName: 'Taxon 2', rank: 'UNRANKED' }]),
    );
    // Known names need no lookup.
    store.primeTaxonInfo({ key: 3, scientificName: 'Known', rank: 'GENUS' });
    store.$taxonKeys.set([3]);
    expect(store.$taxa.get()[0]?.scientificName).toBe('Known');
    off();
  });

  it('looks a picked taxon up when its name was still loading, rather than keeping GBIF\u2019s', async () => {
    const { addTaxon, taxonFromHit } = await import('~/stores/taxon');
    const taxon = taxonFromHit({
      key: 77,
      scientificName: 'Coprinus comatus',
      rank: 'SPECIES',
      commonName: 'Lawyer\u2019s Wig',
      isNamePending: true,
    });
    expect(taxon.commonName).toBeUndefined();
    expect(taxon.loading).toBe(true);
    expect(addTaxon(taxon)).toBe('added');
  });

  it('shows a picked taxon by name straight away (no lookup)', async () => {
    const store = await load();
    const off = store.$taxa.listen(() => {});
    store.addTaxon(robin);
    expect(store.$taxa.get()[0]?.scientificName).toBe('Erithacus rubecula');
    off();
  });
});

describe('toggleTaxa', () => {
  it('adds a whole group, removes it again, and refuses past the limit', async () => {
    stubNetwork(snapshots({ names: NAMES }));
    const { $taxonKeys, MAX_TAXA, TAXON_GROUPS, toggleTaxa } = await load();
    const reptiles = TAXON_GROUPS.find((group) => group.label === 'Reptiles')!.taxa;
    $taxonKeys.set([212]);
    expect(toggleTaxa(reptiles)).toBe('added');
    expect($taxonKeys.get()).toEqual([212, 11418114, 11493978, 11592253]);
    expect(toggleTaxa(reptiles)).toBe('removed');
    expect($taxonKeys.get()).toEqual([212]);
    $taxonKeys.set(Array.from({ length: MAX_TAXA - 1 }, (_unused, index) => index + 1));
    expect(toggleTaxa(reptiles)).toBe('full');
    expect($taxonKeys.get()).toHaveLength(MAX_TAXA - 1);
  });
});
