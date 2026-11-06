/**
 * The cell panel from the cubes: one read of the cell's rows, named the way GBIF's facets are, and
 * every class's species from the same rows, with no request. The naming helpers are replaced so the
 * test sees exactly the facets they're given.
 */
import type { NamedFacetCount } from '~/lib/gbif/graphql';
import type { CellRow } from '~/lib/cubes/reader';
import { cellRow, cubeQuery, cubeSet } from './helpers/cubes';

const namedClasses = vi.fn(async (counts: readonly NamedFacetCount[]) =>
  counts.map((facet) => ({ key: Number(facet.name), name: facet.label ?? '', records: facet.count })),
);
const topSpecies = vi.fn(async (_filter: unknown, options: { known?: readonly NamedFacetCount[] }) =>
  (options.known ?? []).map((facet) => ({
    key: Number(facet.name),
    scientificName: facet.label ?? '',
    records: facet.count,
  })),
);

vi.mock('~/lib/species/groups', () => ({
  classKeysByName: async () => new Map([['Aves', 212]]),
  namedClasses,
  topSpecies,
}));

const { cellPanel } = await import('~/lib/cubes/cellPanel');

function row(className: string, species: string, specieskey: number, records: number): CellRow {
  return cellRow({ class: className, species, specieskey, month: 3, records: BigInt(records) });
}

const ROWS = [
  row('Aves', 'Turdus merula', 9, 4),
  row('Insecta', 'Apis mellifera', 4, 6),
  row('Arachnida', 'Araneus diadematus', 5, 1),
];

function cubeCell(rows = ROWS) {
  const cubes = cubeSet({ scale: 2, cellRows: vi.fn(async () => rows) });
  return { cubes, query: cubeQuery(), cells: [1n], resolution: 4 };
}

describe('cellPanel', () => {
  it('builds the whole panel from the cell’s rows, with stand-in keys for classes the tree lacks', async () => {
    const panel = await cellPanel(cubeCell(), { classes: 50, species: 200 });
    expect(panel.count).toBe(22);
    expect(panel.months[2]).toBe(22);
    const signal = new AbortController().signal;
    const { classes, species } = await panel.lists(signal);
    expect(classes).toEqual([
      { key: -1, name: 'Insecta', records: 12 },
      { key: 212, name: 'Aves', records: 8 },
      { key: -2, name: 'Arachnida', records: 2 },
    ]);
    expect(species.map((row) => row.key)).toEqual([4, 9, 5]);
    expect(topSpecies.mock.lastCall![1]).toMatchObject({ signal });
  });

  it('lists a class’s species from the same rows, and the whole cell’s for null or an unknown class', async () => {
    const { cubes, ...rest } = cubeCell();
    const panel = await cellPanel({ cubes, ...rest }, { classes: 50, species: 200 });
    expect((await panel.groupSpecies(212)).map((species) => species.key)).toEqual([9]);
    expect(await panel.groupSpecies(null)).toHaveLength(3);
    expect(await panel.groupSpecies(999)).toHaveLength(3);
    expect(cubes.cellRows).toHaveBeenCalledTimes(1);
  });
});
