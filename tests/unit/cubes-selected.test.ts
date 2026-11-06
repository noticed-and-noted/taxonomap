/**
 * The panels in cube mode: an area only while the setting is on (waiting for the cubes to open, and an
 * error rather than GBIF when they can't answer), records found by key in the index's order, species
 * counts for the records search, the year chart and search previews from the charts cube.
 */
import { latLngToCell } from 'h3-js';
import { chartRow, cellRow, cubeQuery, cubeSet, recordRow } from './helpers/cubes';

const occurrencesByKeys = vi.fn(async (keys: readonly number[]) => keys.map((key) => ({ key })));

vi.mock('~/lib/gbif', async (original) => ({
  ...(await original<typeof import('~/lib/gbif')>()),
  occurrencesByKeys,
}));
vi.mock('~/stores/taxon', () => ({
  lookupTaxonRank: async (key: number) => (key === 212 ? { scientificName: 'Aves', rank: 'CLASS' } : null),
}));

const selected = await import('~/lib/cubes/selected');
const { $cubesOn, $openCubes } = await import('~/stores/cubes');

const CELL = latLngToCell(51.5, -0.1, 4);
const cubes = cubeSet({
  scale: 2,
  cellRows: vi.fn(async () => [cellRow({ specieskey: 9, records: 3n }), cellRow({ specieskey: 4, records: 1n })]),
  chartRows: vi.fn(async () => [chartRow({ year: 2001, records: 2n }), chartRow({ year: 2000, records: 1n })]),
  recordRows: vi.fn(async function* () {
    yield [recordRow({ gbifid: 11n }), recordRow({ gbifid: 12n })];
  }),
});

afterEach(() => {
  $cubesOn.set(false);
  $openCubes.set(null);
});

describe('selectedCubeArea', () => {
  it('is none outside cube mode, and the hex in it', async () => {
    expect(await selected.selectedCubeArea({ cell: CELL }, {})).toBeNull();
    $cubesOn.set(true);
    $openCubes.set(cubes);
    expect((await selected.selectedCubeArea({ cell: CELL }, {}))?.resolution).toBe(4);
  });

  it('fails in cube mode rather than leave the hex to GBIF', async () => {
    $cubesOn.set(true);
    $openCubes.set(cubes);
    await expect(selected.selectedCubeArea({ cell: CELL }, { taxonKey: 7 })).rejects.toThrow('no data for this hex');
  });
});

describe('nearCubeArea', () => {
  it('is the circle’s cells in cube mode, under its month', async () => {
    expect(await selected.nearCubeArea({ lat: 51.5, lng: -0.1, radiusKm: 10 }, {})).toBeNull();
    $cubesOn.set(true);
    $openCubes.set(cubes);
    const area = await selected.nearCubeArea({ lat: 51.5, lng: -0.1, radiusKm: 10, month: 4 }, { taxonKey: 212 });
    expect(area?.cells.length).toBeGreaterThan(0);
    expect(area?.query.months).toEqual([4]);
    await expect(selected.nearCubeArea({ lat: 0, lng: 0, radiusKm: 1 }, { taxonKey: 7 })).rejects.toThrow();
  });
});

describe('cubeRecords', () => {
  it('looks the index’s keys up at GBIF, in order', async () => {
    const page = await selected.cubeRecords({ cubes, query: cubeQuery(), cells: [1n], resolution: 4 }, null, {
      offset: 0,
      limit: 20,
    });
    expect(page).toEqual({ results: [{ key: 11 }, { key: 12 }], count: 4 });
    expect(occurrencesByKeys).toHaveBeenCalledWith([11, 12], undefined);
  });
});

describe('speciesInArea', () => {
  it('counts the asked-for species from the area’s rows, scaled', async () => {
    const counts = await selected.speciesInArea({ cubes, query: cubeQuery(), cells: [1n], resolution: 4 }, [9, 5]);
    expect(counts).toEqual(new Map([[9, 6]]));
  });
});

describe('cubeYearCounts', () => {
  it('counts years from the charts cube in cube mode only', async () => {
    expect(await selected.cubeYearCounts({})).toBeNull();
    $cubesOn.set(true);
    $openCubes.set(cubes);
    expect(await selected.cubeYearCounts({ taxonKey: 212 })).toEqual([
      [2000, 2],
      [2001, 4],
    ]);
    await expect(selected.cubeYearCounts({ taxonKey: 7 })).rejects.toThrow();
  });
});

describe('cubeTaxonTotal', () => {
  it('totals a taxon in cube mode, for ranks the cubes hold', async () => {
    expect(await selected.cubeTaxonTotal({ scientificName: 'Aves', rank: 'CLASS' })).toBeNull();
    $cubesOn.set(true);
    $openCubes.set(cubes);
    expect(await selected.cubeTaxonTotal({ scientificName: 'Aves', rank: 'CLASS' })).toBe(6);
    expect(await selected.cubeTaxonTotal({ scientificName: 'Abc d e', rank: 'SUBSPECIES' })).toBeNull();
  });
});
