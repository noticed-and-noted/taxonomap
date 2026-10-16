// @vitest-environment jsdom
/** Lazy photo and name lookups for species-table rows. */
import { effectScope, nextTick, ref } from 'vue';
import type { SpeciesRow } from '~/lib/species/groups';

const lookups = vi.hoisted(() => ({
  photos: [] as number[][],
  names: [] as number[][],
}));

vi.mock('~/lib/species/groups', () => ({
  photosForKeys: async (keys: number[]) => {
    lookups.photos.push(keys);
    // Key 1 has a photo (whose record names it); the others have none.
    return {
      images: new Map(keys.filter((k) => k === 1).map((k) => [k, { url: `p${k}`, licence: 'CC0' }])),
      names: new Map(keys.filter((k) => k === 1).map((k) => [k, 'Named by photo'])),
    };
  },
  resolveNames: async (keys: number[]) => {
    lookups.names.push(keys);
    return new Map(keys.filter((k) => k === 2).map((k) => [k, 'Named by lookup']));
  },
}));

const row = (key: number, extra: Partial<SpeciesRow> = {}): SpeciesRow => ({
  key,
  scientificName: `Species ${key}`,
  records: 1,
  classKey: 212,
  unnamed: true,
  ...extra,
});

async function setup(rows: SpeciesRow[]) {
  const { useRowDetails } = await import('~/components/vue/useRowDetails');
  const inView = ref(new Set<number>());
  const all = ref(false);
  const data = ref<object>({});
  const scope = effectScope();
  const d = scope.run(() =>
    useRowDetails({ rows: () => rows, dataset: () => data.value, inView, needAllNames: () => all.value }),
  )!;
  return { d, inView, all, data, stop: () => scope.stop() };
}

beforeEach(() => {
  lookups.photos = [];
  lookups.names = [];
});

describe('useRowDetails', () => {
  it('looks up rows only once they are in view, photos first', async () => {
    const { unnamed: _, ...named } = row(4);
    const rows: SpeciesRow[] = [row(1), row(2), row(3), named];
    const { d, inView, stop } = await setup(rows);
    expect(lookups.photos).toEqual([]);
    expect(d.pendingName(rows[0]!)).toBe(true);

    inView.value = new Set([1, 2, 3]);
    await vi.waitFor(() => expect(d.pendingName(rows[2]!)).toBe(false));
    expect(lookups.photos).toEqual([[1, 2, 3]]);
    // Row 1 was named by its photo's record, so only 2 and 3 needed a lookup.
    expect(lookups.names).toEqual([[2, 3]]);
    expect(rows.map((r) => d.sciName(r))).toEqual(['Named by photo', 'Named by lookup', 'Species 3', 'Species 4']);
    expect(d.photoOf(rows[0]!)).toMatchObject({ url: 'p1' });
    expect([d.pendingPhoto(rows[1]!), d.pendingPhoto(rows[3]!)]).toEqual([false, true]);
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
