// @vitest-environment jsdom
/** Analyse mode: its URL state, the starting list's filter and the photo lookups for its rows. */
import { effectScope, nextTick, ref } from 'vue';

const lookups = vi.hoisted(() => ({ asked: [] as number[][], shouldFail: false }));

vi.mock('~/lib/species/groups', () => ({
  photosForKeys: async (keys: number[]) => {
    lookups.asked.push(keys);
    if (lookups.shouldFail) throw new Error('photos down');
    return {
      images: new Map(keys.filter((key) => key === 1).map((key) => [key, { url: 'p1', licence: 'CC0' }])),
      names: new Map(),
      commonNames: new Map(keys.filter((key) => key === 2).map((key) => [key, 'Two'])),
      counts: new Map(),
    };
  },
}));

async function loadAnalyseStores(search = '') {
  vi.resetModules();
  history.replaceState(null, '', `/${search}`);
  return { ...(await import('~/stores/analyse')), ...(await import('~/stores/mode')) };
}

const flush = () => new Promise((resolve) => setTimeout(resolve));

describe('Analyse state', () => {
  beforeEach(() => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia;
  });

  it('reads the species, view and years from the URL', async () => {
    const stores = await loadAnalyseStores('?analyse=1&ak=9515886&av=spread&ayr=2010-2020');
    expect(stores.$analyseTaxon.get()).toBe(9515886);
    expect(stores.$analyseView.get()).toBe('spread');
    expect(stores.$analyseYears.get()).toEqual([2010, 2020]);
  });

  it('ignores a malformed year range, and keeps a range inside the years offered', async () => {
    expect((await loadAnalyseStores('?ayr=soon')).$analyseYears.get()).toBeNull();
    expect((await loadAnalyseStores('?ayr=1990-2015')).$analyseYears.get()).toEqual([2000, 2015]);
    const stores = await loadAnalyseStores('?ayr=2020-2010');
    expect(stores.$analyseYears.get()).toEqual([2020, 2020]);
  });

  it('treats every year as no range, so it stays out of the URL', async () => {
    const stores = await loadAnalyseStores();
    const { writeParams } = await import('~/stores/url-sync');
    expect(stores.clampYears(stores.ANALYSE_FIRST_YEAR, stores.analyseLastYear())).toBeNull();
    const params = new URLSearchParams();
    stores.$analyseYears.set([2012, 2018]);
    expect(writeParams(params).get('ayr')).toBe('2012-2018');
    stores.$analyseYears.set(null);
    expect(writeParams(params).has('ayr')).toBe(false);
  });

  it('picks a species in a view, and leaving Analyse drops its choices', async () => {
    const stores = await loadAnalyseStores('?analyse=1&ayr=2010-2020');
    stores.analyseSpecies(4989904, 'spread');
    await flush();
    expect(location.search).toContain('ak=4989904');
    expect(location.search).toContain('av=spread');
    stores.setMapMode('explore');
    expect(stores.$analyseTaxon.get()).toBeNull();
    expect(stores.$analyseView.get()).toBe('migration');
    expect(stores.$analyseYears.get()).toBeNull();
  });
});

describe('the starting species', () => {
  it('narrows by name, group or tag, ignoring case and accents', async () => {
    const { filterStartingSpecies, STARTING_SPECIES } = await import('~/lib/analyse/starting-species');
    expect(filterStartingSpecies('  ')).toBe(STARTING_SPECIES);
    expect(filterStartingSpecies('SWALLOW').map((species) => species.commonName)).toEqual(['Barn swallow']);
    expect(filterStartingSpecies('harmonia').map((species) => species.key)).toEqual([4989904]);
    expect(filterStartingSpecies('beetle').map((species) => species.commonName)).toEqual(['Harlequin ladybird']);
    expect(filterStartingSpecies('invasive').every((species) => species.tags.includes('Invasive'))).toBe(true);
    expect(filterStartingSpecies('balsàm').map((species) => species.commonName)).toEqual(['Himalayan balsam']);
    expect(filterStartingSpecies('zebra')).toEqual([]);
  });
});

describe('useLeadPhotos', () => {
  beforeEach(() => {
    lookups.asked = [];
    lookups.shouldFail = false;
  });

  it('asks for each key once and keeps the photos and common names found', async () => {
    const { useLeadPhotos } = await import('~/composables/useLeadPhotos');
    const keys = ref([1, 2]);
    const scope = effectScope();
    const photos = scope.run(() => useLeadPhotos(() => keys.value))!;
    expect(photos.isPending(1)).toBe(true);
    await flush();
    expect(photos.images.value.get(1)).toEqual({ url: 'p1', licence: 'CC0' });
    expect(photos.commonNames.value.get(2)).toBe('Two');
    expect(photos.isPending(2)).toBe(false);

    keys.value = [2, 3];
    await nextTick();
    await flush();
    keys.value = [3];
    await nextTick();
    expect(lookups.asked).toEqual([[1, 2], [3]]);
    scope.stop();
  });

  it('settles keys whose lookup failed, so their initials show', async () => {
    lookups.shouldFail = true;
    const { useLeadPhotos } = await import('~/composables/useLeadPhotos');
    const scope = effectScope();
    const photos = scope.run(() => useLeadPhotos(() => [1]))!;
    await flush();
    expect(photos.isPending(1)).toBe(false);
    expect(photos.images.value.size).toBe(0);
    scope.stop();
  });

  it('drops an answer that comes back after the component has gone', async () => {
    const { useLeadPhotos } = await import('~/composables/useLeadPhotos');
    const scope = effectScope();
    const photos = scope.run(() => useLeadPhotos(() => [1]))!;
    scope.stop();
    await flush();
    expect(photos.images.value.size).toBe(0);
  });
});
