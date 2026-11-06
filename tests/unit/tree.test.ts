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
    expect(root.children?.map((child) => child.name)).toEqual(['Animalia', 'Plantae']);
    expect(root.records).toBe(150);
    expect(root.species).toBe(15);
  });

  it('propagates the kingdom for colouring and links parents', () => {
    const order = findNode(root, 729)!;
    expect(order.kingdom).toBe('Animalia');
    expect(pathTo(order).map((node) => node.name)).toEqual(['Life', 'Animalia', 'Chordata', 'Aves', 'Passeriformes']);
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
      const path = url.pathname;
      const under = url.searchParams.get('highertaxonKey');
      const isList = path === '/v1/species/search' && url.searchParams.get('limit') !== '0';
      if (isList && under === '729')
        return {
          count: 5,
          results: [
            kid(5264, 'Paridae'),
            kid(9327, 'Turdidae', 'FAMILY', { vernacularNames: [{ vernacularName: 'thrushes', language: 'eng' }] }),
            kid(1, 'Empty'),
            kid(2, 'Old name', 'FAMILY', { taxonomicStatus: 'SYNONYM' }),
            kid(3, 'Wrong rank', 'GENUS'),
          ],
        };
      if (isList) return { count: 1, results: [kid(2490, 'Turdus', 'GENUS')] };
      if (path === '/v1/species/search') {
        return under === '729'
          ? facets(0, 'HIGHER_TAXON_KEY', [
              [5264, 60],
              [9327, 180],
            ])
          : facets(0, 'HIGHER_TAXON_KEY', [[2490, 70]]);
      }
      if (path === '/v1/occurrence/search') {
        const field = url.searchParams.get('facet');
        return field === 'familyKey'
          ? facets(0, 'FAMILY_KEY', [
              [5264, 500],
              [9327, 900],
            ])
          : facets(0, 'GENUS_KEY', [[2490, 800]]);
      }
      if (path === '/v1/species/2490/parents')
        return [{ key: 1 }, { key: 44 }, { key: 212 }, { key: 729 }, { key: 9327 }];
      return snapshots({ names: [] })(url);
    });
  }

  afterEach(() => vi.unstubAllGlobals());

  it('loads accepted children of the next rank with records and species counts', async () => {
    gbif();
    const tree = buildTree(rows);
    const order = findNode(tree, 729)!;
    const loaded = await loadChildren(order);
    expect(loaded.map((child) => [child.name, child.common, child.records, child.species, child.kingdom])).toEqual([
      ['Turdidae', 'Thrushes', 900, 180, 'Animalia'],
      ['Paridae', undefined, 500, 60, 'Animalia'],
    ]);
    expect(order.loaded).toBe(true);
    expect(loaded[0]?.parent).toBe(order);
  });

  it('resolves a taxon below the baked levels by loading the levels between', async () => {
    gbif();
    const tree = buildTree(rows);
    const genus = await resolve(tree, 2490);
    expect(genus && pathTo(genus).map((node) => node.name)).toEqual([
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

  it('loads species under a genus, each counting as one, named from the index', async () => {
    stubNetwork((url) => {
      if (url.pathname === '/v1/species/search' && url.searchParams.get('highertaxonKey') === '2490')
        return {
          count: 3,
          results: [
            { key: 11, scientificName: 'Turdus merula L.', rank: 'SPECIES' },
            { key: 12, scientificName: 'Turdus pilaris', canonicalName: 'Turdus pilaris', rank: 'SPECIES' },
            { key: 13, scientificName: 'Turdus iliacus', rank: 'SPECIES' },
          ],
        };
      // No facet for the rank in the response: every species counts as unrecorded.
      if (url.pathname === '/v1/occurrence/search') return facets(0, 'OTHER', []);
      return snapshots({ names: [[12, 'S', 'Turdus pilaris', 'fieldfare', 1]] })(url);
    });
    // A fresh module, so the name index is read from this snapshot.
    vi.resetModules();
    const model = await import('~/lib/tree/model');
    const genus = {
      key: 2490,
      name: 'Turdus',
      rank: 'G' as const,
      records: 1,
      species: 3,
      loaded: false,
      kingdom: 'Animalia',
    };
    const loaded = await model.loadChildren(genus, undefined, new AbortController().signal);
    expect(loaded.map((child) => [child.name, child.common, child.records, child.species, child.loaded])).toEqual([
      ['Turdus merula L.', undefined, 0, 1, true],
      ['Turdus pilaris', 'Fieldfare', 0, 1, true],
      ['Turdus iliacus', undefined, 0, 1, true],
    ]);
  });

  it('has nothing to load at the root or below species', async () => {
    const calls = stubNetwork(() => undefined);
    const tree = buildTree(rows);
    await expect(loadChildren(tree)).resolves.toBe(tree.children);
    const species = { key: 1, name: 's', rank: 'S' as const, records: 1, species: 1, loaded: true, kingdom: '' };
    await expect(loadChildren(species)).resolves.toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('stops at the deepest ancestor it can find', async () => {
    stubNetwork((url) => {
      if (url.pathname === '/v1/species/77/parents')
        return [{ key: 1 }, { key: 44 }, { key: 212 }, { key: 729 }, { key: 5 }];
      if (url.pathname === '/v1/species/search' || url.pathname === '/v1/occurrence/search') return facets(0, 'X', []);
      return snapshots({ names: [] })(url);
    });
    const tree = buildTree(rows);
    await expect(resolve(tree, 77)).resolves.toBe(findNode(tree, 729));
  });
});

describe('baked tree', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('builds from /data/tree.json, or is null without it', async () => {
    stubNetwork(snapshots({ tree: rows }));
    vi.resetModules();
    const withTree = await import('~/lib/tree/model');
    expect((await withTree.loadBakedTree())?.children?.map((child) => child.key)).toEqual([1, 6]);
    stubNetwork(snapshots({}));
    vi.resetModules();
    const without = await import('~/lib/tree/model');
    await expect(without.loadBakedTree()).resolves.toBeNull();
  });
});

describe('live tree', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('lists the kingdoms from GBIF when there is no bake, with unfiltered counts', async () => {
    const calls = stubNetwork((url) => {
      const path = url.pathname;
      if (path === '/v1/species/search' && url.searchParams.get('rank') === 'KINGDOM')
        return {
          endOfRecords: true,
          results: [
            { key: 1, scientificName: 'Animalia', canonicalName: 'Animalia', rank: 'KINGDOM' },
            { key: 6, scientificName: 'Plantae', canonicalName: 'Plantae', rank: 'KINGDOM' },
          ],
        };
      if (path === '/v1/species/search')
        return facets(0, 'HIGHER_TAXON_KEY', [
          [1, 900],
          [6, 300],
        ]);
      if (path === '/v1/occurrence/search')
        return facets(0, 'KINGDOM_KEY', [
          [1, 5000],
          [6, 2000],
        ]);
      return snapshots({ names: [] })(url);
    });
    vi.resetModules();
    const model = await import('~/lib/tree/model');
    const tree = await model.loadLiveTree();
    expect(tree.children?.map((kingdom) => [kingdom.name, kingdom.records, kingdom.species, kingdom.kingdom])).toEqual([
      ['Animalia', 5000, 900, 'Animalia'],
      ['Plantae', 2000, 300, 'Plantae'],
    ]);
    expect([tree.records, tree.species, tree.loaded]).toEqual([7000, 1200, true]);
    const counts = calls.filter((url) => url.searchParams.has('facet'));
    expect(counts.some((url) => url.searchParams.has('taxonKey') || url.searchParams.has('highertaxonKey'))).toBe(
      false,
    );
  });
});
