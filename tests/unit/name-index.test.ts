import { NameIndex, normalise } from '~/lib/data/name-index';
import type { NameRow } from '~/lib/data/types';
import { snapshots, stubNetwork } from './helpers/network';

const rows: NameRow[] = [
  [212, 'C', 'Aves', 'Birds', 900_000_000],
  [5231190, 'S', 'Passer domesticus', 'House sparrow', 30_000_000],
  [2492462, 'S', 'Erithacus rubecula', 'European robin', 11_000_000],
  [9510564, 'S', 'Turdus migratorius', 'American robin', 20_000_000],
  [2490384, 'S', 'Cyanistes caeruleus', 'Eurasian blue tit', 15_000_000],
  [7, 'S', 'Robinia pseudoacacia', 'Black locust', 1_000_000],
  [8, 'S', 'Ursus arctos', null, 500],
];

describe('NameIndex', () => {
  // The baked index is sorted by count, descending.
  const nameIndex = new NameIndex([...rows].sort((left, right) => right[4] - left[4]));

  it('looks up a taxon by key, decoded', () => {
    expect(nameIndex.get(212)).toEqual({
      key: 212,
      rank: 'CLASS',
      scientificName: 'Aves',
      commonName: 'Birds',
      count: 900_000_000,
    });
    expect(nameIndex.get(1)).toBeUndefined();
  });

  it('decodes the iNaturalist ID a row carries, when it has one', () => {
    const withId = new NameIndex([[5, 'S', 'Passer domesticus', null, 9, 3017]]);
    expect(withId.get(5)).toEqual({
      key: 5,
      rank: 'SPECIES',
      scientificName: 'Passer domesticus',
      count: 9,
      inatId: 3017,
    });
    expect(nameIndex.get(5231190)).not.toHaveProperty('inatId');
  });

  it('finds common names by word prefix, most-recorded first', () => {
    expect(nameIndex.search('robin').map((hit) => hit.key)).toEqual([9510564, 2492462, 7]);
  });

  it('matches multi-word queries in any order', () => {
    expect(nameIndex.search('sparrow house')[0]?.key).toBe(5231190);
  });

  it('ranks a full-prefix match above word matches', () => {
    expect(nameIndex.search('house sp')[0]).toMatchObject({
      key: 5231190,
      commonName: 'House sparrow',
      rank: 'SPECIES',
    });
  });

  it('matches scientific names', () => {
    expect(nameIndex.search('erithacus')[0]?.key).toBe(2492462);
  });

  it('normalises accents and punctuation', () => {
    expect(normalise("  Réunion  Harrier's ")).toBe('reunion harrier s');
  });

  it('ignores one-letter queries', () => {
    expect(nameIndex.search('r')).toEqual([]);
  });
});

describe('NameIndex scoring', () => {
  const nameIndex = new NameIndex(rows);

  it('puts an exact name first, and finds taxa with no common name', () => {
    expect(nameIndex.search('birds')[0]?.key).toBe(212);
    expect(nameIndex.search('ursus arctos').map((hit) => hit.key)).toEqual([8]);
  });
});

describe('NameIndex other English names', () => {
  const nameIndex = new NameIndex([
    [2495414, 'S', 'Columba livia', 'Rock dove', 9_000_000, null, ['Rock pigeon', 'Feral pigeon']],
    [2495347, 'S', 'Columba palumbus', 'Common wood pigeon', 5_000_000],
    [2481126, 'G', 'Larus', 'Gull', 3_000_000, 42, ['Seagull']],
    [9, 'S', 'Columba oenas', 'Stock dove', 100, null, ['Rock pigeon']],
  ]);

  it('finds a taxon by another English name, saying which one matched', () => {
    expect(nameIndex.search('seagul')[0]).toMatchObject({ key: 2481126, rank: 'GENUS', matchedName: 'Seagull' });
    expect(nameIndex.get(2481126)).toMatchObject({ inatId: 42 });
    expect(nameIndex.get(2495414)).not.toHaveProperty('inatId');
  });

  it('ranks word matches on other names with main names, by records', () => {
    expect(nameIndex.search('pigeon').map((hit) => [hit.key, hit.matchedName])).toEqual([
      [2495414, 'Rock pigeon'],
      [2495347, undefined],
      [9, 'Rock pigeon'],
    ]);
  });

  it('ranks an exact main name above an exact other name', () => {
    const tied = new NameIndex([
      [1, 'S', 'Columba livia', 'Rock dove', 900, null, ['Stock dove']],
      [2, 'S', 'Columba oenas', 'Stock dove', 100],
    ]);
    expect(tied.search('stock dove').map((hit) => hit.key)).toEqual([2, 1]);
  });
});

describe('loading the index', () => {
  async function fresh() {
    vi.resetModules();
    return import('~/lib/data/name-index');
  }
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('answers from the baked snapshot, or with nothing when it is missing or the network fails', async () => {
    stubNetwork(snapshots({ names: rows }));
    expect((await (await fresh()).bakedIndexProvider.search('robin')).length).toBe(3);
    stubNetwork(snapshots({}));
    await expect((await fresh()).bakedIndexProvider.search('robin')).resolves.toEqual([]);
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('offline')));
    await expect((await fresh()).loadNameIndex()).resolves.toBeNull();
  });

  it('hands out the index only once it has loaded, without starting a load', async () => {
    const calls = stubNetwork(snapshots({ names: rows }));
    const freshModule = await fresh();
    expect(freshModule.nameIndexIfLoaded()).toBeNull();
    expect(calls).toHaveLength(0);
    const loaded = await freshModule.loadNameIndex();
    expect(freshModule.nameIndexIfLoaded()).toBe(loaded);
  });

  it('gives up waiting after the time limit', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', () => new Promise(() => {}));
    const pending = (await fresh()).nameIndexWithin(100);
    await vi.advanceTimersByTimeAsync(100);
    await expect(pending).resolves.toBeNull();
  });
});
