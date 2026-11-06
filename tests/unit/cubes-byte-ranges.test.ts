/** Where row groups sit in a file, and joining near neighbours into few range requests. */
import type { FileMetaData } from 'hyparquet';
import { groupByteRanges, MAX_GAP_BYTES, MAX_RANGE_BYTES, rangesForGroups } from '~/lib/cubes/byteRanges';

/** A file whose row groups (10 rows each) sit at the given [start, end) bytes, as two column chunks each. */
function file(...groups: [number, number][]): FileMetaData {
  const row_groups = groups.map(([start, end]) => {
    const middle = Math.floor((start + end) / 2);
    return {
      num_rows: 10n,
      columns: [
        {
          meta_data: {
            dictionary_page_offset: BigInt(start),
            data_page_offset: BigInt(start + 1),
            total_compressed_size: BigInt(middle - start),
          },
        },
        { meta_data: { data_page_offset: BigInt(middle), total_compressed_size: BigInt(end - middle) } },
      ],
    };
  });
  return { row_groups } as unknown as FileMetaData;
}

const span = (group: number) => ({ rowStart: group * 10, rowEnd: group * 10 + 10 });

describe('groupByteRanges', () => {
  it('spans each group’s column chunks, from its first page', () => {
    expect([...groupByteRanges(file([4, 100], [100, 250]))]).toEqual([
      [0, { start: 4, end: 100 }],
      [10, { start: 100, end: 250 }],
    ]);
  });

  it('leaves out groups without page offsets', () => {
    const bare = { row_groups: [{ num_rows: 5n, columns: [{ meta_data: {} }, {}] }] } as unknown as FileMetaData;
    expect(groupByteRanges(bare).size).toBe(0);
  });
});

describe('rangesForGroups', () => {
  it('joins neighbours and near neighbours into one range, in file order', () => {
    const metadata = file([0, 100], [100, 200], [200 + MAX_GAP_BYTES, 300 + MAX_GAP_BYTES]);
    expect(rangesForGroups(metadata, [span(2), span(0), span(1)])).toEqual([{ start: 0, end: 300 + MAX_GAP_BYTES }]);
  });

  it('keeps far-apart groups, and groups that would make a range too big, apart', () => {
    const far = file([0, 100], [101 + MAX_GAP_BYTES, 200 + MAX_GAP_BYTES]);
    expect(rangesForGroups(far, [span(0), span(1)])).toHaveLength(2);
    const big = file([0, MAX_RANGE_BYTES - 10], [MAX_RANGE_BYTES - 10, MAX_RANGE_BYTES + 10]);
    expect(rangesForGroups(big, [span(0), span(1)])).toHaveLength(2);
  });

  it('skips spans the file doesn’t hold', () => {
    expect(rangesForGroups(file([0, 100]), [span(5)])).toEqual([]);
  });
});
