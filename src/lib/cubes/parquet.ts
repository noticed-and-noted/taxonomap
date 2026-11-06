/**
 * Reading Parquet files over HTTP range requests: one footer per file, then only the row groups asked
 * for, neighbours fetched together. Footers and row groups are kept, so asking again needs no network.
 */
import { parquetMetadataAsync, parquetReadObjects, type AsyncBuffer, type FileMetaData } from 'hyparquet';
import { compressors } from 'hyparquet-compressors';
import { rangesForGroups, type ByteRange } from './byteRanges';

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

/** Bytes of a file fetched ahead in one request, for the slices that fall inside them. */
interface Prefetched extends ByteRange {
  data: Promise<ArrayBuffer>;
}

/** One range request. */
async function fetchRange(url: string, start: number, end: number, fetcher: Fetch): Promise<ArrayBuffer> {
  // Through the HTTP cache the browser lets one request per URL through at a time, so parallel ranges
  // of one file would queue behind each other; the reader keeps its own cache instead.
  const response = await fetcher(url, { headers: { Range: `bytes=${start}-${end - 1}` }, cache: 'no-store' });
  if (response.status !== 206) throw new Error(`Cube file ignored the range request (${response.status})`);
  return response.arrayBuffer();
}

/** A file hyparquet reads in slices: from bytes fetched ahead when they hold the slice, else a range request. */
function rangedFile(url: string, byteLength: number, fetcher: Fetch, prefetched: Prefetched[]): AsyncBuffer {
  return {
    byteLength,
    async slice(start, end = byteLength) {
      const held = prefetched.find((range) => range.start <= start && end <= range.end);
      if (!held) return fetchRange(url, start, end, fetcher);
      return (await held.data).slice(start - held.start, end - held.start);
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

/** What fetching ahead needs to know about a reader: where bytes go, and which groups are already handled. */
interface AheadState {
  held: Prefetched[];
  requested: Set<string>;
  isUnread: (key: string) => boolean;
  fetcher: Fetch;
}

/**
 * Starts fetching some row groups of a file, near neighbours together (byteRanges.ts), into `held`,
 * leaving out the ones already read or on their way.
 */
function fetchAhead(fileRef: FileRef, metadata: FileMetaData, spans: readonly RowSpan[], state: AheadState) {
  // Two loads can ask for the same groups at once (a view, then the move that settles it).
  const unread = spans.flatMap((span) => {
    const key = `${fileRef.url}#${span.rowStart}`;
    return state.isUnread(key) ? [{ key, span }] : [];
  });
  unread.forEach(({ key }) => state.requested.add(key));
  for (const { start, end } of rangesForGroups(
    metadata,
    unread.map(({ span }) => span),
  )) {
    const range: Prefetched = { start, end, data: fetchRange(fileRef.url, start, end, state.fetcher) };
    state.held.push(range);
    // A failed fetch is forgotten, so the slices fall back to their own requests next time.
    range.data.catch(() => {
      state.held.splice(state.held.indexOf(range), 1);
      unread.forEach(({ key }) => state.requested.delete(key));
    });
  }
}

/**
 * Reads files' footers and row groups by range requests, keeping each one it has read.
 * @param fetcher fetch, or a stand-in for tests
 * @returns `metadata` for a file's footer, `prefetch` to start fetching row groups, `rows` for a group's rows
 */
export function createGroupReader(fetcher: Fetch) {
  const footers = new Map<string, Promise<{ file: AsyncBuffer; metadata: FileMetaData; held: Prefetched[] }>>();
  const groups = new Map<string, Promise<unknown[]>>();
  /** Row groups whose bytes are already on their way, by file and first row. */
  const requested = new Set<string>();
  const isUnread = (key: string) => !groups.has(key) && !requested.has(key);

  const openFile = ({ url, bytes, footer }: FileRef) =>
    cached(footers, url, async () => {
      const held: Prefetched[] = [];
      const file = rangedFile(url, bytes, fetcher, held);
      const initialFetchSize = Math.min(bytes, footer ?? FOOTER_FETCH_BYTES);
      return { file, held, metadata: await parquetMetadataAsync(file, { initialFetchSize }) };
    });

  return {
    metadata: async (fileRef: FileRef) => (await openFile(fileRef)).metadata,
    /** Start fetching the row groups a read is about to ask for, so `rows` finds their bytes on the way. */
    async prefetch(fileRef: FileRef, spans: readonly RowSpan[]) {
      const { metadata, held } = await openFile(fileRef);
      fetchAhead(fileRef, metadata, spans, { held, requested, isUnread, fetcher });
    },
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
