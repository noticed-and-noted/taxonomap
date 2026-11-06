/**
 * Tree of life model. The top four ranks come from /data/tree.json; deeper
 * levels load live, three requests per expansion (no per-node calls):
 *   children (names) · occurrence facet on the child rank (records) ·
 *   species-search facet on higherTaxonKey (species counts).
 * In cube mode the record counts come from the charts cube instead (lib/cubes/tree.ts), the baked levels'
 * too; the children and species counts are taxonomy, so they still come from GBIF.
 */
import { loadSnapshot } from '~/lib/data/load';
import { nameIndexWithin } from '~/lib/data/name-index';
import { CODE_BY_RANK, RANK_BY_CODE } from '~/lib/data/ranks';
import type { TreeRank, TreeNodeRow } from '~/lib/data/types';
import { capitalise } from '~/lib/format';
import { CUBE_RANK_OF, countKey, namedTotals, rankTotals } from '~/lib/cubes/tree';
import {
  getAllChildren,
  getParents,
  occurrenceFacets,
  speciesCountsUnder,
  type FacetField,
  type UsageWithNames,
} from '~/lib/gbif';
import { englishName } from '~/lib/species/names';
import { $cubesOn, openedCubes } from '~/stores/cubes';

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

/** Every node below the root, depth first. */
function descendants(node: TreeNode): TreeNode[] {
  return (node.children ?? []).flatMap((child) => [child, ...descendants(child)]);
}

/** Replace the baked levels' record counts (the full data at build time) with the cubes'. */
async function countFromCubes(root: TreeNode) {
  const cubes = await openedCubes();
  const codes = ['K', 'P', 'C', 'O'] as const;
  const totals = new Map(
    await Promise.all(codes.map(async (code) => [code, await rankTotals(cubes, CUBE_RANK_OF[code])] as const)),
  );
  for (const node of descendants(root)) {
    const kingdom = node.rank === 'K' ? node.name : node.kingdom;
    node.records = totals.get(node.rank as (typeof codes)[number])?.get(countKey(kingdom, node.name)) ?? 0;
  }
  root.records = sum(root.children!, 'records');
  sortChildren(root);
}

/** The tree built from the baked snapshot, counted from the cubes in cube mode; null if the snapshot cannot be loaded. */
export async function loadBakedTree(): Promise<TreeNode | null> {
  const snapshot = await loadSnapshot('tree');
  if (!snapshot) return null;
  const tree = buildTree(snapshot.nodes);
  if ($cubesOn.get()) await countFromCubes(tree);
  return tree;
}

/** Records of each child, by key: one occurrence facet on the child rank. */
async function gbifChildRecords(node: TreeNode, childRank: TreeRank, wkt?: string, signal?: AbortSignal) {
  const facet = FACET_FOR[childRank];
  const options = { facetLimit: 5000, ...(signal && { signal }) };
  const result = await occurrenceFacets({ taxonKey: node.key, geometry: wkt }, [facet], options);
  return new Map((result.facets[facet] ?? []).map((entry) => [Number(entry.name), entry.count]));
}

/** Records of each child, by key, from the charts cube (cube mode). */
async function cubeChildRecords(node: TreeNode, childRank: TreeRank, children: Promise<UsageWithNames[]>) {
  const [cubes, usages] = await Promise.all([openedCubes(), children]);
  const nameOf = (usage: UsageWithNames) => usage.canonicalName ?? usage.scientificName;
  const genus = childRank === 'S' ? node.name : undefined;
  const totals = await namedTotals(cubes, CUBE_RANK_OF[childRank], usages.map(nameOf), genus);
  return new Map(usages.map((usage) => [usage.key, totals.get(countKey(node.kingdom, nameOf(usage))) ?? 0]));
}

/** Everything needed to list a node's children: the child taxa, their record and species counts, and common names. */
async function fetchChildData(node: TreeNode, childRank: TreeRank, wkt?: string, signal?: AbortSignal) {
  const children = getAllChildren(node.key, RANK_BY_CODE[childRank], signal);
  const [childUsages, records, species, nameIndex] = await Promise.all([
    children,
    $cubesOn.get() ? cubeChildRecords(node, childRank, children) : gbifChildRecords(node, childRank, wkt, signal),
    childRank === 'S' ? Promise.resolve(null) : speciesCountsUnder(node.key, 5000, signal),
    nameIndexWithin(800),
  ]);
  return { childUsages, records, species, nameIndex };
}

/** Fetch and attach the children of `node` (optionally scoped to a WKT area). */
export async function loadChildren(node: TreeNode, wkt?: string, signal?: AbortSignal): Promise<TreeNode[]> {
  const childRank = NEXT_RANK[node.rank];
  if (!childRank || node.rank === 'ROOT') return node.children ?? [];
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
    children.push({
      key: child.key,
      name: child.canonicalName ?? child.scientificName,
      ...(common && { common }),
      rank: childRank,
      records: recordCount,
      species: speciesCount,
      parent: node,
      loaded: childRank === 'S',
      kingdom: node.kingdom,
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
