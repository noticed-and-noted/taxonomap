/**
 * Where row groups sit in a Parquet file, and how to fetch several in few requests: row groups that are
 * next to each other (or nearly) are read as one range, so a view needing 12 groups makes 1 to 3
 * requests instead of 12, each paying a CDN round trip.
 */
import type { FileMetaData } from 'hyparquet';
import type { RowSpan } from './parquet';

/** A run of bytes: from `start`, up to but not including `end`. */
export interface ByteRange {
  start: number;
  end: number;
}

/** Bytes between two groups still worth fetching in one request rather than paying another round trip. */
export const MAX_GAP_BYTES = 128 * 1024;
/** The most one request fetches, so one slow request doesn't hold up a whole view. */
export const MAX_RANGE_BYTES = 4 * 1024 * 1024;

/** The bytes of each row group's column chunks, by the row it starts at. */
export function groupByteRanges(metadata: FileMetaData): Map<number, ByteRange> {
  const ranges = new Map<number, ByteRange>();
  let rowStart = 0;
  for (const group of metadata.row_groups) {
    // A group without page offsets can't be fetched ahead; its slices make their own requests.
    const chunks = group.columns.flatMap((column) =>
      column.meta_data?.data_page_offset === undefined ? [] : [column.meta_data],
    );
    const starts = chunks.map((chunk) => Number(chunk.dictionary_page_offset ?? chunk.data_page_offset));
    const ends = chunks.map((chunk, index) => starts[index]! + Number(chunk.total_compressed_size));
    if (chunks.length) ranges.set(rowStart, { start: Math.min(...starts), end: Math.max(...ends) });
    rowStart += Number(group.num_rows);
  }
  return ranges;
}

/** The byte ranges to fetch for some row groups: their own, with near neighbours joined. */
export function rangesForGroups(metadata: FileMetaData, spans: readonly RowSpan[]): ByteRange[] {
  const byRow = groupByteRanges(metadata);
  const wanted = spans
    .flatMap((span) => byRow.get(span.rowStart) ?? [])
    .sort((left, right) => left.start - right.start);
  const merged: ByteRange[] = [];
  for (const range of wanted) {
    const previous = merged.at(-1);
    const isNear = previous && range.start - previous.end <= MAX_GAP_BYTES;
    if (isNear && range.end - previous.start <= MAX_RANGE_BYTES) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}
