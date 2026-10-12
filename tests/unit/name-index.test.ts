import { NameIndex, normalise } from '~/lib/data/name-index';
import type { NameRow } from '~/lib/data/types';

const rows: NameRow[] = [
  [212, 'C', 'Aves', 'Birds', 900_000_000],
  [5231190, 'S', 'Passer domesticus', 'House sparrow', 30_000_000],
  [2492462, 'S', 'Erithacus rubecula', 'European robin', 11_000_000],
  [9510564, 'S', 'Turdus migratorius', 'American robin', 20_000_000],
  [2490384, 'S', 'Cyanistes caeruleus', 'Eurasian blue tit', 15_000_000],
  [7, 'S', 'Robinia pseudoacacia', 'Black locust', 1_000_000],
];

describe('NameIndex', () => {
  // The baked index is sorted by count, descending.
  const idx = new NameIndex([...rows].sort((a, b) => b[4] - a[4]));

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
