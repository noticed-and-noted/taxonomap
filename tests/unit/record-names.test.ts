/** Names for the cell's record list and species filter: the table's, then looked up a batch at a time. */
import type { Occurrence } from '~/lib/gbif';
import type { SpeciesRow } from '~/lib/species/groups';

const commonNames = vi.hoisted(() =>
  vi.fn<(keys: number[], signal?: AbortSignal, ranks?: ReadonlyMap<number, string>) => Promise<Map<number, string>>>(),
);
const resolveNames = vi.hoisted(() => vi.fn<(keys: number[]) => Promise<Map<number, string>>>());

vi.mock('~/lib/species/groups', () => ({ commonNames, resolveNames }));

const ROWS: SpeciesRow[] = [
  { key: 1, scientificName: 'Erithacus rubecula', commonName: 'European robin', records: 3 },
  { key: 2, scientificName: 'Species 2', records: 2, unnamed: true },
  { key: 3, scientificName: 'Pica pica', records: 1 },
];

const record = (fields: Partial<Occurrence>) => ({ key: 9, ...fields }) as Occurrence;

async function names(rows: SpeciesRow[] = ROWS) {
  const { useRecordNames } = await import('~/components/organisms/cell/useRecordNames');
  return useRecordNames(() => rows);
}

beforeEach(() => {
  commonNames.mockImplementation(async (keys) => new Map(keys.flatMap((key) => (key === 3 ? [[3, 'Magpie']] : []))));
  resolveNames.mockImplementation(async (keys) => new Map(keys.map((key) => [key, `Real name ${key}`])));
});

afterEach(() => vi.resetAllMocks());

describe('useRecordNames', () => {
  it('labels rows by the table’s common name, else the scientific name', async () => {
    const recordNames = await names();
    expect(ROWS.map(recordNames.labelOf)).toEqual(['European robin', 'Species 2', 'Pica pica']);
    expect(ROWS.map(recordNames.hasScientificName)).toEqual([true, false, true]);
  });

  it('looks up common names for unnamed species, a batch at a time, skipping known ones', async () => {
    const recordNames = await names();
    const keys = [1, 3, undefined, ...Array.from({ length: 25 }, (_unused, index) => 100 + index)];
    await recordNames.nameSpecies(keys);
    expect(commonNames.mock.calls.map(([batch]) => batch.length)).toEqual([20, 6]);
    expect(recordNames.labelOf(ROWS[2]!)).toBe('Magpie');
    await recordNames.nameSpecies([3]);
    expect(commonNames).toHaveBeenCalledTimes(2);
  });

  it('looks up each record’s taxon at its own rank', async () => {
    const recordNames = await names();
    await recordNames.nameRecords([record({ speciesKey: 5 }), record({ taxonKey: 136, taxonRank: 'CLASS' })]);
    const [keys, , ranks] = commonNames.mock.calls[0]!;
    expect(keys).toEqual([5, 136]);
    expect(ranks).toEqual(
      new Map([
        [5, 'SPECIES'],
        [136, 'CLASS'],
      ]),
    );
  });

  it('drops names that arrive after the lookup was cancelled', async () => {
    const recordNames = await names();
    const controller = new AbortController();
    commonNames.mockImplementation(async () => {
      controller.abort();
      return new Map([[3, 'Magpie']]);
    });
    await recordNames.nameSpecies([3], controller.signal);
    expect(recordNames.commonNameOf(ROWS[2]!)).toBeUndefined();
  });

  it('names the options once each, marking them pending until their names are back', async () => {
    const recordNames = await names();
    const done = recordNames.nameOptions([2, 3]);
    expect([...recordNames.pendingNames.value]).toEqual([2, 3]);
    await done;
    expect(recordNames.pendingNames.value.size).toBe(0);
    expect(recordNames.scientificNameOf(ROWS[1]!)).toBe('Real name 2');
    expect(recordNames.hasScientificName(ROWS[1]!)).toBe(true);
    expect(resolveNames).toHaveBeenCalledWith([2]);
    await recordNames.nameOptions([2, 3]);
    expect(commonNames).toHaveBeenCalledTimes(1);
  });

  it('keeps nothing new when a lookup finds no names, and clears pending when it fails', async () => {
    commonNames.mockResolvedValue(new Map());
    resolveNames.mockResolvedValue(new Map());
    const recordNames = await names();
    await recordNames.nameOptions([2]);
    expect(recordNames.scientificNameOf(ROWS[1]!)).toBe('Species 2');
    resolveNames.mockRejectedValue(new Error('down'));
    await expect(recordNames.nameOptions([3])).rejects.toThrow('down');
    expect(recordNames.pendingNames.value.size).toBe(0);
  });

  it('names a record by its species, else the name typed on it, else its scientific name', async () => {
    const recordNames = await names();
    await recordNames.nameSpecies([3]);
    expect(recordNames.recordName(record({ speciesKey: 1 }))).toBe('European robin');
    expect(recordNames.recordName(record({ speciesKey: 3 }))).toBe('Magpie');
    expect(recordNames.recordName(record({ speciesKey: 7, vernacularName: 'BLACKBIRD' }))).toBe('Blackbird');
    expect(recordNames.recordName(record({ species: 'Turdus merula' }))).toBe('Turdus merula');
    expect(recordNames.recordName(record({}))).toBe('Unnamed record');
  });
});
