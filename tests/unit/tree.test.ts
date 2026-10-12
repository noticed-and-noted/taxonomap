import type { TreeNodeRow } from '~/lib/data/types';
import { buildTree, findNode, isExpandable, pathTo } from '~/lib/tree/model';

const rows: TreeNodeRow[] = [
  { k: 1, n: 'Animalia', r: 'K', o: 100, s: 10, c: 'Animals' },
  { k: 6, n: 'Plantae', r: 'K', o: 50, s: 5 },
  { k: 44, n: 'Chordata', r: 'P', o: 90, s: 8, p: 1 },
  { k: 212, n: 'Aves', r: 'C', o: 80, s: 6, p: 44 },
  { k: 729, n: 'Passeriformes', r: 'O', o: 60, s: 4, p: 212 },
  { k: 999, n: 'Orphan', r: 'P', o: 5, s: 1 }, // no kingdom: not attached to the root
];

describe('tree model', () => {
  const root = buildTree(rows);

  it('builds kingdoms under the root, sorted by records', () => {
    expect(root.children?.map((c) => c.name)).toEqual(['Animalia', 'Plantae']);
    expect(root.records).toBe(150);
    expect(root.species).toBe(15);
  });

  it('propagates the kingdom for colouring and links parents', () => {
    const order = findNode(root, 729)!;
    expect(order.kingdom).toBe('Animalia');
    expect(pathTo(order).map((n) => n.name)).toEqual(['Life', 'Animalia', 'Chordata', 'Aves', 'Passeriformes']);
  });

  it('marks orders as lazily expandable', () => {
    const order = findNode(root, 729)!;
    expect(order.loaded).toBe(false);
    expect(isExpandable(order)).toBe(true);
    expect(findNode(root, 999)).toBeUndefined();
  });
});
