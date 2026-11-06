// @vitest-environment jsdom
/** Lazy photo and name lookups for species-table rows. */
import { effectScope, nextTick, ref } from 'vue';
import type { SpeciesRow } from '~/lib/species/groups';

const lookups = vi.hoisted(() => ({
  photos: [] as number[][],
  names: [] as number[][],
  common: [] as number[][],
  gbif: [] as number[][],
  /** Every lookup waits for this before answering, when set. */
  gate: null as Promise<void> | null,
  /** GBIF's common names wait for this, when set. */
  gbifGate: null as Promise<void> | null,
  /** Make the photo lookup fail, before or after it hands over common names. */
  photosFail: null as 'before-names' | 'after-names' | null,
}));

vi.mock('~/lib/species/groups', () => ({
  photosForKeys: async (
    keys: number[],
    _signal: unknown,
    onCommonNames?: (names: ReadonlyMap<number, string>) => void,
  ) => {
    lookups.photos.push(keys);
    await lookups.gate;
    if (lookups.photosFail === 'before-names') throw new Error('photos down');
    // Key 3's iNaturalist taxon has a common name; the others' have none.
    const commonNames = new Map(keys.filter((key) => key === 3).map((key) => [key, 'iNaturalist three']));
    onCommonNames?.(commonNames);
    if (lookups.photosFail === 'after-names') throw new Error('photos down');
    // Key 1 has a photo (whose record names it); the others have none.
    return {
      images: new Map(keys.filter((key) => key === 1).map((key) => [key, { url: `p${key}`, licence: 'CC0' }])),
      names: new Map(keys.filter((key) => key === 1).map((key) => [key, 'Named by photo'])),
      commonNames,
    };
  },
  gbifCommonNames: async (keys: number[]) => {
    lookups.gbif.push(keys);
    await (lookups.gbifGate ?? lookups.gate);
    return new Map(keys.filter((key) => key === 6).map((key) => [key, 'GBIF six']));
  },
  resolveNames: async (keys: number[]) => {
    lookups.names.push(keys);
    await lookups.gate;
    return new Map(keys.filter((key) => key === 2).map((key) => [key, 'Named by lookup']));
  },
  commonNames: async (keys: number[]) => {
    lookups.common.push(keys);
    await lookups.gate;
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
  lookups.gate = null;
  lookups.gbifGate = null;
  lookups.photosFail = null;
});

const image = (key: number) => ({ url: `p${key}`, licence: 'CC0' }) as NonNullable<SpeciesRow['image']>;

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

  /** Starts lookups for `keys` held at a gate, moves to a new data set whose lookups never answer, then opens the gate. */
  async function answerAfterNewDataSet(rows: SpeciesRow[], keys: number[]) {
    let release!: () => void;
    lookups.gate = new Promise<void>((resolve) => (release = resolve));
    const setUp = await setup(rows);
    setUp.inView.value = new Set(keys);
    await vi.waitFor(() => expect(lookups.photos.length + lookups.names.length).toBeGreaterThan(0));
    lookups.gate = new Promise(() => {});
    setUp.data.value = {};
    setUp.inView.value = new Set([...keys, 99]);
    await nextTick();
    release();
    await new Promise((resolve) => setTimeout(resolve, 10));
    return setUp;
  }

  it('drops names that answer after the data set changed', async () => {
    const { unnamed: _unnamed, ...three } = row(3, { image: image(3) });
    const rows = [row(2, { image: image(2) }), three];
    const { d, stop } = await answerAfterNewDataSet(rows, [2, 3]);
    expect(lookups.names[0]).toEqual([2]);
    expect(lookups.common[0]).toEqual([2, 3]);
    expect(d.sciName(rows[0]!)).toBe('Species 2');
    expect(d.isLoadingNames.value).toBe(true);
    expect(d.commonName(rows[1]!)).toBeUndefined();
    stop();
  });

  it('drops photos and their names that answer after the data set changed', async () => {
    const rows = [row(1), row(3)];
    const { d, stop } = await answerAfterNewDataSet(rows, [1, 3]);
    expect(lookups.photos[0]).toEqual([1, 3]);
    expect(d.photoOf(rows[0]!)).toBeUndefined();
    expect(d.commonName(rows[1]!)).toBeUndefined();
    expect(lookups.names).toEqual([]);
    stop();
  });

  it('drops GBIF’s common names when they answer after the data set changed', async () => {
    let release!: () => void;
    lookups.gbifGate = new Promise<void>((resolve) => (release = resolve));
    const rows = [row(6)];
    const { d, inView, data, stop } = await setup(rows);
    inView.value = new Set([6]);
    await vi.waitFor(() => expect(lookups.gbif).toHaveLength(1));
    lookups.gbifGate = new Promise(() => {});
    data.value = {};
    inView.value = new Set([6, 99]);
    await nextTick();
    release();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(d.commonName(rows[0]!)).toBeUndefined();
    stop();
  });

  it('asks no common names alongside photos for rows that already have one', async () => {
    const rows = [row(1, { commonName: 'Indexed one' })];
    const { d, inView, stop } = await setup(rows);
    inView.value = new Set([1]);
    await vi.waitFor(() => expect(d.photoOf(rows[0]!)).toMatchObject({ url: 'p1' }));
    expect(lookups.gbif).toEqual([]);
    expect(d.isLoadingNames.value).toBe(false);
    stop();
  });

  it('still asks GBIF for common names when the photo lookup fails before naming anything', async () => {
    lookups.photosFail = 'before-names';
    const rows = [row(6)];
    const { d, inView, stop } = await setup(rows);
    inView.value = new Set([6]);
    await vi.waitFor(() => expect(d.commonName(rows[0]!)).toBe('GBIF six'));
    expect(d.pendingPhoto(rows[0]!)).toBe(true);
    stop();
  });

  it('keeps the names a photo lookup handed over before it failed', async () => {
    lookups.photosFail = 'after-names';
    const rows = [row(3), row(6)];
    const { d, inView, stop } = await setup(rows);
    inView.value = new Set([3, 6]);
    await vi.waitFor(() => expect(d.commonName(rows[1]!)).toBe('GBIF six'));
    expect(d.commonName(rows[0]!)).toBe('iNaturalist three');
    expect(lookups.gbif).toEqual([[6]]);
    stop();
  });
});
