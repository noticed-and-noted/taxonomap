import type { TreeNodeRow } from '~/lib/data/types';
import { buildTree, findNode, isExpandable, loadChildren, pathTo, resolve } from '~/lib/tree/model';
import { facets, snapshots, stubNetwork } from './helpers/network';

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

describe('tree lazy levels', () => {
  const kid = (key: number, name: string, rank = 'FAMILY', extra: object = {}) => ({
    key,
    scientificName: `${name} Author`,
    canonicalName: name,
    rank,
    taxonomicStatus: 'ACCEPTED',
    ...extra,
  });

  function gbif() {
    return stubNetwork((url) => {
      const p = url.pathname;
      if (p === '/v1/species/729/children')
        return {
          results: [
            kid(5264, 'Paridae'),
            kid(9327, 'Turdidae', 'FAMILY', { vernacularName: 'thrushes' }),
            kid(1, 'Empty'),
            kid(2, 'Old name', 'FAMILY', { taxonomicStatus: 'SYNONYM' }),
            kid(3, 'Wrong rank', 'GENUS'),
          ],
        };
      if (p === '/v1/species/9327/children') return { results: [kid(2490, 'Turdus', 'GENUS')] };
      if (p === '/v1/species/search') {
        const under = url.searchParams.get('highertaxonKey');
        return under === '729'
          ? facets(0, 'HIGHER_TAXON_KEY', [
              [5264, 60],
              [9327, 180],
            ])
          : facets(0, 'HIGHER_TAXON_KEY', [[2490, 70]]);
      }
      if (p === '/v1/occurrence/search') {
        const field = url.searchParams.get('facet');
        return field === 'familyKey'
          ? facets(0, 'FAMILY_KEY', [
              [5264, 500],
              [9327, 900],
            ])
          : facets(0, 'GENUS_KEY', [[2490, 800]]);
      }
      if (p === '/v1/species/2490/parents') return [{ key: 1 }, { key: 44 }, { key: 212 }, { key: 729 }, { key: 9327 }];
      return snapshots({ names: [] })(url);
    });
  }

  afterEach(() => vi.unstubAllGlobals());

  it('loads accepted children of the next rank with records and species counts', async () => {
    gbif();
    const tree = buildTree(rows);
    const order = findNode(tree, 729)!;
    const kids = await loadChildren(order);
    expect(kids.map((k) => [k.name, k.common, k.records, k.species, k.kingdom])).toEqual([
      ['Turdidae', 'Thrushes', 900, 180, 'Animalia'],
      ['Paridae', undefined, 500, 60, 'Animalia'],
    ]);
    expect(order.loaded).toBe(true);
    expect(kids[0]?.parent).toBe(order);
  });

  it('resolves a taxon below the baked levels by loading the levels between', async () => {
    gbif();
    const tree = buildTree(rows);
    const genus = await resolve(tree, 2490);
    expect(genus && pathTo(genus).map((n) => n.name)).toEqual([
      'Life',
      'Animalia',
      'Chordata',
      'Aves',
      'Passeriformes',
      'Turdidae',
      'Turdus',
    ]);
    // Known nodes need no requests.
    await expect(resolve(tree, 212)).resolves.toBe(findNode(tree, 212));
  });
});
