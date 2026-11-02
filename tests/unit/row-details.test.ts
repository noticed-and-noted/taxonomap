// @vitest-environment jsdom
/** Lazy photo and name lookups for species-table rows. */
import { effectScope, nextTick, ref } from 'vue';
import type { SpeciesRow } from '~/lib/species/groups';

const lookups = vi.hoisted(() => ({
  photos: [] as number[][],
  names: [] as number[][],
  common: [] as number[][],
  gbif: [] as number[][],
}));

vi.mock('~/lib/species/groups', () => ({
  photosForKeys: async (
    keys: number[],
    _signal: unknown,
    _names: unknown,
    onCommonNames?: (names: ReadonlyMap<number, string>) => void,
  ) => {
    lookups.photos.push(keys);
    // Key 3's iNaturalist taxon has a common name; the others' have none.
    const commonNames = new Map(keys.filter((key) => key === 3).map((key) => [key, 'iNaturalist three']));
    onCommonNames?.(commonNames);
    // Key 1 has a photo (whose record names it); the others have none.
    return {
      images: new Map(keys.filter((key) => key === 1).map((key) => [key, { url: `p${key}`, licence: 'CC0' }])),
      names: new Map(keys.filter((key) => key === 1).map((key) => [key, 'Named by photo'])),
      commonNames,
    };
  },
  gbifCommonNames: async (keys: number[]) => {
    lookups.gbif.push(keys);
    return new Map(keys.filter((key) => key === 6).map((key) => [key, 'GBIF six']));
  },
  resolveNames: async (keys: number[]) => {
    lookups.names.push(keys);
    return new Map(keys.filter((key) => key === 2).map((key) => [key, 'Named by lookup']));
  },
  commonNames: async (keys: number[]) => {
    lookups.common.push(keys);
    return new Map(keys.filter((key) => key === 3).map((key) => [key, 'Common three']));
  },
}));

const row = (key: number, extra: Partial<SpeciesRow> = {}): SpeciesRow => ({
  key,
  scientificName: `Species ${key}`,
  records: 1,
  unnamed: true,
  ...extra,
});

async function setup(rows: SpeciesRow[]) {
  const { useRowDetails } = await import('~/composables/useRowDetails');
  const inView = ref(new Set<number>());
  const all = ref(false);
  const data = ref<object>({});
  const scope = effectScope();
  const details = scope.run(() =>
    useRowDetails({ rows: () => rows, dataset: () => data.value, inView, needAllNames: () => all.value }),
  )!;
  return { d: details, inView, all, data, stop: () => scope.stop() };
}

beforeEach(() => {
  lookups.photos = [];
  lookups.names = [];
  lookups.common = [];
  lookups.gbif = [];
});

describe('useRowDetails', () => {
  it('looks up rows only once they are in view, photos first', async () => {
    const { unnamed: _unnamed, ...named } = row(4);
    const rows: SpeciesRow[] = [row(1), row(2), row(3), named];
    const { d, inView, stop } = await setup(rows);
    expect(lookups.photos).toEqual([]);
    expect(d.pendingName(rows[0]!)).toBe(true);

    inView.value = new Set([1, 2, 3]);
    await vi.waitFor(() => expect(d.pendingName(rows[2]!)).toBe(false));
    expect(lookups.photos).toEqual([[1, 2, 3]]);
    // Row 1 was named by its photo's record, so only 2 and 3 needed a lookup.
    expect(lookups.names).toEqual([[2, 3]]);
    expect(rows.map((tableRow) => d.sciName(tableRow))).toEqual([
      'Named by photo',
      'Named by lookup',
      'Species 3',
      'Species 4',
    ]);
    expect(d.photoOf(rows[0]!)).toMatchObject({ url: 'p1' });
    expect([d.pendingPhoto(rows[1]!), d.pendingPhoto(rows[3]!)]).toEqual([false, true]);
    stop();
  });

  it('names rows in view from their photo lookup, asking GBIF only for those iNaturalist does not name', async () => {
    const { unnamed: _unnamed, ...five } = row(5, { commonName: 'Indexed five' });
    const rows = [row(3), five, row(6)];
    const { d, inView, stop } = await setup(rows);
    expect(d.commonName(rows[0]!)).toBeUndefined();
    inView.value = new Set([3, 5, 6]);
    await vi.waitFor(() => expect(d.commonName(rows[2]!)).toBe('GBIF six'));
    expect(d.commonName(rows[0]!)).toBe('iNaturalist three');
    expect(d.commonName(rows[1]!)).toBe('Indexed five');
    expect(lookups.gbif).toEqual([[6]]);
    // The photo lookup named them, so no common-name lookup of their own.
    expect(lookups.common).toEqual([]);
    stop();
  });

  it('looks up common names for rows that get no photo lookup', async () => {
    const rows = [row(3, { image: { url: 'p3', licence: 'CC0' } as NonNullable<SpeciesRow['image']> }), row(4)];
    const { d, inView, all, stop } = await setup(rows);
    inView.value = new Set([3]);
    all.value = true;
    await vi.waitFor(() => expect(d.commonName(rows[0]!)).toBe('Common three'));
    expect(lookups.photos).toEqual([]);
    expect(lookups.common).toEqual([[3, 4]]);
    stop();
  });

  it('asks for each key once, and every name when needed', async () => {
    const rows = [row(2), row(3)];
    const { inView, all, stop } = await setup(rows);
    inView.value = new Set([2]);
    await vi.waitFor(() => expect(lookups.names).toHaveLength(1));
    inView.value = new Set([2]);
    all.value = true;
    await vi.waitFor(() => expect(lookups.names).toHaveLength(2));
    expect(lookups.names).toEqual([[2], [3]]);
    stop();
  });

  it('starts over for a new data set', async () => {
    const rows = [row(3)];
    const { inView, data, stop } = await setup(rows);
    inView.value = new Set([3]);
    await vi.waitFor(() => expect(lookups.names).toHaveLength(1));
    data.value = {};
    inView.value = new Set([3]);
    await nextTick();
    await vi.waitFor(() => expect(lookups.names).toHaveLength(2));
    stop();
  });
});
