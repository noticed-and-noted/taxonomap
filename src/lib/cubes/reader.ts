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
import { descendantRange, RECORD_RESOLUTION } from './cellBits';
import { inRanges, overlapsRanges, type CellRange } from './ranges';
import type { CubeRank, CubeTaxon } from './route';

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

/** The filters every cube carries on each row. */
export interface FilterRow {
  year: number | null;
  month: number | null;
  basisofrecord: string | null;
  /** Bits: photo 1, sound 2 (filters.ts). */
  media: number;
}

/** One map-cube row: records of a taxon in an H3 cell, by the filters. */
export interface MapRow extends FilterRow {
  kingdom: string | null;
  taxon: string;
  cell: bigint;
  records: bigint;
}

/** One charts-cube row: records of a taxon by the filters, with or without coordinates. */
export interface ChartRow extends FilterRow {
  kingdom: string | null;
  taxon: string;
  records: bigint;
}

/** A taxon's full path, which the cell cube and records index both carry for filtering. */
export interface TaxonPathRow {
  kingdom: string | null;
  phylum: string | null;
  class: string | null;
  order: string | null;
  family: string | null;
  genus: string | null;
  species: string | null;
}

/** One cell-cube row: records in a cell by taxon path, species and the filters. */
export interface CellRow extends TaxonPathRow, FilterRow {
  cell: bigint;
  specieskey: number | null;
  records: bigint;
}

/** One records-index row: a record's GBIF key, its finest cell, its taxon and the filters. */
export interface RecordRow extends TaxonPathRow, FilterRow {
  cell: bigint;
  gbifid: bigint;
  specieskey: number | null;
}

/** An opened set of cubes. */
export interface CubeSet {
  snapshot: string;
  /** Parts of the snapshot the bake read, and how many it has: a sample read fewer. */
  partsRead: number;
  partsTotal: number;
  /** What to multiply counts by to estimate the whole snapshot: above 1 for a sample. */
  scale: number;
  /** One taxon's map rows at a resolution, limited to the view's cells unless `cellRanges` is null. */
  /**
   * One taxon's map rows at a resolution, limited to the view's cells unless `cellRanges` is null. With
   * `lean`, from the lean map cube (taxon, year and place only), when the bake has it: for views with no
   * month, record type or media filter, a fraction of the bytes.
   */
  mapRows(
    taxon: CubeTaxon,
    resolution: CubeResolution,
    cellRanges: readonly CellRange[] | null,
    lean?: boolean,
  ): Promise<MapRow[]>;
  /** One taxon's charts-cube rows: all its records, with or without coordinates. */
  chartRows(taxon: CubeTaxon): Promise<ChartRow[]>;
  /** Charts-cube rows of every taxon at a rank whose name sorts between `first` and `last` (a whole rank, or a genus's species). */
  chartRowsBetween(rank: CubeRank, first: string, last: string): Promise<ChartRow[]>;
  /** Every cell-cube row of one cell, whatever its taxon. */
  cellRows(cell: bigint, resolution: number): Promise<CellRow[]>;
  /** The records index's rows in a range of finest cells, a row group at a time, in index order. */
  recordRows(cellRange: CellRange): AsyncGenerator<RecordRow[]>;
  /**
   * Fetch the footers of the cell cube files a view's cells sit in (all at that resolution for the whole
   * world), so a click on one of them reads its rows in one round trip. Resolves once they're in (or have failed, which a click retries).
   */
  warmCells(resolution: number, cellRanges: readonly CellRange[] | null): Promise<void>;
  /** The same for the records index files some cells' records sit in, for a hex's records tab. */
  warmRecords(cellRanges: readonly CellRange[]): Promise<void>;
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
  return filesBetween(manifest, root, folder, taxon, taxon);
}

/** The cube files of one folder whose taxon names overlap a range of names. */
function filesBetween(manifest: CubeManifest, root: URL, folder: string, first: string, last: string): FileRef[] {
  return (manifest.folders[folder] ?? []).filter((file) => file.first <= last && first <= file.last).map(toRef(root));
}

/** A place-sorted folder's files that some cells sit in (all of them for null), each once. */
function placeFilesFor(manifest: CubeManifest, root: URL, folder: string, cellRanges: readonly CellRange[] | null) {
  if (!manifest.folders[folder]) return [];
  if (!cellRanges) return manifest.folders[folder].map(toRef(root));
  const all = cellRanges.flatMap((range) => cellFilesFor(manifest, root, folder, range));
  return [...new Map(all.map((fileRef) => [fileRef.url, fileRef])).values()];
}

/** The finest cells under some cell ranges, as the records index keys them. */
const finestRanges = (cellRanges: readonly CellRange[]) =>
  cellRanges.map(([first, last]): CellRange => [
    descendantRange(first, RECORD_RESOLUTION)[0],
    descendantRange(last, RECORD_RESOLUTION)[1],
  ]);

/** Row ranges of the row groups whose taxon names overlap a range of names (or that have no statistics). */
export function nameGroupsFor(metadata: FileMetaData, first: string, last: string): RowSpan[] {
  return spans(metadata, ['taxon'])
    .filter(({ stats: [names] }) => !names || (String(names.min_value) <= last && first <= String(names.max_value)))
    .map(({ rowStart, rowEnd }) => ({ rowStart, rowEnd }));
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

/** The rows of every row group `choose` picks in each file, fetched together where they sit side by side. */
async function readGroups<Row>(reader: GroupReader, files: FileRef[], choose: (metadata: FileMetaData) => RowSpan[]) {
  const perFile = files.map(async (fileRef) => {
    const spans = choose(await reader.metadata(fileRef));
    await reader.prefetch(fileRef, spans);
    return Promise.all(spans.map((span) => reader.rows<Row>(fileRef, span)));
  });
  return (await Promise.all(perFile)).flat(2);
}

async function fetchJson<T>(url: URL, fetcher: Fetch): Promise<T> {
  const response = await fetcher(url.href);
  if (!response.ok) throw new Error(`Cubes answered ${response.status}`);
  return (await response.json()) as T;
}

/** The questions the taxon-sorted cubes (map, charts) answer. */
function createTaxonQueries(manifest: CubeManifest, root: URL, reader: GroupReader) {
  /** One taxon's rows from a taxon-sorted folder, within the cell ranges when given. */
  const taxonRows = async <Row extends { taxon: string }>(
    folder: string,
    taxon: string,
    ranges: CellRange[] | null,
  ) => {
    const files = filesFor(manifest, root, folder, taxon);
    const rows = await readGroups<Row>(reader, files, (metadata) => groupsFor(metadata, taxon, ranges));
    return rows.filter((row) => row.taxon === taxon);
  };
  return {
    async mapRows(
      { rank, taxon }: CubeTaxon,
      resolution: CubeResolution,
      cellRanges: readonly CellRange[] | null,
      lean = false,
    ) {
      const ranges = cellRanges ? [...cellRanges] : null;
      const leanFolder = `map-lean/res=${resolution}/rank=${rank}`;
      const folder = lean && manifest.folders[leanFolder] ? leanFolder : `map/res=${resolution}/rank=${rank}`;
      const rows = await taxonRows<MapRow>(folder, taxon, ranges);
      return ranges ? rows.filter((row) => inRanges(row.cell, ranges)) : rows;
    },
    chartRows({ rank, taxon }: CubeTaxon) {
      return taxonRows<ChartRow>(`charts/rank=${rank}`, taxon, null);
    },
    async chartRowsBetween(rank: CubeRank, first: string, last: string) {
      const files = filesBetween(manifest, root, `charts/rank=${rank}`, first, last);
      const rows = await readGroups<ChartRow>(reader, files, (metadata) => nameGroupsFor(metadata, first, last));
      return rows.filter((row) => row.taxon >= first && row.taxon <= last);
    },
  };
}

/** The questions the place-sorted cubes (cells, records index) answer. */
function createPlaceQueries(manifest: CubeManifest, root: URL, reader: GroupReader) {
  const cells = new Map<string, Promise<CellRow[]>>();
  // A footer that fails here is fetched again by the click that needs it.
  const warm = async (files: FileRef[]) => {
    await Promise.all(files.map((fileRef) => reader.metadata(fileRef).catch(() => undefined)));
  };
  return {
    warmCells(resolution: number, cellRanges: readonly CellRange[] | null) {
      return warm(placeFilesFor(manifest, root, `cells/res=${resolution}`, cellRanges));
    },
    warmRecords(cellRanges: readonly CellRange[]) {
      return warm(placeFilesFor(manifest, root, 'records', finestRanges(cellRanges)));
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
  const latest = await fetchJson<{ snapshot: string; manifest: string } & Partial<CubeManifest>>(
    new URL('latest.json', root),
    fetcher,
  );
  // A bake writes the manifest into latest.json too, saving a round trip; older bakes only point to it.
  const manifest = latest.folders
    ? (latest as CubeManifest)
    : await fetchJson<CubeManifest>(new URL(latest.manifest, root), fetcher);
  const snapshotRoot = new URL(`snapshots/${latest.snapshot}/`, root);
  const partsTotal = manifest.partsTotal ?? manifest.partsRead;
  const reader = createGroupReader(fetcher);
  return {
    snapshot: latest.snapshot,
    partsRead: manifest.partsRead,
    partsTotal,
    scale: Math.max(1, partsTotal / manifest.partsRead),
    ...createTaxonQueries(manifest, snapshotRoot, reader),
    ...createPlaceQueries(manifest, snapshotRoot, reader),
  };
}
