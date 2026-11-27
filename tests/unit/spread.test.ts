// @vitest-environment jsdom
/** Analyse's Spread: first years per place, yearly arrivals, the cells drawn, and loading them year by year. */
import type { Hex } from '~/lib/map/occGrid';

const gbif = vi.hoisted(() => ({
  tileStatus: 200,
  countryYears: new Map<string, { count: number; years: Map<number, number> }>(),
  tileYears: [] as string[],
  yearFacets: null as { name: string; count: number }[] | null,
  facetFilters: [] as unknown[],
}));

/** A cell with a total, its id standing for its place. */
function hex(id: string, total: number, home = true): Hex {
  return {
    type: 'Feature',
    properties: { id, total, home },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 0],
        ],
      ],
    },
  };
}

/** Cells per year in the fake world tiles: "a" arrives slowly, "b" before the range, "c" never reaches two. */
const TILE_CELLS: Record<string, Hex[]> = {
  '1500,1999': [hex('b', 5)],
  '2000': [hex('a', 1), hex('c', 1)],
  '2001': [hex('a', 1), hex('a', 9, false)],
};

vi.mock('~/lib/map/hexDecoder', () => ({
  decodeOffThread: async (data: ArrayBuffer) => TILE_CELLS[new TextDecoder().decode(data)] ?? [],
}));

vi.mock('~/lib/gbif', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/lib/gbif')>()),
  occurrenceFacets: async (filter: unknown) => {
    gbif.facetFilters.push(filter);
    return { count: 0, facets: gbif.yearFacets ? { year: gbif.yearFacets } : {} };
  },
  countryYearCounts: async (filter: unknown) => {
    gbif.facetFilters.push(filter);
    return gbif.countryYears;
  },
}));

beforeEach(() => {
  gbif.tileStatus = 200;
  gbif.tileYears = [];
  vi.stubGlobal('fetch', async (url: string) => {
    const year = new URL(url).searchParams.get('year')!;
    gbif.tileYears.push(year);
    return new Response(gbif.tileStatus === 200 ? year : null, { status: gbif.tileStatus });
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('firstYears', () => {
  it('dates each place from the year its running total reaches two', async () => {
    const { firstYears } = await import('~/lib/analyse/spread');
    const found = firstYears(
      new Map([
        ['before', 3],
        ['once', 1],
      ]),
      new Map([
        [
          2001,
          new Map([
            ['once', 1],
            ['slow', 1],
          ]),
        ],
        [2000, new Map([['fast', 2]])],
        [2002, new Map([['slow', 1]])],
      ]),
      2000,
    );
    expect(Object.fromEntries(found)).toEqual({ before: 1999, fast: 2000, once: 2001, slow: 2002 });
  });
});

describe('yearlyArrivals', () => {
  it('counts the places new each year and those recorded before it', async () => {
    const { yearlyArrivals } = await import('~/lib/analyse/spread');
    const found = new Map([
      ['early', 1999],
      ['a', 2000],
      ['b', 2002],
      ['c', 2002],
      ['late', 2010],
    ]);
    expect(yearlyArrivals(found, 2000, 2002)).toEqual([
      { year: 2000, added: 1, before: 1 },
      { year: 2001, added: 0, before: 2 },
      { year: 2002, added: 2, before: 2 },
    ]);
  });
});

describe('spreadCollection', () => {
  const cells = {
    hexes: new Map([
      ['old', hex('old', 4)],
      ['new', hex('new', 2)],
      ['later', hex('later', 2)],
    ]),
    firstYears: new Map([
      ['old', 2001],
      ['new', 2005],
      ['later', 2009],
    ]),
  };

  it('draws the cells first recorded in the year as new and earlier ones as before', async () => {
    const { spreadCollection } = await import('~/lib/analyse/spread');
    const states = spreadCollection(cells, 2005).features.map((feature) => feature.properties);
    expect(states).toEqual([
      { id: 'old', firstYear: 2001, state: 'before' },
      { id: 'new', firstYear: 2005, state: 'new' },
    ]);
  });
});

describe('loading the spread', () => {
  it('asks for a world tile before the range and one per year, and dates the cells', async () => {
    const { loadSpreadCells } = await import('~/lib/analyse/spread');
    const cells = await loadSpreadCells({ taxonKey: 5 }, [2000, 2001], new AbortController().signal);
    expect(gbif.tileYears.sort()).toEqual(['1500,1999', '2000', '2001']);
    expect(Object.fromEntries(cells.firstYears)).toEqual({ b: 1999, a: 2001 });
    expect([...cells.hexes.keys()].sort()).toEqual(['a', 'b', 'c']);
  });

  it('treats a missing tile as no records', async () => {
    gbif.tileStatus = 404;
    const { loadSpreadCells } = await import('~/lib/analyse/spread');
    const cells = await loadSpreadCells({ taxonKey: 5 }, [2000, 2000], new AbortController().signal);
    expect(cells.firstYears.size).toBe(0);
  });

  it('fails on a GBIF error, marking GBIF as struggling when it is overloaded', async () => {
    const { loadSpreadCells } = await import('~/lib/analyse/spread');
    const { $gbifStale } = await import('~/lib/gbif');
    $gbifStale.set(false);
    gbif.tileStatus = 400;
    await expect(loadSpreadCells({}, [2000, 2000], new AbortController().signal)).rejects.toThrow('400');
    expect($gbifStale.get()).toBe(false);
    gbif.tileStatus = 503;
    await expect(loadSpreadCells({}, [2000, 2000], new AbortController().signal)).rejects.toThrow('503');
    expect($gbifStale.get()).toBe(true);
    gbif.tileStatus = 429;
    await expect(loadSpreadCells({}, [2000, 2000], new AbortController().signal)).rejects.toThrow('429');
  });

  it("lists each country's records and first year from one request, over all years", async () => {
    gbif.countryYears = new Map([
      [
        'GB',
        {
          count: 40,
          years: new Map([
            [1995, 2],
            [1990, 1],
          ]),
        },
      ],
      ['FR', { count: 3, years: new Map() }],
    ]);
    const { loadCountryRecords } = await import('~/lib/analyse/spread');
    const found = await loadCountryRecords({ taxonKey: 5, year: [2000, 2002] }, new AbortController().signal);
    expect(found).toEqual([
      { code: 'GB', count: 40, firstYear: 1990 },
      { code: 'FR', count: 3, firstYear: null },
    ]);
    expect(gbif.facetFilters.at(-1)).toEqual({ taxonKey: 5 });
  });

  it('builds the world tile from the filter', async () => {
    const { worldTileUrl } = await import('~/lib/gbif');
    const url = new URL(worldTileUrl({ taxonKey: 5, year: [2004, 2004] }, 200));
    expect(url.pathname).toBe('/v2/map/occurrence/density/0/0/0.mvt');
    expect(url.searchParams.get('hexPerTile')).toBe('200');
    expect(url.searchParams.get('year')).toBe('2004');
  });
});

describe('Spread on the map', () => {
  async function loadSpreadStores(search: string) {
    vi.resetModules();
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia;
    history.replaceState(null, '', `/${search}`);
    return { ...(await import('~/stores/spread')), ...(await import('~/stores/analyse')) };
  }

  const cells = { hexes: new Map([['a', hex('a', 2)]]), firstYears: new Map([['a', 2005]]) };

  it('keeps the year inside the years included, and uses the last when none is picked', async () => {
    expect((await loadSpreadStores('?analyse=1&ayr=2001-2010')).$spreadYear.get()).toBe(2010);
    expect((await loadSpreadStores('?analyse=1&ayr=2001-2010&ay=1990')).$spreadYear.get()).toBe(2001);
    expect((await loadSpreadStores('?analyse=1&ayr=2001-2010&ay=2004')).$spreadYear.get()).toBe(2004);
    expect((await loadSpreadStores('?ay=20x4')).$analyseYear.get()).toBeNull();
  });

  it('draws the cells only in Analyse, in Spread, once loaded', async () => {
    const stores = await loadSpreadStores('?analyse=1&av=spread&ay=2005');
    expect(stores.$spreadMap.get()).toBeNull();
    stores.$spreadCells.set(cells);
    expect(stores.$spreadMap.get()?.features).toHaveLength(1);
    // In a later year the cell is still drawn, as recorded before it.
    stores.$analyseYear.set(2006);
    expect(stores.$spreadMap.get()?.features[0]?.properties).toMatchObject({ state: 'before' });
    stores.$analyseView.set('migration');
    expect(stores.$spreadMap.get()).toBeNull();
  });

  it('starts at the first year a cell appears, leaving off empty years before it', async () => {
    const stores = await loadSpreadStores('?analyse=1&av=spread&ayr=1990-2010&ay=1995');
    expect(stores.$spreadRange.get()).toEqual([1990, 2010]);
    stores.$spreadCells.set(cells);
    expect(stores.$spreadRange.get()).toEqual([2005, 2010]);
    expect(stores.$spreadYear.get()).toBe(2005);
    // A cell recorded before the range means Spread starts with the range.
    stores.$spreadCells.set({ ...cells, firstYears: new Map([['a', 1989]]) });
    expect(stores.$spreadRange.get()).toEqual([1990, 2010]);
    // A cell later than the range still leaves the last year to show.
    stores.$spreadCells.set({ ...cells, firstYears: new Map([['a', 2020]]) });
    expect(stores.$spreadRange.get()).toEqual([2010, 2010]);
  });

  it('forgets the year when Analyse is left', async () => {
    const stores = await loadSpreadStores('?analyse=1&ay=2005');
    stores.resetAnalyse();
    expect(stores.$analyseYear.get()).toBeNull();
  });
});

describe('useSpreadCells', () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve));

  it('loads the cells while Spread shows a species, and clears them otherwise', async () => {
    vi.resetModules();
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia;
    history.replaceState(null, '', '/?analyse=1&ak=5&av=spread&ayr=2000-2001');
    const { effectScope } = await import('vue');
    const { useSpreadCells } = await import('~/composables/useSpreadCells');
    const { $spreadCells } = await import('~/stores/spread');
    const { $analyseView } = await import('~/stores/analyse');

    const scope = effectScope();
    const load = scope.run(() => useSpreadCells())!;
    expect(load.loading.value).toBe(true);
    await flush();
    expect(Object.fromEntries($spreadCells.get()!.firstYears)).toEqual({ b: 1999, a: 2001 });

    $analyseView.set('migration');
    await flush();
    expect($spreadCells.get()).toBeNull();

    $analyseView.set('spread');
    await flush();
    expect($spreadCells.get()).not.toBeNull();
    scope.stop();
    expect($spreadCells.get()).toBeNull();
  });

  it('drops a load that a newer one replaced', async () => {
    vi.resetModules();
    history.replaceState(null, '', '/?analyse=1&ak=5&av=spread&ayr=2000-2001');
    const { effectScope } = await import('vue');
    const { useSpreadCells } = await import('~/composables/useSpreadCells');
    const { $spreadCells } = await import('~/stores/spread');
    const { $analyseTaxon } = await import('~/stores/analyse');
    const scope = effectScope();
    scope.run(() => useSpreadCells());
    $analyseTaxon.set(6);
    await flush();
    await flush();
    expect($spreadCells.get()).not.toBeNull();
    scope.stop();
  });
});

describe('allRecordsByYear', () => {
  it("counts every species' records each year, keeping the filter's other conditions", async () => {
    const { allRecordsByYear } = await import('~/lib/analyse/years');
    gbif.yearFacets = [
      { name: '2004', count: 90 },
      { name: '2005', count: 12 },
    ];
    const found = await allRecordsByYear(
      { taxonKey: 5, taxonKeys: [6], year: [1990, 2000], maxUncertaintyM: 100 },
      [2004, 2005],
      new AbortController().signal,
    );
    expect(Object.fromEntries(found)).toEqual({ 2004: 90, 2005: 12 });
    expect(gbif.facetFilters.at(-1)).toEqual({ maxUncertaintyM: 100, year: [2004, 2005] });
    gbif.yearFacets = null;
    expect((await allRecordsByYear({}, [2004, 2005], new AbortController().signal)).size).toBe(0);
  });
});

describe('earliestRecordYear', () => {
  it('finds the year mapped records first add up to two, whatever years the filter holds', async () => {
    const { earliestRecordYear } = await import('~/lib/analyse/years');
    gbif.yearFacets = [
      { name: '2004', count: 90 },
      { name: '1871', count: 1 },
      { name: '1990', count: 12 },
    ];
    expect(await earliestRecordYear({ taxonKey: 5, year: [2010, 2020] }, new AbortController().signal)).toBe(1990);
    expect(gbif.facetFilters.at(-1)).toEqual({ taxonKey: 5, georeferenced: true });
    gbif.yearFacets = [{ name: '1871', count: 1 }];
    expect(await earliestRecordYear({ taxonKey: 5 }, new AbortController().signal)).toBeNull();
    gbif.yearFacets = null;
    expect(await earliestRecordYear({ taxonKey: 5 }, new AbortController().signal)).toBeNull();
  });
});
