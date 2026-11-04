/**
 * Reads the pre-counted cubes (pipeline/README.md): latest.json and the manifest once, then only the row
 * groups a question needs, by range requests (parquet.ts). The map cube is sorted by taxon then cell, so
 * a view reads one taxon's groups for the cells in view; the cell cube and records index are sorted by
 * cell, so a clicked hex reads only its own groups.
 */
import type { FileMetaData } from 'hyparquet';
import type { CubeResolution } from './grid';
import {
  cached,
  columnIndex,
  createGroupReader,
  type Fetch,
  type FileRef,
  type GroupReader,
  type RowSpan,
} from './parquet';
import { inRanges, overlapsRanges, type CellRange } from './ranges';
import type { CubeQuery } from './route';

/** One cube file, as the manifest lists it. */
interface CubeFile {
  path: string;
  bytes: number;
  /** The footer's length with its 8-byte tail (manifests from before it was added lack it). */
  footer?: number;
  /** First and last key in the file: a taxon name, or a cell number written in decimal. */
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

/** A taxon's full path and year, which the cell cube and records index both carry for filtering. */
export interface TaxonPathRow {
  kingdom: string | null;
  phylum: string | null;
  class: string | null;
  order: string | null;
  family: string | null;
  genus: string | null;
  species: string | null;
  year: number | null;
}

/** One cell-cube row: records in a cell by taxon path, species, year and month. */
export interface CellRow extends TaxonPathRow {
  cell: bigint;
  specieskey: number | null;
  month: number | null;
  records: bigint;
}

/** One records-index row: a record's GBIF key, its finest cell and its taxon. */
export interface RecordRow extends TaxonPathRow {
  cell: bigint;
  gbifid: bigint;
  specieskey: number | null;
}

/** An opened set of cubes. */
export interface CubeSet {
  snapshot: string;
  /** What to multiply counts by to estimate the whole snapshot: above 1 for a sample. */
  scale: number;
  /** One taxon's map rows at a resolution, limited to the view's cells unless `cellRanges` is null. */
  mapRows(query: CubeQuery, resolution: CubeResolution, cellRanges: readonly CellRange[] | null): Promise<MapRow[]>;
  /** Every cell-cube row of one cell, whatever its taxon. */
  cellRows(cell: bigint, resolution: number): Promise<CellRow[]>;
  /** The records index's rows in a range of finest cells, a row group at a time, in index order. */
  recordRows(cellRange: CellRange): AsyncGenerator<RecordRow[]>;
}

type Stats = { min_value?: unknown; max_value?: unknown } | undefined;

const isCellStats = (stats: Stats): stats is { min_value: bigint; max_value: bigint } =>
  typeof stats?.min_value === 'bigint' && typeof stats.max_value === 'bigint';

/** Each row group's row span, with the statistics of the named columns. */
function spans(metadata: FileMetaData, names: readonly string[]) {
  const indexes = names.map((name) => columnIndex(metadata, name));
  let rowStart = 0;
  return metadata.row_groups.map((group) => {
    const rowEnd = rowStart + Number(group.num_rows);
    const span = { rowStart, rowEnd, stats: indexes.map((index) => group.columns[index]?.meta_data?.statistics) };
    rowStart = rowEnd;
    return span;
  });
}

/**
 * Row ranges of the row groups that could hold the taxon. When the view's cell ranges are given and a
 * group holds only this taxon, its cell statistics say whether any of its cells are in view.
 */
export function groupsFor(metadata: FileMetaData, taxon: string, cellRanges: readonly CellRange[] | null): RowSpan[] {
  return spans(metadata, ['taxon', 'cell'])
    .filter(({ stats: [names, cells] }) => {
      const holdsTaxon = !names || (String(names.min_value) <= taxon && taxon <= String(names.max_value));
      const onlyTaxon = names?.min_value === taxon && names.max_value === taxon;
      const outOfView =
        cellRanges && onlyTaxon && isCellStats(cells) && !overlapsRanges(cells.min_value, cells.max_value, cellRanges);
      return holdsTaxon && !outOfView;
    })
    .map(({ rowStart, rowEnd }) => ({ rowStart, rowEnd }));
}

/** Row ranges of the row groups whose cell statistics overlap a range of cells (or that have none). */
export function cellGroupsFor(metadata: FileMetaData, cellRange: CellRange): RowSpan[] {
  return spans(metadata, ['cell'])
    .filter(
      ({ stats: [cells] }) => !isCellStats(cells) || overlapsRanges(cells.min_value, cells.max_value, [cellRange]),
    )
    .map(({ rowStart, rowEnd }) => ({ rowStart, rowEnd }));
}

const toRef =
  (root: URL) =>
  ({ path, bytes, footer }: CubeFile): FileRef => ({
    url: new URL(path, root).href,
    bytes,
    ...(footer !== undefined && { footer }),
  });

/** The cube files of one folder whose taxon range covers the name. */
function filesFor(manifest: CubeManifest, root: URL, folder: string, taxon: string): FileRef[] {
  return (manifest.folders[folder] ?? []).filter((file) => file.first <= taxon && taxon <= file.last).map(toRef(root));
}

/**
 * The cube files of one folder whose cells overlap a range, in cell order.
 * @throws Error when the bake has no such folder (one from before the cell cube), so the panel asks GBIF
 */
function cellFilesFor(manifest: CubeManifest, root: URL, folder: string, [first, last]: CellRange): FileRef[] {
  const files = manifest.folders[folder];
  if (!files) throw new Error(`These cubes have no ${folder}`);
  return files
    .filter((file) => BigInt(file.first) <= last && first <= BigInt(file.last))
    .sort((left, right) => (BigInt(left.first) < BigInt(right.first) ? -1 : 1))
    .map(toRef(root));
}

/** The rows of every row group `choose` picks in each file, read in parallel. */
async function readGroups<Row>(reader: GroupReader, files: FileRef[], choose: (metadata: FileMetaData) => RowSpan[]) {
  const perFile = files.map(async (fileRef) => {
    const metadata = await reader.metadata(fileRef);
    return Promise.all(choose(metadata).map((span) => reader.rows<Row>(fileRef, span)));
  });
  return (await Promise.all(perFile)).flat(2);
}

async function fetchJson<T>(url: URL, fetcher: Fetch): Promise<T> {
  const response = await fetcher(url.href);
  if (!response.ok) throw new Error(`Cubes answered ${response.status}`);
  return (await response.json()) as T;
}

/** The questions an opened manifest can answer, each reading only the groups it needs. */
function createQueries(manifest: CubeManifest, root: URL, reader: GroupReader) {
  const cells = new Map<string, Promise<CellRow[]>>();
  return {
    async mapRows(query: CubeQuery, resolution: CubeResolution, cellRanges: readonly CellRange[] | null) {
      const ranges = cellRanges ? [...cellRanges] : null;
      const files = filesFor(manifest, root, `map/res=${resolution}/rank=${query.rank}`, query.taxon);
      const rows = await readGroups<MapRow>(reader, files, (metadata) => groupsFor(metadata, query.taxon, ranges));
      return rows.filter((row) => row.taxon === query.taxon && (!ranges || inRanges(row.cell, ranges)));
    },
    cellRows(cell: bigint, resolution: number) {
      return cached(cells, `${resolution}:${cell}`, async () => {
        const files = cellFilesFor(manifest, root, `cells/res=${resolution}`, [cell, cell]);
        const rows = await readGroups<CellRow>(reader, files, (metadata) => cellGroupsFor(metadata, [cell, cell]));
        return rows.filter((row) => row.cell === cell);
      });
    },
    async *recordRows(cellRange: CellRange) {
      for (const fileRef of cellFilesFor(manifest, root, 'records', cellRange)) {
        for (const span of cellGroupsFor(await reader.metadata(fileRef), cellRange)) {
          const rows = await reader.rows<RecordRow>(fileRef, span);
          yield rows.filter((row) => inRanges(row.cell, [cellRange]));
        }
      }
    },
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
  return {
    snapshot: latest.snapshot,
    scale: manifest.partsTotal ? Math.max(1, manifest.partsTotal / manifest.partsRead) : 1,
    ...createQueries(manifest, snapshotRoot, createGroupReader(fetcher)),
  };
}
