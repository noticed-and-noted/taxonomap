/**
 * Reading the cubes: latest.json and the manifest, the one file whose names cover a taxon, only the row
 * groups for that taxon and view (by their statistics), range requests, and kept results. hyparquet is
 * replaced, so the tests set each file's row groups directly.
 */
import type { FileMetaData } from 'hyparquet';
import { cellGroupsFor, groupsFor, openCubes, type CellRow, type CubeManifest, type MapRow } from '~/lib/cubes/reader';
import type { CubeQuery } from '~/lib/cubes/route';

const metadataFor = vi.fn<(url: string) => FileMetaData>();
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
  async parquetReadObjects(options: { file: { url: string }; rowStart: number }) {
    return rowsFor(options.file.url, options.rowStart);
  },
}));

const BASE = 'https://cubes.example/';
const FILE = `${BASE}snapshots/2026-11-01/map/res=4/rank=class/bucket=0/data_0.parquet`;
const birds: CubeQuery = { rank: 'class', taxon: 'Aves', year: null };

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
function server(options: { manifest?: CubeManifest; status?: number; rangeStatus?: number } = {}) {
  const asked: { url: string; range?: string }[] = [];
  const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
    const range = (init?.headers as Record<string, string> | undefined)?.['Range'];
    asked.push({ url: input, ...(range && { range }) });
    if (input.endsWith('latest.json')) {
      const body = { snapshot: '2026-11-01', manifest: 'snapshots/2026-11-01/manifest.json' };
      return new Response(JSON.stringify(body), { status: options.status ?? 200 });
    }
    if (input.endsWith('manifest.json')) return Response.json(options.manifest ?? manifest());
    return new Response(new ArrayBuffer(8), { status: options.rangeStatus ?? 206 });
  });
  return { fetcher: fetcher as unknown as typeof fetch, asked };
}

const row = (taxon: string, cell: bigint, records = 1n): MapRow => ({
  kingdom: 'Animalia',
  taxon,
  year: 2020,
  cell,
  records,
});

beforeEach(() => {
  metadataFor.mockReset();
  rowsFor.mockReset();
});

describe('openCubes', () => {
  it('reads the snapshot and scales a sample up to the whole snapshot', async () => {
    const { fetcher } = server();
    const cubes = await openCubes(BASE, fetcher);
    expect(cubes.snapshot).toBe('2026-11-01');
    expect(cubes.scale).toBeCloseTo(103.46);
  });

  it('counts a full bake (or an older manifest without partsTotal) as is', async () => {
    const full = await openCubes(BASE, server({ manifest: manifest({ partsTotal: 100 }) }).fetcher);
    const { partsTotal: _partsTotal, ...olderManifest } = manifest();
    const older = await openCubes(BASE, server({ manifest: olderManifest }).fetcher);
    expect([full.scale, older.scale]).toEqual([1, 1]);
  });

  it('throws when the cubes are not there', async () => {
    await expect(openCubes(BASE, server({ status: 404 }).fetcher)).rejects.toThrow('Cubes answered 404');
  });
});

describe('mapRows', () => {
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
