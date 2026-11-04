/**
 * Reading Parquet files over HTTP range requests: one footer per file, then only the row groups asked
 * for. Footers and row groups are kept, so asking again needs no network.
 */
import { parquetMetadataAsync, parquetReadObjects, type AsyncBuffer, type FileMetaData } from 'hyparquet';
import { compressors } from 'hyparquet-compressors';

/** Enough for a cube file's footer in one request; hyparquet fetches the rest if a footer is bigger. */
const FOOTER_FETCH_BYTES = 1 << 15;

export type Fetch = typeof fetch;

/** A file to read, and its size, which saves a request to find where its footer starts. */
export interface FileRef {
  url: string;
  bytes: number;
  /** The footer's length with its 8-byte tail, when the manifest gives it: the footer comes in one request. */
  footer?: number;
}

/** The rows of one row group: from `rowStart`, up to but not including `rowEnd`. */
export interface RowSpan {
  rowStart: number;
  rowEnd: number;
}

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

/**
 * A promise kept under `key`, dropped again if it fails so the next call retries.
 * @param store where promises are kept
 * @param load starts the work the first time
 */
export function cached<T>(store: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> {
  let loading = store.get(key);
  if (!loading) {
    loading = load();
    store.set(key, loading);
    loading.catch(() => store.delete(key));
  }
  return loading;
}

/** Where a named column sits in a file's row groups, or -1. */
export function columnIndex(metadata: FileMetaData, name: string): number {
  return metadata.row_groups[0]?.columns.findIndex((column) => column.meta_data?.path_in_schema[0] === name) ?? -1;
}

/**
 * Reads files' footers and row groups by range requests, keeping each one it has read.
 * @param fetcher fetch, or a stand-in for tests
 * @returns `metadata` for a file's footer and `rows` for one row group's rows
 */
export function createGroupReader(fetcher: Fetch) {
  const footers = new Map<string, Promise<{ file: AsyncBuffer; metadata: FileMetaData }>>();
  const groups = new Map<string, Promise<unknown[]>>();

  const openFile = ({ url, bytes, footer }: FileRef) =>
    cached(footers, url, async () => {
      const file = rangedFile(url, bytes, fetcher);
      const initialFetchSize = Math.min(bytes, footer ?? FOOTER_FETCH_BYTES);
      return { file, metadata: await parquetMetadataAsync(file, { initialFetchSize }) };
    });

  return {
    metadata: async (fileRef: FileRef) => (await openFile(fileRef)).metadata,
    async rows<Row>(fileRef: FileRef, { rowStart, rowEnd }: RowSpan): Promise<Row[]> {
      const { file, metadata } = await openFile(fileRef);
      const rows = cached(groups, `${fileRef.url}#${rowStart}`, () =>
        parquetReadObjects({ file, metadata, compressors, rowStart, rowEnd }),
      );
      return (await rows) as Row[];
    },
  };
}

export type GroupReader = ReturnType<typeof createGroupReader>;
