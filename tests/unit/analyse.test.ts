// @vitest-environment jsdom
/** Analyse mode: its URL state, the starting list's filter and the photo lookups for its rows. */
import { effectScope, nextTick, ref } from 'vue';

const lookups = vi.hoisted(() => ({ asked: [] as number[][], shouldFail: false }));
const flights = vi.hoisted(() => [] as unknown[]);

vi.mock('~/stores/fly-to-taxa', () => ({ flyToRecords: async (filter: unknown) => void flights.push(filter) }));

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
  return {
    ...(await import('~/stores/analyse')),
    ...(await import('~/stores/mode')),
    ...(await import('~/stores/map-filter')),
    ...(await import('~/stores/filters')),
    ...(await import('~/stores/fit-search')),
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve));

describe('Analyse state', () => {
  beforeEach(() => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia;
  });

  it('reads the species, view, years and month from the URL', async () => {
    const stores = await loadAnalyseStores('?analyse=1&ak=9515886&av=spread&ayr=2010-2020&am=7');
    expect(stores.$analyseMonth.get()).toBe(7);
    expect(stores.$analyseTaxon.get()).toBe(9515886);
    expect(stores.$analyseView.get()).toBe('spread');
    expect(stores.$analyseYears.get()).toEqual([2010, 2020]);
  });

  it('ignores a malformed year range, and keeps a range inside the years GBIF holds', async () => {
    expect((await loadAnalyseStores('?ayr=soon')).$analyseYears.get()).toBeNull();
    expect((await loadAnalyseStores('?ayr=1990-2015')).$analyseYears.get()).toEqual([1990, 2015]);
    expect((await loadAnalyseStores('?ayr=1400-2015')).$analyseYears.get()).toEqual([1500, 2015]);
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
    expect(stores.$analyseMonth.get()).toBe(1);
  });

  it('ignores a month outside 1 to 12', async () => {
    expect((await loadAnalyseStores('?am=13')).$analyseMonth.get()).toBe(1);
    expect((await loadAnalyseStores('?am=0')).$analyseMonth.get()).toBe(1);
  });

  it('moves the map to the species when search fits the map, and not otherwise', async () => {
    flights.length = 0;
    const stores = await loadAnalyseStores('?analyse=1');
    stores.$fitOnSearch.set(true);
    stores.analyseSpecies(5, 'migration');
    expect(flights).toEqual([{ taxonKey: 5, year: [2000, stores.analyseLastYear()] }]);
    stores.$fitOnSearch.set(false);
    stores.analyseSpecies(6, 'migration');
    expect(flights).toHaveLength(1);
  });
});

describe('what the map draws', () => {
  beforeEach(() => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia;
  });

  it('is the filters outside Analyse, or in Analyse before a species is picked', async () => {
    expect((await loadAnalyseStores('?ak=5')).$mapFilter.get()).toEqual({});
    const stores = await loadAnalyseStores('?analyse=1');
    expect(stores.$analyseFilter.get()).toBeNull();
    expect(stores.$mapFilter.get()).toEqual({});
  });

  it("is the species in Analyse's years, its month in Migration, under the kept filters", async () => {
    const stores = await loadAnalyseStores('?analyse=1&ak=5&ayr=2010-2020&am=4&taxon=212');
    const kept = stores.$occurrenceFilter.get();
    expect(kept.taxonKeys).toEqual([212]);
    expect(stores.$analyseFilter.get()).toEqual({ taxonKey: 5, year: [2010, 2020] });
    expect(stores.$mapFilter.get()).toEqual({ taxonKey: 5, year: [2010, 2020], months: [4] });
    stores.$analyseView.set('spread');
    expect(stores.$mapFilter.get()).toEqual({ taxonKey: 5, year: [2010, 2020] });
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
    expect(filterStartingSpecies('platypus')).toEqual([]);
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

describe('wrapStep', () => {
  it('steps within the range and loops round at either end', async () => {
    const { wrapStep } = await import('~/lib/analyse/timeline');
    expect(wrapStep(3, 1, 1, 12)).toBe(4);
    expect(wrapStep(12, 1, 1, 12)).toBe(1);
    expect(wrapStep(1, -1, 1, 12)).toBe(12);
    expect(wrapStep(2005, -7, 2000, 2010)).toBe(2009);
  });
});

describe('usePlayback', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('steps once a second while playing, waiting for the last step to draw', async () => {
    const { usePlayback, PLAY_INTERVAL_MS } = await import('~/composables/usePlayback');
    let isReady = true;
    const step = vi.fn();
    const scope = effectScope();
    const playback = scope.run(() => usePlayback(step, () => isReady))!;

    playback.toggle();
    expect(playback.isPlaying.value).toBe(true);
    vi.advanceTimersByTime(PLAY_INTERVAL_MS - 100);
    expect(step).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(step).toHaveBeenCalledTimes(1);

    isReady = false;
    vi.advanceTimersByTime(PLAY_INTERVAL_MS * 3);
    expect(step).toHaveBeenCalledTimes(1);
    isReady = true;
    vi.advanceTimersByTime(100);
    expect(step).toHaveBeenCalledTimes(2);

    playback.toggle();
    expect(playback.isPlaying.value).toBe(false);
    vi.advanceTimersByTime(PLAY_INTERVAL_MS * 3);
    expect(step).toHaveBeenCalledTimes(2);

    playback.toggle();
    scope.stop();
    expect(playback.isPlaying.value).toBe(false);
  });
});

describe('migration tags', () => {
  it('tags migrants and fish patterns, partial migrants apart, and leaves the rest untagged', async () => {
    const { migrationTag } = await import('~/lib/analyse/migration');
    expect(migrationTag('migratory')).toBe('Migrates');
    expect(migrationTag('anadromous')).toBe('Migrates');
    expect(migrationTag('partial')).toBe('Partly migrates');
    expect(migrationTag('nonmigratory')).toBeUndefined();
    expect(migrationTag(undefined)).toBeUndefined();
  });

  it('looks species up in the EOL table, loading it once', async () => {
    const { migrationTags } = await import('~/lib/analyse/migration');
    // The barn swallow migrates, the osprey partly, the grey squirrel doesn't; 1 isn't in the table.
    const tags = await migrationTags([9515886, 2480726, 5219681, 1]);
    expect(Object.fromEntries(tags)).toEqual({ 9515886: 'Migrates', 2480726: 'Partly migrates' });
    expect((await migrationTags([9515886])).get(9515886)).toBe('Migrates');
  });
});
