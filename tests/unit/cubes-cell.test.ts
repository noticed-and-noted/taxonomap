/**
 * A clicked hex from the cubes: when the cubes can answer for it, and paging its records from the
 * records index under the filters (and one species), with the unscaled total.
 */
import { latLngToCell } from 'h3-js';
import { cubeCellFor, recordPage, type CubeCell } from '~/lib/cubes/cell';
import type { CellRow, CubeSet, RecordRow } from '~/lib/cubes/reader';

const LONDON = latLngToCell(51.5, -0.1, 4);
const lookup = vi.fn(async (key: number) => (key === 212 ? { scientificName: 'Aves', rank: 'CLASS' } : null));

function cubeSet(groups: RecordRow[][], cellRows: CellRow[] = []): CubeSet {
  return {
    snapshot: '2026-11-01',
    scale: 1,
    mapRows: vi.fn(),
    cellRows: vi.fn(async () => cellRows),
    recordRows: vi.fn(async function* () {
      yield* groups;
    }),
  };
}

const record = (gbifid: number, overrides: Partial<RecordRow> = {}): RecordRow => ({
  cell: 1n,
  gbifid: BigInt(gbifid),
  kingdom: 'Animalia',
  phylum: 'Chordata',
  class: 'Aves',
  order: null,
  family: null,
  genus: null,
  species: 'Turdus merula',
  specieskey: 9,
  year: 2020,
  ...overrides,
});

describe('cubeCellFor', () => {
  const cubes = cubeSet([]);

  it('answers for a cube hex under filters the cubes hold', async () => {
    const cell = await cubeCellFor(LONDON, { taxonKey: 212, year: [2000, 2010] }, cubes, lookup);
    expect(cell).toEqual({
      cubes,
      query: { rank: 'class', taxon: 'Aves', year: [2000, 2010] },
      cell: BigInt(`0x${LONDON}`),
      resolution: 4,
    });
    expect((await cubeCellFor(LONDON, {}, cubes, lookup))?.query.rank).toBe('life');
  });

  it('leaves GBIF to answer without cubes, for a GBIF hex, or for other filters', async () => {
    expect(await cubeCellFor(LONDON, {}, null, lookup)).toBeNull();
    expect(await cubeCellFor(undefined, {}, cubes, lookup)).toBeNull();
    expect(await cubeCellFor('3:0,0', {}, cubes, lookup)).toBeNull();
    expect(await cubeCellFor(LONDON, { country: 'GB' }, cubes, lookup)).toBeNull();
  });
});

describe('recordPage', () => {
  const groups = [
    [record(1), record(2, { class: 'Insecta' }), record(3)],
    [record(4, { specieskey: 7 }), record(5)],
  ];
  const counted: CellRow[] = [
    { ...record(0), month: 1, records: 3n },
    { ...record(0), class: 'Insecta', month: 1, records: 1n },
  ];
  const cellOf = (cubes: CubeSet): CubeCell => ({
    cubes,
    query: { rank: 'class', taxon: 'Aves', year: null },
    cell: BigInt(`0x${LONDON}`),
    resolution: 4,
  });

  it('pages the matching records across row groups, with the cell’s listed total', async () => {
    const cubes = cubeSet(groups, counted);
    expect(await recordPage(cellOf(cubes), null, { offset: 0, limit: 2 })).toEqual({ keys: [1, 3], total: 3 });
    expect(await recordPage(cellOf(cubes), null, { offset: 2, limit: 2 })).toEqual({ keys: [4, 5], total: 3 });
    expect(await recordPage(cellOf(cubes), 9, { offset: 0, limit: 10 })).toEqual({ keys: [1, 3, 5], total: 3 });
  });

  it('asks the records index for the cell’s finest descendants', async () => {
    const cubes = cubeSet(groups, counted);
    await recordPage(cellOf(cubes), null, { offset: 0, limit: 1 });
    const [[first, last]] = vi.mocked(cubes.recordRows).mock.calls[0]!;
    expect(last - first).toBeGreaterThan(0n);
  });

  it('stops when the load is abandoned', async () => {
    const controller = new AbortController();
    controller.abort();
    const page = recordPage(cellOf(cubeSet(groups, counted)), null, { offset: 0, limit: 2 }, controller.signal);
    await expect(page).rejects.toThrow();
  });
});
