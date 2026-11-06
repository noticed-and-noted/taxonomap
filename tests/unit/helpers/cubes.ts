/** Stand-in cubes and rows for the cube tests: every field set, so a test overrides only what it's about. */
import type { CellRow, ChartRow, CubeSet, MapRow, RecordRow } from '~/lib/cubes/reader';
import { LIFE, type CubeQuery } from '~/lib/cubes/route';

/** A query over every record, with no filters. */
export function cubeQuery(overrides: Partial<CubeQuery> = {}): CubeQuery {
  return { taxa: [LIFE], year: null, months: null, basis: null, media: 0, ...overrides };
}

const BLACKBIRD = {
  kingdom: 'Animalia',
  phylum: 'Chordata',
  class: 'Aves',
  order: 'Passeriformes',
  family: 'Turdidae',
  genus: 'Turdus',
  species: 'Turdus merula',
};

const FILTERS = { year: 2020, month: 5, basisofrecord: 'HUMAN_OBSERVATION', media: 0 };

/** A cell-cube row: a blackbird observation in May 2020, without media. */
export function cellRow(overrides: Partial<CellRow> = {}): CellRow {
  return { cell: 1n, ...BLACKBIRD, specieskey: 9, ...FILTERS, records: 1n, ...overrides };
}

/** A records-index row: the same blackbird record. */
export function recordRow(overrides: Partial<RecordRow> = {}): RecordRow {
  return { cell: 1n, gbifid: 1n, ...BLACKBIRD, specieskey: 9, ...FILTERS, ...overrides };
}

/** A map-cube row for birds. */
export function mapRow(overrides: Partial<MapRow> = {}): MapRow {
  return { kingdom: 'Animalia', taxon: 'Aves', cell: 1n, ...FILTERS, records: 1n, ...overrides };
}

/** A charts-cube row for birds. */
export function chartRow(overrides: Partial<ChartRow> = {}): ChartRow {
  return { kingdom: 'Animalia', taxon: 'Aves', ...FILTERS, records: 1n, ...overrides };
}

/** Opened cubes from a full bake, whose reads all find nothing unless a test says otherwise. */
export function cubeSet(overrides: Partial<CubeSet> = {}): CubeSet {
  return {
    snapshot: '2026-11-01',
    partsRead: 100,
    partsTotal: 100,
    scale: 1,
    mapRows: vi.fn(async () => []),
    chartRows: vi.fn(async () => []),
    cellRows: vi.fn(async () => []),
    chartRowsBetween: vi.fn(async () => []),
    warmCells: vi.fn(async () => undefined),
    warmRecords: vi.fn(async () => undefined),
    recordRows: vi.fn(async function* () {}),
    ...overrides,
  };
}
