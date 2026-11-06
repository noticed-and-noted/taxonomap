/**
 * Tree of life model. The top four ranks come from /data/tree.json (or load live
 * when the bake left none); deeper levels load live, three requests per expansion (no per-node calls):
 *   children (names) · occurrence facet on the child rank (records) ·
 *   species-search facet on higherTaxonKey (species counts).
 */
import { loadSnapshot } from '~/lib/data/load';
import { nameIndexWithin } from '~/lib/data/name-index';
import { CODE_BY_RANK, RANK_BY_CODE } from '~/lib/data/ranks';
import type { TreeRank, TreeNodeRow } from '~/lib/data/types';
import { capitalise } from '~/lib/format';
import {
  getAllChildren,
  getParents,
  listByRank,
  occurrenceFacets,
  speciesCountsUnder,
  type FacetField,
  type UsageWithNames,
} from '~/lib/gbif';
import { englishName } from '~/lib/species/names';

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

const FACET_FOR: Record<TreeRank, FacetField> = {
  K: 'kingdomKey',
  P: 'phylumKey',
  C: 'classKey',
  O: 'orderKey',
  F: 'familyKey',
  G: 'genusKey',
  S: 'speciesKey',
};

/** Whether the node's rank has children below it. */
export function isExpandable(node: TreeNode): boolean {
  return !!NEXT_RANK[node.rank];
}

/** A tree node for a baked row, not yet linked to its parent. */
function nodeFromRow(row: TreeNodeRow): TreeNode {
  return {
    key: row.k,
    name: row.n,
    ...(row.c && { common: row.c }),
    rank: row.r,
    records: row.o,
    species: row.s,
    // Orders are the deepest baked level: their children load on demand.
    loaded: row.r !== 'O',
    kingdom: '',
  };
}

/** Propagates a kingdom's name down its subtree, for colouring. */
function assignKingdom(node: TreeNode, kingdom: string) {
  node.kingdom = kingdom;
  node.children?.forEach((child) => assignKingdom(child, kingdom));
}

/** The root of the tree, with no kingdoms under it yet. */
function emptyRoot(loaded: boolean): TreeNode {
  return { key: ROOT_KEY, name: 'Life', rank: 'ROOT', records: 0, species: 0, loaded, kingdom: '' };
}

/** Build the hierarchy from baked rows. */
export function buildTree(rows: readonly TreeNodeRow[]): TreeNode {
  const root: TreeNode = { ...emptyRoot(true), children: [] };
  const byKey = new Map(rows.map((row) => [row.k, nodeFromRow(row)]));
  for (const row of rows) {
    const node = byKey.get(row.k) as TreeNode;
    // Only kingdoms hang off the root; unplaced taxa without a parent are skipped.
    const parent = row.p !== undefined ? byKey.get(row.p) : row.r === 'K' ? root : undefined;
    if (!parent) continue;
    node.parent = parent;
    (parent.children ??= []).push(node);
  }
  root.children?.forEach((kingdomNode) => assignKingdom(kingdomNode, kingdomNode.name));
  root.records = sum(root.children!, 'records');
  root.species = sum(root.children!, 'species');
  sortChildren(root);
  return root;
}

function sum(nodes: TreeNode[], metric: 'records' | 'species'): number {
  return nodes.reduce((total, node) => total + node[metric], 0);
}

function sortChildren(node: TreeNode) {
  node.children?.sort((left, right) => right.records - left.records);
  node.children?.forEach(sortChildren);
}

/** The tree built from the baked snapshot; null if the snapshot cannot be loaded. */
export async function loadBakedTree(): Promise<TreeNode | null> {
  const snapshot = await loadSnapshot('tree');
  return snapshot ? buildTree(snapshot.nodes) : null;
}

/**
 * The tree with its kingdoms fetched from GBIF, for when the bake left no snapshot.
 * Deeper levels then load on demand, as below a baked tree's orders.
 */
export async function loadLiveTree(): Promise<TreeNode> {
  const root = emptyRoot(false);
  const kingdoms = await loadChildren(root);
  root.records = sum(kingdoms, 'records');
  root.species = sum(kingdoms, 'species');
  return root;
}

/** The taxa one rank below `node`: the kingdoms under the root, else its children in the backbone. */
function childUsagesOf(node: TreeNode, childRank: TreeRank, signal?: AbortSignal): Promise<UsageWithNames[]> {
  if (node.rank === 'ROOT') return listByRank('KINGDOM').then((page) => page.results);
  return getAllChildren(node.key, RANK_BY_CODE[childRank], signal);
}

/** Everything needed to list a node's children: the child taxa, their record and species counts, and common names. */
async function fetchChildData(node: TreeNode, childRank: TreeRank, wkt?: string, signal?: AbortSignal) {
  const facet = FACET_FOR[childRank];
  // The root stands for all of life, so its counts are unfiltered.
  const taxonKey = node.rank === 'ROOT' ? undefined : node.key;
  const [childUsages, recordFacets, species, nameIndex] = await Promise.all([
    childUsagesOf(node, childRank, signal),
    occurrenceFacets({ taxonKey, geometry: wkt }, [facet], { facetLimit: 5000, ...(signal && { signal }) }),
    childRank === 'S' ? Promise.resolve(null) : speciesCountsUnder(taxonKey, 5000, signal),
    nameIndexWithin(800),
  ]);
  const records = new Map((recordFacets.facets[facet] ?? []).map((entry) => [Number(entry.name), entry.count]));
  return { childUsages, records, species, nameIndex };
}

/** Fetch and attach the children of `node` (optionally scoped to a WKT area). */
export async function loadChildren(node: TreeNode, wkt?: string, signal?: AbortSignal): Promise<TreeNode[]> {
  const childRank = NEXT_RANK[node.rank];
  // A loaded root keeps its kingdoms, whatever the area: they're the whole tree's top level.
  if (!childRank || (node.rank === 'ROOT' && node.loaded)) return node.children ?? [];
  const { childUsages, records, species, nameIndex } = await fetchChildData(node, childRank, wkt, signal);
  const children: TreeNode[] = [];
  for (const child of childUsages) {
    if (CODE_BY_RANK[child.rank] !== childRank) continue;
    if (child.taxonomicStatus && child.taxonomicStatus !== 'ACCEPTED') continue;
    const recordCount = records.get(child.key) ?? 0;
    const speciesCount = childRank === 'S' ? 1 : (species?.get(child.key) ?? 0);
    if (recordCount === 0 && speciesCount === 0) continue;
    const raw = nameIndex?.get(child.key)?.commonName ?? englishName(child.vernacularNames ?? [], child.key);
    const common = raw ? capitalise(raw) : undefined;
    const name = child.canonicalName ?? child.scientificName;
    children.push({
      key: child.key,
      name,
      ...(common && { common }),
      rank: childRank,
      records: recordCount,
      species: speciesCount,
      parent: node,
      loaded: childRank === 'S',
      kingdom: childRank === 'K' ? name : node.kingdom,
    });
  }
  children.sort((left, right) => right.records - left.records || right.species - left.species);
  node.children = children;
  node.loaded = true;
  return children;
}

/** The node with this key in the loaded subtree, if any. */
export function findNode(root: TreeNode, key: number): TreeNode | undefined {
  if (root.key === key) return root;
  for (const child of root.children ?? []) {
    const hit = findNode(child, key);
    if (hit) return hit;
  }
  return undefined;
}

/** The nodes from the root down to `node`. */
export function pathTo(node: TreeNode): TreeNode[] {
  const out: TreeNode[] = [];
  for (let cursor: TreeNode | undefined = node; cursor; cursor = cursor.parent) out.unshift(cursor);
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
  for (const ancestorKey of [...parents.map((ancestor) => ancestor.key), key]) {
    const next: TreeNode | undefined = findNode(current ?? root, ancestorKey);
    if (next) {
      current = next;
      continue;
    }
    if (current && !current.loaded) {
      await loadChildren(current, wkt);
      const loaded = current.children?.find((child) => child.key === ancestorKey);
      if (loaded) current = loaded;
    }
  }
  return current;
}
