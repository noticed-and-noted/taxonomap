/**
 * Reading the cubes: latest.json and the manifest, the one file whose names cover a taxon, only the row
 * groups for that taxon and view (by their statistics), range requests, and kept results. hyparquet is
 * replaced, so the tests set each file's row groups directly.
 */
import type { FileMetaData } from 'hyparquet';
import {
  cellGroupsFor,
  groupsFor,
  nameGroupsFor,
  openCubes,
  type CellRow,
  type CubeManifest,
  type MapRow,
} from '~/lib/cubes/reader';
import type { CubeTaxon } from '~/lib/cubes/route';
import { mapRow } from './helpers/cubes';

const metadataFor = vi.fn<(url: string) => FileMetaData>();
const groupBytes = vi.fn<(rowStart: number) => [number, number] | undefined>();
const rowsFor = vi.fn<(url: string, rowStart: number) => (MapRow | CellRow)[]>();

vi.mock('hyparquet-compressors', () => ({ compressors: {} }));
vi.mock('hyparquet', () => ({
  async parquetMetadataAsync(
    file: { byteLength: number; slice: (start: number, end?: number) => Promise<ArrayBuffer> },
    options: { initialFetchSize: number },
  ) {
    // Read the file's tail through the reader's ranged file, as hyparquet does for the footer.
    await file.slice(file.byteLength - options.initialFetchSize);
    return metadataFor((file as unknown as { url: string }).url ?? '');
  },
  async parquetReadObjects(options: {
    file: { url: string; slice: (start: number, end?: number) => Promise<ArrayBuffer> };
    rowStart: number;
  }) {
    // Read the group's bytes through the ranged file when a test places them, as hyparquet would.
    const bytes = groupBytes(options.rowStart);
    if (bytes) await options.file.slice(...bytes);
    return rowsFor(options.file.url, options.rowStart);
  },
}));

const BASE = 'https://cubes.example/';
const FILE = `${BASE}snapshots/2026-11-01/map/res=4/rank=class/bucket=0/data_0.parquet`;
const birds: CubeTaxon = { rank: 'class', taxon: 'Aves' };

/** A row group's column statistics, by column name. */
function group(rows: number, stats: Record<string, { min_value: unknown; max_value: unknown } | undefined>) {
  const columns = ['kingdom', 'taxon', 'year', 'cell', 'records'].map((name) => ({
    meta_data: { path_in_schema: [name], statistics: stats[name] },
  }));
  return { num_rows: BigInt(rows), columns };
}

const metadata = (...groups: ReturnType<typeof group>[]) => ({ row_groups: groups }) as unknown as FileMetaData;

function manifest(overrides: Partial<CubeManifest> = {}): CubeManifest {
  const file = (path: string, first: string, last: string) => ({ path, bytes: 1000, first, last });
  return {
    snapshot: '2026-11-01',
    partsRead: 100,
    partsTotal: 10346,
    folders: {
      'map/res=4/rank=class': [
        file('map/res=4/rank=class/bucket=0/data_0.parquet', 'Actinopteri', 'Insecta'),
        file('map/res=4/rank=class/bucket=1/data_0.parquet', 'Liliopsida', 'Reptilia'),
      ],
    },
    ...overrides,
  };
}

/** A fetch that serves latest.json, the manifest and ranges of cube files, recording what was asked. */
function server(options: { manifest?: CubeManifest; status?: number; rangeStatus?: number; inline?: boolean } = {}) {
  const asked: { url: string; range?: string }[] = [];
  const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
    const range = (init?.headers as Record<string, string> | undefined)?.['Range'];
    asked.push({ url: input, ...(range && { range }) });
    if (input.endsWith('latest.json')) {
      const pointer = { snapshot: '2026-11-01', manifest: 'snapshots/2026-11-01/manifest.json' };
      const body = options.inline ? { ...pointer, ...(options.manifest ?? manifest()) } : pointer;
      return new Response(JSON.stringify(body), { status: options.status ?? 200 });
    }
    if (input.endsWith('manifest.json')) return Response.json(options.manifest ?? manifest());
    return new Response(new ArrayBuffer(8), { status: options.rangeStatus ?? 206 });
  });
  return { fetcher: fetcher as unknown as typeof fetch, asked };
}

const row = (taxon: string, cell: bigint, records = 1n): MapRow => mapRow({ taxon, cell, records });

beforeEach(() => {
  groupBytes.mockReset();
  metadataFor.mockReset();
  rowsFor.mockReset();
});

describe('openCubes', () => {
  it('reads the snapshot and scales a sample up to the whole snapshot', async () => {
    const { fetcher } = server();
    const cubes = await openCubes(BASE, fetcher);
    expect(cubes.snapshot).toBe('2026-11-01');
    expect(cubes.scale).toBeCloseTo(103.46);
    expect([cubes.partsRead, cubes.partsTotal]).toEqual([100, 10346]);
  });

  it('counts a full bake (or an older manifest without partsTotal) as is', async () => {
    const full = await openCubes(BASE, server({ manifest: manifest({ partsTotal: 100 }) }).fetcher);
    const { partsTotal: _partsTotal, ...olderManifest } = manifest();
    const older = await openCubes(BASE, server({ manifest: olderManifest }).fetcher);
    expect([full.scale, older.scale]).toEqual([1, 1]);
    expect([older.partsRead, older.partsTotal]).toEqual([100, 100]);
  });

  it('opens from latest.json alone when it carries the manifest', async () => {
    const { fetcher, asked } = server({ inline: true });
    expect((await openCubes(BASE, fetcher)).scale).toBeCloseTo(103.46);
    expect(asked.map((request) => request.url)).toEqual([`${BASE}latest.json`]);
  });

  it('throws when the cubes are not there', async () => {
    await expect(openCubes(BASE, server({ status: 404 }).fetcher)).rejects.toThrow('Cubes answered 404');
  });
});

describe('mapRows', () => {
  it('reads the lean map cube when asked and the bake has it, else the full one', async () => {
    const leanFile = {
      path: 'map-lean/res=4/rank=class/bucket=0/data_0.parquet',
      bytes: 1000,
      first: 'Aves',
      last: 'Aves',
    };
    const withLean = manifest({ folders: { ...manifest().folders, 'map-lean/res=4/rank=class': [leanFile] } });
    metadataFor.mockReturnValue(metadata(group(1, {})));
    rowsFor.mockReturnValue([row('Aves', 5n)]);
    const lean = server({ manifest: withLean });
    await (await openCubes(BASE, lean.fetcher)).mapRows(birds, 4, null, true);
    expect(lean.asked.some((request) => request.url.includes('/map-lean/'))).toBe(true);
    const older = server();
    await (await openCubes(BASE, older.fetcher)).mapRows(birds, 4, null, true);
    expect(older.asked.some((request) => request.url.includes('/map/res=4/'))).toBe(true);
  });

  it('reads only the file covering the taxon, by range requests, and keeps the taxon’s rows', async () => {
    const { fetcher, asked } = server();
    metadataFor.mockReturnValue(metadata(group(2, { taxon: { min_value: 'Aves', max_value: 'Aves' } })));
    rowsFor.mockReturnValue([row('Aves', 5n), row('Amphibia', 6n)]);
    const cubes = await openCubes(BASE, fetcher);
    expect(await cubes.mapRows(birds, 4, null)).toEqual([row('Aves', 5n)]);
    const fileRequests = asked.filter((request) => request.url.endsWith('.parquet'));
    expect(fileRequests).toEqual([{ url: FILE, range: 'bytes=0-999' }]);
  });

  it('keeps footers and row groups, so asking again reads nothing', async () => {
    const { fetcher, asked } = server();
    metadataFor.mockReturnValue(metadata(group(2, {})));
    rowsFor.mockReturnValue([row('Aves', 5n)]);
    const cubes = await openCubes(BASE, fetcher);
    await cubes.mapRows(birds, 4, null);
    const before = asked.length;
    await cubes.mapRows(birds, 4, null);
    expect(asked.length).toBe(before);
    expect(rowsFor).toHaveBeenCalledTimes(1);
  });

  it('limits rows to the view’s cells', async () => {
    metadataFor.mockReturnValue(metadata(group(3, {})));
    rowsFor.mockReturnValue([row('Aves', 5n), row('Aves', 50n)]);
    const cubes = await openCubes(BASE, server().fetcher);
    expect(await cubes.mapRows(birds, 4, [[1n, 10n]])).toEqual([row('Aves', 5n)]);
  });

  it('finds nothing for a taxon no file covers, or a folder the cubes lack', async () => {
    const cubes = await openCubes(BASE, server().fetcher);
    expect(await cubes.mapRows({ ...birds, taxon: 'Zygentoma' }, 4, null)).toEqual([]);
    expect(await cubes.mapRows(birds, 5, null)).toEqual([]);
    expect(metadataFor).not.toHaveBeenCalled();
  });

  it('fails when a file ignores the range request, and tries again next time', async () => {
    const cubes = await openCubes(BASE, server({ rangeStatus: 200 }).fetcher);
    await expect(cubes.mapRows(birds, 4, null)).rejects.toThrow('ignored the range request (200)');
    await expect(cubes.mapRows(birds, 4, null)).rejects.toThrow('ignored the range request');
  });
});

describe('chartRows', () => {
  it('reads one taxon’s rows from its rank’s charts folder', async () => {
    const chartFile = {
      path: 'charts/rank=class/bucket=0/data_0.parquet',
      bytes: 1000,
      first: 'Actinopteri',
      last: 'Insecta',
    };
    const { fetcher, asked } = server({ manifest: manifest({ folders: { 'charts/rank=class': [chartFile] } }) });
    metadataFor.mockReturnValue(metadata(group(2, {})));
    rowsFor.mockReturnValue([row('Aves', 0n), row('Amphibia', 0n)]);
    const cubes = await openCubes(BASE, fetcher);
    expect(await cubes.chartRows(birds)).toEqual([row('Aves', 0n)]);
    expect(asked.some((request) => request.url.includes('charts/rank=class'))).toBe(true);
  });
});

describe('chartRowsBetween', () => {
  it('reads the files and groups whose names overlap the range, keeping its rows', async () => {
    const chartFile = (path: string, first: string, last: string) => ({ path, bytes: 1000, first, last });
    const folders = {
      'charts/rank=species': [
        chartFile('charts/rank=species/bucket=0/data_0.parquet', 'Abies alba', 'Turdus iliacus'),
        chartFile('charts/rank=species/bucket=1/data_0.parquet', 'Turdus merula', 'Zea mays'),
        chartFile('charts/rank=species/bucket=2/data_0.parquet', 'Zebra', 'Zz'),
      ],
    };
    const { fetcher, asked } = server({ manifest: manifest({ folders }) });
    metadataFor.mockReturnValue(
      metadata(
        group(1, { taxon: { min_value: 'Abies alba', max_value: 'Picea abies' } }),
        group(1, { taxon: { min_value: 'Picea abies', max_value: 'Turdus merula' } }),
        group(1, {}),
      ),
    );
    rowsFor.mockReturnValue([row('Turdus merula', 0n), row('Turdidae x', 0n), row('Vulpes vulpes', 0n)]);
    const cubes = await openCubes(BASE, fetcher);
    const rows = await cubes.chartRowsBetween('species', 'Turdus ', 'Turdus ￿');
    expect(rows.map((found) => found.taxon)).toEqual([
      'Turdus merula',
      'Turdus merula',
      'Turdus merula',
      'Turdus merula',
    ]);
    expect(new Set(asked.map((request) => request.url.replace(/.*bucket=(d).*/, '$1'))).has('2')).toBe(false);
  });
});

describe('nameGroupsFor', () => {
  it('keeps groups whose names overlap the range, and groups without statistics', () => {
    const file = metadata(
      group(2, { taxon: { min_value: 'Aves', max_value: 'Aves' } }),
      group(3, { taxon: { min_value: 'Turdus a', max_value: 'Vulpes' } }),
      group(4, {}),
    );
    expect(nameGroupsFor(file, 'Turdus ', 'Turdus z')).toEqual([
      { rowStart: 2, rowEnd: 5 },
      { rowStart: 5, rowEnd: 9 },
    ]);
  });
});

describe('groupsFor', () => {
  const view: [bigint, bigint][] = [[100n, 200n]];
  const aves = { min_value: 'Aves', max_value: 'Aves' };

  it('skips groups whose names miss the taxon, and gives each group’s row range', () => {
    const file = metadata(
      group(10, { taxon: { min_value: 'Actinopteri', max_value: 'Amphibia' } }),
      group(20, { taxon: { min_value: 'Arachnida', max_value: 'Bivalvia' } }),
    );
    expect(groupsFor(file, 'Aves', null)).toEqual([{ rowStart: 10, rowEnd: 30 }]);
  });

  it('skips a group of only this taxon whose cells are all out of view', () => {
    const file = metadata(
      group(5, { taxon: aves, cell: { min_value: 1n, max_value: 50n } }),
      group(5, { taxon: aves, cell: { min_value: 150n, max_value: 300n } }),
    );
    expect(groupsFor(file, 'Aves', view)).toEqual([{ rowStart: 5, rowEnd: 10 }]);
  });

  it('keeps groups it can’t judge: several taxa, no cell statistics, no statistics at all', () => {
    const file = metadata(
      group(1, { taxon: { min_value: 'Arachnida', max_value: 'Bivalvia' }, cell: { min_value: 1n, max_value: 5n } }),
      group(1, { taxon: aves, cell: { min_value: 1, max_value: 5 } }),
      group(1, {}),
    );
    expect(groupsFor(file, 'Aves', view)).toHaveLength(3);
  });

  it('finds no groups in a file without any', () => {
    expect(groupsFor(metadata(), 'Aves', view)).toEqual([]);
  });
});

describe('warmCells and warmRecords', () => {
  it('fetch the footers of the files a view’s cells and records sit in, once each, ignoring failures', async () => {
    const byCell = (path: string, first: bigint, last: bigint) => ({
      path,
      bytes: 500,
      first: String(first),
      last: String(last),
    });
    const folders = {
      'cells/res=4': [
        byCell('cells/res=4/bucket=0/data_0.parquet', 1n, 100n),
        byCell('cells/res=4/bucket=1/data_0.parquet', 101n, 200n),
      ],
      records: [byCell('records/bucket=0/data_0.parquet', 0n, 2n ** 62n)],
    };
    const { fetcher, asked } = server({ manifest: manifest({ folders }) });
    metadataFor.mockReturnValue(metadata());
    const cubes = await openCubes(BASE, fetcher);
    await cubes.warmCells(4, [
      [5n, 6n],
      [7n, 8n],
    ]);
    expect(asked.filter((request) => request.url.includes('cells/')).map((request) => request.url)).toEqual([
      BASE + 'snapshots/2026-11-01/cells/res=4/bucket=0/data_0.parquet',
    ]);
    await cubes.warmCells(4, null);
    expect(asked.filter((request) => request.url.includes('cells/'))).toHaveLength(2);
    await cubes.warmCells(5, null);
    await cubes.warmRecords([[0x841f1d5ffffffffn, 0x841f1d5ffffffffn]]);
    expect(asked.filter((request) => request.url.includes('records/'))).toHaveLength(1);
    metadataFor.mockImplementation(() => {
      throw new Error('bad footer');
    });
    await expect((await openCubes(BASE, fetcher)).warmCells(4, null)).resolves.toBeUndefined();
  });
});

describe('cellGroupsFor', () => {
  it('keeps groups whose cells overlap the range, and groups without cell statistics', () => {
    const file = metadata(
      group(4, { cell: { min_value: 1n, max_value: 9n } }),
      group(4, { cell: { min_value: 10n, max_value: 20n } }),
      group(4, {}),
    );
    expect(cellGroupsFor(file, [12n, 12n])).toEqual([
      { rowStart: 4, rowEnd: 8 },
      { rowStart: 8, rowEnd: 12 },
    ]);
  });
});

describe('cell cube and records index', () => {
  const byCell = (path: string, first: bigint, last: bigint) => ({
    path,
    bytes: 500,
    first: String(first),
    last: String(last),
  });
  const cellManifest = manifest({
    folders: {
      'cells/res=4': [byCell('cells/res=4/bucket=0/data_0.parquet', 1n, 100n)],
      records: [
        byCell('records/bucket=1/data_0.parquet', 51n, 90n),
        byCell('records/bucket=0/data_0.parquet', 1n, 50n),
        byCell('records/bucket=2/data_0.parquet', 91n, 99n),
      ],
    },
  });
  const cellRow = (cell: bigint) => ({ cell, records: 1n }) as unknown as CellRow;

  it('reads one cell’s rows once, from the file and groups that hold it', async () => {
    const { fetcher, asked } = server({ manifest: cellManifest });
    metadataFor.mockReturnValue(metadata(group(2, { cell: { min_value: 1n, max_value: 100n } })));
    rowsFor.mockReturnValue([cellRow(42n), cellRow(43n)]);
    const cubes = await openCubes(BASE, fetcher);
    expect(await cubes.cellRows(42n, 4)).toEqual([cellRow(42n)]);
    const before = asked.length;
    await cubes.cellRows(42n, 4);
    expect(asked.length).toBe(before);
    // A bake from before the cell cube and records index: the panel falls back to GBIF.
    await expect(cubes.cellRows(42n, 5)).rejects.toThrow('These cubes have no cells/res=5');
    const older = await openCubes(BASE, server().fetcher);
    await expect(older.recordRows([1n, 2n]).next()).rejects.toThrow('These cubes have no records');
  });

  it('fetches a footer in one request when the manifest gives its length', async () => {
    const file = { ...byCell('cells/res=4/bucket=0/data_0.parquet', 1n, 100n), bytes: 5000, footer: 300 };
    const { fetcher, asked } = server({ manifest: manifest({ folders: { 'cells/res=4': [file] } }) });
    metadataFor.mockReturnValue(metadata());
    const cubes = await openCubes(BASE, fetcher);
    await cubes.cellRows(42n, 4);
    expect(asked.filter((request) => request.range).map((request) => request.range)).toEqual(['bytes=4700-4999']);
  });

  it('fetches row groups side by side in one request, and reads them from it', async () => {
    const placed = (rowStart: number) => ({
      num_rows: 1n,
      columns: [
        {
          meta_data: {
            path_in_schema: ['cell'],
            data_page_offset: BigInt(100 + rowStart * 50),
            total_compressed_size: 50n,
          },
        },
      ],
    });
    const { fetcher, asked } = server({ manifest: cellManifest });
    metadataFor.mockReturnValue({ row_groups: [placed(0), placed(1), placed(2)] } as unknown as FileMetaData);
    groupBytes.mockImplementation((rowStart) => [100 + rowStart * 50, 150 + rowStart * 50]);
    rowsFor.mockReturnValue([cellRow(42n)]);
    const cubes = await openCubes(BASE, fetcher);
    expect(await cubes.cellRows(42n, 4)).toHaveLength(3);
    const ranges = asked.filter((request) => request.range).map((request) => request.range);
    expect(ranges).toEqual(['bytes=0-499', 'bytes=100-249']);
  });

  it('falls back to each group’s own request after a failed combined read', async () => {
    const placed = (rowStart: number) => ({
      num_rows: 1n,
      columns: [
        {
          meta_data: {
            path_in_schema: ['cell'],
            data_page_offset: BigInt(100 + rowStart * 50),
            total_compressed_size: 50n,
          },
        },
      ],
    });
    const { fetcher, asked } = server({ manifest: cellManifest });
    const answer = vi.mocked(fetcher).getMockImplementation()!;
    vi.mocked(fetcher).mockImplementation(async (input, init) => {
      const range = (init?.headers as Record<string, string> | undefined)?.['Range'];
      if (range === 'bytes=100-199') return new Response('gone', { status: 500 });
      return answer(input, init);
    });
    metadataFor.mockReturnValue({ row_groups: [placed(0), placed(1)] } as unknown as FileMetaData);
    groupBytes.mockImplementation((rowStart) => [100 + rowStart * 50, 150 + rowStart * 50]);
    rowsFor.mockReturnValue([cellRow(42n)]);
    const cubes = await openCubes(BASE, fetcher);
    expect(await cubes.cellRows(42n, 4)).toHaveLength(2);
    const ranges = asked.map((request) => request.range).filter(Boolean);
    expect(ranges).toEqual(['bytes=0-499', 'bytes=100-149', 'bytes=150-199']);
    const rangesAsked = vi
      .mocked(fetcher)
      .mock.calls.map(([, init]) => (init?.headers as Record<string, string>)?.['Range']);
    expect(rangesAsked).toContain('bytes=100-199');
  });

  it('walks the records in a cell range a row group at a time, in cell order', async () => {
    const { fetcher } = server({ manifest: cellManifest });
    metadataFor.mockReturnValue(metadata(group(2, {})));
    // The walk is in order, so the first file read is the one with the lowest cells.
    rowsFor
      .mockReturnValueOnce([cellRow(10n), cellRow(49n)])
      .mockReturnValueOnce([cellRow(60n), cellRow(95n)])
      .mockReturnValueOnce([cellRow(92n), cellRow(99n)]);
    const cubes = await openCubes(BASE, fetcher);
    const groups: bigint[][] = [];
    for await (const rows of cubes.recordRows([40n, 95n])) groups.push(rows.map((row) => row.cell));
    expect(groups).toEqual([[49n], [60n, 95n], [92n]]);
  });
});
