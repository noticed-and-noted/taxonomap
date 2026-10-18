import { NameIndex, normalise } from '~/lib/data/name-index';
import { snapshots, stubNetwork } from './helpers/network';
import type { NameRow } from '~/lib/data/types';

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
  const idx = new NameIndex([...rows].sort((a, b) => b[4] - a[4]));

  it('looks up a taxon by key, decoded', () => {
    expect(idx.get(212)).toEqual({
      key: 212,
      rank: 'CLASS',
      scientificName: 'Aves',
      commonName: 'Birds',
      count: 900_000_000,
    });
    expect(idx.get(1)).toBeUndefined();
  });

  it('finds common names by word prefix, most-recorded first', () => {
    expect(idx.search('robin').map((h) => h.key)).toEqual([9510564, 2492462, 7]);
  });

  it('matches multi-word queries in any order', () => {
    expect(idx.search('sparrow house')[0]?.key).toBe(5231190);
  });

  it('ranks a full-prefix match above word matches', () => {
    expect(idx.search('house sp')[0]).toMatchObject({ key: 5231190, commonName: 'House sparrow', rank: 'SPECIES' });
  });

  it('matches scientific names', () => {
    expect(idx.search('erithacus')[0]?.key).toBe(2492462);
  });

  it('normalises accents and punctuation', () => {
    expect(normalise("  Réunion  Harrier's ")).toBe('reunion harrier s');
  });

  it('ignores one-letter queries', () => {
    expect(idx.search('r')).toEqual([]);
  });
});

describe('NameIndex scoring', () => {
  const idx = new NameIndex(rows);

  it('puts an exact name first, and finds taxa with no common name', () => {
    expect(idx.search('birds')[0]?.key).toBe(212);
    expect(idx.search('ursus arctos').map((h) => h.key)).toEqual([8]);
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

  it('gives up waiting after the time limit', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', () => new Promise(() => {}));
    const p = (await fresh()).nameIndexWithin(100);
    await vi.advanceTimersByTimeAsync(100);
    await expect(p).resolves.toBeNull();
  });
});
