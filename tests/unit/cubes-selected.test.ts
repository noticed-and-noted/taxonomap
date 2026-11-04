/**
 * The selected hex and the cubes: a cube cell only while the setting is on and the cubes are open, and
 * a page of records found by key in the records index's order.
 */
import { latLngToCell } from 'h3-js';
import type { CubeSet, RecordRow } from '~/lib/cubes/reader';

const occurrencesByKeys = vi.fn(async (keys: readonly number[]) => keys.map((key) => ({ key })));

vi.mock('~/lib/gbif', async (original) => ({
  ...(await original<typeof import('~/lib/gbif')>()),
  occurrencesByKeys,
}));
vi.mock('~/stores/taxon', () => ({ lookupTaxon: async () => null }));

const { cubeRecords, selectedCubeCell } = await import('~/lib/cubes/selected');
const { $cubesOn, $openCubes } = await import('~/stores/cubes');

const CELL = latLngToCell(51.5, -0.1, 4);
const record = (gbifid: number): RecordRow => ({
  cell: 1n,
  gbifid: BigInt(gbifid),
  kingdom: null,
  phylum: null,
  class: null,
  order: null,
  family: null,
  genus: null,
  species: null,
  specieskey: null,
  year: null,
});
const cubes: CubeSet = {
  snapshot: '2026-11-01',
  scale: 1,
  mapRows: vi.fn(),
  cellRows: vi.fn(async () => []),
  recordRows: vi.fn(async function* () {
    yield [record(11), record(12)];
  }),
};

afterEach(() => {
  $cubesOn.set(false);
  $openCubes.set(null);
});

describe('selectedCubeCell', () => {
  it('is a cube cell only with the setting on and the cubes open', async () => {
    expect(await selectedCubeCell({ cell: CELL }, {})).toBeNull();
    $openCubes.set(cubes);
    expect(await selectedCubeCell({ cell: CELL }, {})).toBeNull();
    $cubesOn.set(true);
    expect((await selectedCubeCell({ cell: CELL }, {}))?.resolution).toBe(4);
  });
});

describe('cubeRecords', () => {
  it('looks the index’s keys up at GBIF, in order', async () => {
    const cubeCell = { cubes, query: { rank: 'life' as const, taxon: 'Life', year: null }, cell: 1n, resolution: 4 };
    const page = await cubeRecords(cubeCell, null, { offset: 0, limit: 20 });
    expect(page).toEqual({ results: [{ key: 11 }, { key: 12 }], count: 0 });
    expect(occurrencesByKeys).toHaveBeenCalledWith([11, 12], undefined);
  });
});
