/**
 * Reads the pre-counted cubes (pipeline/README.md) over HTTP range requests: latest.json and the manifest
 * once, then for each view one footer per file and only the row groups that can hold the taxon and the
 * cells in view. Footers and row groups are kept, so a year change or a pan back over loaded ground
 * needs no network.
 */
import { parquetMetadataAsync, parquetReadObjects, type AsyncBuffer, type FileMetaData } from 'hyparquet';
import { compressors } from 'hyparquet-compressors';
import type { CubeResolution } from './grid';
import { inRanges, overlapsRanges, type CellRange } from './ranges';
import type { CubeQuery } from './route';

/** Enough for a cube file's footer in one request; hyparquet fetches the rest if a footer is bigger. */
const FOOTER_FETCH_BYTES = 1 << 15;

/** One cube file, as the manifest lists it. */
interface CubeFile {
  path: string;
  bytes: number;
  /** First and last taxon name in the file. */
  first: string;
  last: string;
}

/** The manifest bake_cubes.py writes. */
export interface CubeManifest {
  snapshot: string;
  partsRead: number;
  /** Parts in the whole snapshot; a sample read fewer. */
  partsTotal?: number;
  folders: Record<string, CubeFile[]>;
}

/** One map-cube row: records of a taxon in an H3 cell in a year. */
export interface MapRow {
  kingdom: string | null;
  taxon: string;
  year: number | null;
  cell: bigint;
  records: bigint;
}

/** An opened set of cubes. */
export interface CubeSet {
  snapshot: string;
  /** What to multiply counts by to estimate the whole snapshot: above 1 for a sample. */
  scale: number;
  /** One taxon's map rows at a resolution, limited to the view's cells unless `cellRanges` is null. */
  mapRows(query: CubeQuery, resolution: CubeResolution, cellRanges: readonly CellRange[] | null): Promise<MapRow[]>;
}

type Fetch = typeof fetch;

/** A file hyparquet reads in slices, each one a range request. */
function rangedFile(url: string, byteLength: number, fetcher: Fetch): AsyncBuffer {
  return {
    byteLength,
    async slice(start, end = byteLength) {
      // Through the HTTP cache the browser lets one request per URL through at a time, so parallel ranges
      // of one file would queue behind each other; the reader keeps its own cache instead.
      const response = await fetcher(url, { headers: { Range: `bytes=${start}-${end - 1}` }, cache: 'no-store' });
      if (response.status !== 206) throw new Error(`Cube file ignored the range request (${response.status})`);
      return response.arrayBuffer();
    },
  };
}

async function fetchJson<T>(url: URL, fetcher: Fetch): Promise<T> {
  const response = await fetcher(url.href);
  if (!response.ok) throw new Error(`Cubes answered ${response.status}`);
  return (await response.json()) as T;
}

/** A promise kept under `key`, dropped again if it fails so the next call retries. */
function cached<T>(store: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> {
  let loading = store.get(key);
  if (!loading) {
    loading = load();
    store.set(key, loading);
    loading.catch(() => store.delete(key));
  }
  return loading;
}

const columnIndex = (metadata: FileMetaData, name: string) =>
  metadata.row_groups[0]?.columns.findIndex((column) => column.meta_data?.path_in_schema[0] === name) ?? -1;

/**
 * Row ranges of the row groups that could hold the taxon. When the view's cell ranges are given and a
 * group holds only this taxon, its cell statistics say whether any of its cells are in view.
 */
export function groupsFor(metadata: FileMetaData, taxon: string, cellRanges: readonly CellRange[] | null) {
  const [taxonColumn, cellColumn] = [columnIndex(metadata, 'taxon'), columnIndex(metadata, 'cell')];
  const chosen: { rowStart: number; rowEnd: number }[] = [];
  let rowStart = 0;
  for (const group of metadata.row_groups) {
    const rowEnd = rowStart + Number(group.num_rows);
    const names = group.columns[taxonColumn]?.meta_data?.statistics;
    const cells = group.columns[cellColumn]?.meta_data?.statistics;
    const holdsTaxon = !names || (String(names.min_value) <= taxon && taxon <= String(names.max_value));
    const onlyTaxon = names?.min_value === taxon && names.max_value === taxon;
    const cellStats = cells && typeof cells.min_value === 'bigint' && typeof cells.max_value === 'bigint';
    const outOfView =
      cellRanges &&
      onlyTaxon &&
      cellStats &&
      !overlapsRanges(cells.min_value as bigint, cells.max_value as bigint, cellRanges);
    if (holdsTaxon && !outOfView) chosen.push({ rowStart, rowEnd });
    rowStart = rowEnd;
  }
  return chosen;
}

/** The cube files of one folder whose taxon range covers the name. */
function filesFor(manifest: CubeManifest, root: URL, folder: string, taxon: string): FileRef[] {
  return (manifest.folders[folder] ?? [])
    .filter((file) => file.first <= taxon && taxon <= file.last)
    .map((file) => ({ url: new URL(file.path, root).href, bytes: file.bytes }));
}

interface FileRef {
  url: string;
  bytes: number;
}

/** Reads a taxon's row groups from cube files, keeping every footer and row group it has read. */
function createRowReader(fetcher: Fetch) {
  const footers = new Map<string, Promise<{ file: AsyncBuffer; metadata: FileMetaData }>>();
  const groups = new Map<string, Promise<MapRow[]>>();

  const openFile = ({ url, bytes }: FileRef) =>
    cached(footers, url, async () => {
      const file = rangedFile(url, bytes, fetcher);
      return { file, metadata: await parquetMetadataAsync(file, { initialFetchSize: FOOTER_FETCH_BYTES }) };
    });

  return async (fileRef: FileRef, taxon: string, ranges: CellRange[] | null): Promise<MapRow[]> => {
    const { file, metadata } = await openFile(fileRef);
    const read = ({ rowStart, rowEnd }: { rowStart: number; rowEnd: number }) =>
      cached(groups, `${fileRef.url}#${rowStart}`, async () => {
        const rows = await parquetReadObjects({ file, metadata, compressors, rowStart, rowEnd });
        return rows as MapRow[];
      });
    return (await Promise.all(groupsFor(metadata, taxon, ranges).map(read))).flat();
  };
}

/**
 * Open a published set of cubes.
 * @param base the folder holding latest.json, such as a Hugging Face `resolve/main/` URL
 * @param fetcher fetch, or a stand-in for tests
 * @throws Error when latest.json or the manifest can't be read
 */
export async function openCubes(base: string, fetcher: Fetch = fetch): Promise<CubeSet> {
  const root = new URL(base, globalThis.location?.href);
  const latest = await fetchJson<{ snapshot: string; manifest: string }>(new URL('latest.json', root), fetcher);
  const manifest = await fetchJson<CubeManifest>(new URL(latest.manifest, root), fetcher);
  const snapshotRoot = new URL(`snapshots/${latest.snapshot}/`, root);
  const readFileRows = createRowReader(fetcher);

  return {
    snapshot: latest.snapshot,
    scale: manifest.partsTotal ? Math.max(1, manifest.partsTotal / manifest.partsRead) : 1,
    async mapRows(query, resolution, cellRanges) {
      const folder = `map/res=${resolution}/rank=${query.rank}`;
      const ranges = cellRanges ? [...cellRanges] : null;
      const files = filesFor(manifest, snapshotRoot, folder, query.taxon);
      const rows = (await Promise.all(files.map((fileRef) => readFileRows(fileRef, query.taxon, ranges)))).flat();
      return rows.filter((row) => row.taxon === query.taxon && (!ranges || inRanges(row.cell, ranges)));
    },
  };
}
