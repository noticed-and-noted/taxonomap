/**
 * Tree of life model. The top four ranks come from /data/tree.json; deeper
 * levels load live, three requests per expansion (no per-node calls):
 *   children (names) · occurrence facet on the child rank (records) ·
 *   species-search facet on higherTaxonKey (species counts).
 */
import { loadSnapshot } from '~/lib/data/load';
import { nameIndexWithin } from '~/lib/data/name-index';
import type { TreeRank, TreeNodeRow } from '~/lib/data/types';
import { getChildren, getParents, occurrenceFacets, speciesCountsUnder, type FacetField, type Rank } from '~/lib/gbif';

export interface TreeNode {
  key: number;
  name: string;
  common?: string;
  rank: TreeRank | 'ROOT';
  records: number;
  species: number;
  parent?: TreeNode;
  children?: TreeNode[];
  /** Children fetched (or baked) — false means expandable on demand. */
  loaded: boolean;
  /** Kingdom name, for colour. */
  kingdom: string;
}

export const ROOT_KEY = 0;

export const NEXT_RANK: Partial<Record<TreeNode['rank'], TreeRank>> = {
  ROOT: 'K',
  K: 'P',
  P: 'C',
  C: 'O',
  O: 'F',
  F: 'G',
  G: 'S',
};

export const RANK_NAME: Record<TreeRank, Rank> = {
  K: 'KINGDOM',
  P: 'PHYLUM',
  C: 'CLASS',
  O: 'ORDER',
  F: 'FAMILY',
  G: 'GENUS',
  S: 'SPECIES',
};

const RANK_CODE: Record<string, TreeRank> = Object.fromEntries(
  Object.entries(RANK_NAME).map(([code, name]) => [name, code as TreeRank]),
);

const FACET_FOR: Record<TreeRank, FacetField> = {
  K: 'kingdomKey',
  P: 'phylumKey',
  C: 'classKey',
  O: 'orderKey',
  F: 'familyKey',
  G: 'genusKey',
  S: 'speciesKey',
};

export function isExpandable(n: TreeNode): boolean {
  return !!NEXT_RANK[n.rank];
}

/** Build the hierarchy from baked rows. */
export function buildTree(rows: readonly TreeNodeRow[]): TreeNode {
  const root: TreeNode = {
    key: ROOT_KEY,
    name: 'Life',
    rank: 'ROOT',
    records: 0,
    species: 0,
    loaded: true,
    children: [],
    kingdom: '',
  };
  const byKey = new Map<number, TreeNode>();
  for (const r of rows) {
    byKey.set(r.k, {
      key: r.k,
      name: r.n,
      ...(r.c && { common: r.c }),
      rank: r.r,
      records: r.o,
      species: r.s,
      // Orders are the deepest baked level: their children load on demand.
      loaded: r.r !== 'O',
      kingdom: '',
    });
  }
  for (const r of rows) {
    const node = byKey.get(r.k) as TreeNode;
    // Only kingdoms hang off the root; unplaced taxa without a parent are skipped.
    const parent = r.p !== undefined ? byKey.get(r.p) : r.r === 'K' ? root : undefined;
    if (!parent) continue;
    node.parent = parent;
    (parent.children ??= []).push(node);
  }
  const assignKingdom = (n: TreeNode, k: string) => {
    n.kingdom = k;
    n.children?.forEach((c) => assignKingdom(c, k));
  };
  root.children?.forEach((k) => assignKingdom(k, k.name));
  root.records = sum(root.children, 'records');
  root.species = sum(root.children, 'species');
  sortChildren(root);
  return root;
}

function sum(nodes: TreeNode[] | undefined, f: 'records' | 'species'): number {
  return (nodes ?? []).reduce((s, n) => s + n[f], 0);
}

function sortChildren(n: TreeNode) {
  n.children?.sort((a, b) => b.records - a.records);
  n.children?.forEach(sortChildren);
}

export async function loadBakedTree(): Promise<TreeNode | null> {
  const snap = await loadSnapshot('tree');
  return snap ? buildTree(snap.nodes) : null;
}

/** Fetch and attach the children of `node` (optionally scoped to a WKT area). */
export async function loadChildren(node: TreeNode, wkt?: string, signal?: AbortSignal): Promise<TreeNode[]> {
  const childRank = NEXT_RANK[node.rank];
  if (!childRank || node.rank === 'ROOT') return node.children ?? [];
  const [kids, occ, species, idx] = await Promise.all([
    getChildren(node.key, { limit: 1000 }, signal),
    occurrenceFacets({ taxonKey: node.key, geometry: wkt }, [FACET_FOR[childRank]], {
      facetLimit: 5000,
      ...(signal && { signal }),
    }),
    childRank === 'S' ? Promise.resolve(null) : speciesCountsUnder(node.key, 5000, signal),
    nameIndexWithin(800),
  ]);
  const records = new Map((occ.facets[FACET_FOR[childRank]] ?? []).map((c) => [Number(c.name), c.count]));
  const children: TreeNode[] = [];
  for (const k of kids.results) {
    if (RANK_CODE[k.rank] !== childRank) continue;
    if (k.taxonomicStatus && k.taxonomicStatus !== 'ACCEPTED') continue;
    const r = records.get(k.key) ?? 0;
    const s = childRank === 'S' ? 1 : (species?.get(k.key) ?? 0);
    if (r === 0 && s === 0) continue;
    const raw = idx?.get(k.key)?.[3] ?? k.vernacularName;
    const common = raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : undefined;
    children.push({
      key: k.key,
      name: k.canonicalName ?? k.scientificName,
      ...(common && { common }),
      rank: childRank,
      records: r,
      species: s,
      parent: node,
      loaded: childRank === 'S',
      kingdom: node.kingdom,
    });
  }
  children.sort((a, b) => b.records - a.records || b.species - a.species);
  node.children = children;
  node.loaded = true;
  return children;
}

export function findNode(root: TreeNode, key: number): TreeNode | undefined {
  if (root.key === key) return root;
  for (const c of root.children ?? []) {
    const hit = findNode(c, key);
    if (hit) return hit;
  }
  return undefined;
}

export function pathTo(node: TreeNode): TreeNode[] {
  const out: TreeNode[] = [];
  for (let n: TreeNode | undefined = node; n; n = n.parent) out.unshift(n);
  return out;
}

/**
 * Locate a taxon (possibly below the baked levels), loading the levels in
 * between. Returns the node, or the deepest ancestor found.
 */
export async function resolve(root: TreeNode, key: number, wkt?: string): Promise<TreeNode | undefined> {
  const known = findNode(root, key);
  if (known) return known;
  const parents = await getParents(key);
  let current: TreeNode | undefined;
  for (const p of [...parents.map((x) => x.key), key]) {
    const next: TreeNode | undefined = findNode(current ?? root, p);
    if (next) {
      current = next;
      continue;
    }
    if (current && !current.loaded) {
      await loadChildren(current, wkt);
      const loaded = current.children?.find((c) => c.key === p);
      if (loaded) current = loaded;
    }
  }
  return current;
}
