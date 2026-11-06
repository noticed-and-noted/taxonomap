/**
 * An area from the cubes: when a hex is one, its rows, and paging its records from the records index
 * under the filters (and one species), across several cells, with the unscaled total.
 */
import { latLngToCell } from 'h3-js';
import { areaRows, cubeCellFor, recordPage, type CubeArea } from '~/lib/cubes/cell';
import type { CellRow, RecordRow } from '~/lib/cubes/reader';
import { cellRow, cubeQuery, cubeSet, recordRow } from './helpers/cubes';

const LONDON = latLngToCell(51.5, -0.1, 4);
const lookup = vi.fn(async (key: number) => (key === 212 ? { scientificName: 'Aves', rank: 'CLASS' } : null));
const birds = cubeQuery({ taxa: [{ rank: 'class', taxon: 'Aves' }] });

function withRows(groups: RecordRow[][], counted: CellRow[] = []) {
  return cubeSet({
    cellRows: vi.fn(async () => counted),
    recordRows: vi.fn(async function* () {
      yield* groups;
    }),
  });
}

describe('cubeCellFor', () => {
  const cubes = cubeSet();

  it('answers for a cube hex under the filters', async () => {
    const area = await cubeCellFor(LONDON, { taxonKey: 212, year: [2000, 2010] }, cubes, lookup);
    expect(area).toEqual({
      cubes,
      query: { ...birds, year: [2000, 2010] },
      cells: [BigInt(`0x${LONDON}`)],
      resolution: 4,
    });
    expect((await cubeCellFor(LONDON, {}, cubes, lookup))?.query.taxa[0]?.rank).toBe('life');
  });

  it('has none without cubes, for a GBIF hex, or for a taxon the cubes lack', async () => {
    expect(await cubeCellFor(LONDON, {}, null, lookup)).toBeNull();
    expect(await cubeCellFor(undefined, {}, cubes, lookup)).toBeNull();
    expect(await cubeCellFor('3:0,0', {}, cubes, lookup)).toBeNull();
    expect(await cubeCellFor(LONDON, { taxonKey: 7 }, cubes, lookup)).toBeNull();
  });
});

describe('areaRows', () => {
  it('reads every cell of the area', async () => {
    const cubes = cubeSet({ cellRows: vi.fn(async (cell: bigint) => [cellRow({ cell })]) });
    const rows = await areaRows({ cubes, query: birds, cells: [1n, 2n], resolution: 5 });
    expect(rows.map((row) => row.cell)).toEqual([1n, 2n]);
  });
});

describe('recordPage', () => {
  const record = (gbifid: number, overrides: Partial<RecordRow> = {}) =>
    recordRow({ gbifid: BigInt(gbifid), ...overrides });
  const groups = [
    [record(1), record(2, { class: 'Insecta' }), record(3)],
    [record(4, { specieskey: 7 }), record(5, { month: 1 })],
  ];
  const counted = [cellRow({ records: 3n }), cellRow({ class: 'Insecta', records: 1n })];
  const areaOf = (cubes = withRows(groups, counted), cells = [BigInt(`0x${LONDON}`)]): CubeArea => ({
    cubes,
    query: birds,
    cells,
    resolution: 4,
  });

  it('pages the matching records across row groups, with the area’s listed total', async () => {
    expect(await recordPage(areaOf(), null, { offset: 0, limit: 2 })).toEqual({ keys: [1, 3], total: 3 });
    expect(await recordPage(areaOf(), null, { offset: 2, limit: 2 })).toEqual({ keys: [4, 5], total: 3 });
    expect(await recordPage(areaOf(), 9, { offset: 0, limit: 10 })).toEqual({ keys: [1, 3, 5], total: 3 });
  });

  it('keeps to the filters', async () => {
    const area = { ...areaOf(), query: { ...birds, months: [1] } };
    expect((await recordPage(area, null, { offset: 0, limit: 10 })).keys).toEqual([5]);
  });

  it('walks each cell’s finest descendants, merged into ranges', async () => {
    const cubes = withRows(groups, counted);
    const cells = [latLngToCell(51.5, -0.1, 5), latLngToCell(40, 3, 5)].map((cell) => BigInt(`0x${cell}`));
    const [low, high] = [...cells].sort((left, right) => (left < right ? -1 : 1));
    await recordPage(areaOf(cubes, [high!, low!]), null, { offset: 0, limit: 100 });
    expect(vi.mocked(cubes.recordRows).mock.calls.map(([range]) => range)).toEqual([
      [low, low],
      [high, high],
    ]);
  });

  it('stops when the load is abandoned', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(recordPage(areaOf(), null, { offset: 0, limit: 2 }, controller.signal)).rejects.toThrow();
  });
});
