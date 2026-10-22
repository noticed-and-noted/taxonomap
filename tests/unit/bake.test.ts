/**
 * Build-time baking. The Node transport (disk cache, User-Agent) is swapped
 * for the plain client so these tests never touch .cache/.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { facets, json, stubNetwork } from './helpers/network';

vi.mock('~/lib/gbif/server', () => import('~/lib/gbif'));

const usage = (key: number, rank: string, name: string, extra: object = {}) => ({
  key,
  rank,
  scientificName: name,
  canonicalName: name,
  ...extra,
});

/** A tiny GBIF: two kingdoms' worth of taxa and a few species. */
function gbif(override: (url: URL) => unknown = () => undefined) {
  return stubNetwork((url) => {
    const early = override(url);
    if (early !== undefined) return early;
    const path = url.pathname;
    const params = url.searchParams;
    if (path === '/v1/species/search' && params.get('facet') === 'higherTaxonKey')
      return facets(0, 'HIGHER_TAXON_KEY', [
        [44, 50],
        [212, 40],
      ]);
    if (path === '/v1/species/search') {
      const byRank: Record<string, object[]> = {
        KINGDOM: [
          usage(1, 'KINGDOM', 'Animalia', { vernacularNames: [{ vernacularName: 'Animals', language: 'eng' }] }),
        ],
        PHYLUM: [usage(44, 'PHYLUM', 'Chordata', { kingdomKey: 1 })],
        CLASS: [
          usage(212, 'CLASS', 'Aves', { phylumKey: 44, vernacularName: 'birds' }),
          usage(5, 'CLASS', 'Lost', { phylumKey: 404 }),
        ],
        ORDER: [],
      };
      return { endOfRecords: true, results: byRank[params.get('rank') ?? ''] ?? [] };
    }
    if (path === '/v1/occurrence/search') {
      const facetFields = params.getAll('facet');
      if (facetFields.includes('year'))
        return facets(30, 'YEAR', [
          [2001, 20],
          [2000, 10],
        ]);
      if (facetFields.includes('speciesKey')) {
        const taxon = params.get('taxonKey');
        return taxon === '212'
          ? facets(0, 'SPECIES_KEY', [
              [10, 9000],
              [11, 8000],
            ])
          : facets(0, 'SPECIES_KEY', [
              [12, 7000],
              [10, 9000],
            ]);
      }
      return {
        count: 0,
        results: [],
        facets: [
          { field: 'KINGDOM_KEY', counts: [{ name: '1', count: 100_000 }] },
          { field: 'PHYLUM_KEY', counts: [{ name: '44', count: 90_000 }] },
          {
            field: 'CLASS_KEY',
            counts: [
              { name: '212', count: 80_000 },
              { name: '5', count: 10 },
            ],
          },
        ],
      };
    }
    const species = /^\/v1\/species\/(\d+)$/.exec(path);
    if (species) {
      const key = Number(species[1]);
      if (key === 12) return usage(12, 'GENUS', 'Genusonly');
      return usage(key, 'SPECIES', `Species number${key}`);
    }
    if (/^\/v1\/species\/\d+\/vernacularNames$/.test(path))
      return { results: [{ vernacularName: 'Some bird', language: 'eng' }] };
    return undefined;
  });
}

async function bake(env: Record<string, string> = {}) {
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  return import('~/lib/bake');
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('bake', () => {
  it('bakes records per year, ascending, once per build', async () => {
    const calls = gbif();
    const baked = await bake();
    const [first, again] = [await baked.bakeYears(), await baked.bakeYears()];
    expect(first).toMatchObject({
      v: 1,
      total: 30,
      years: [
        [2000, 10],
        [2001, 20],
      ],
    });
    expect(again).toBe(first);
    expect(calls).toHaveLength(1);
  });

  it('bakes the tree with counts, names and parents, dropping orphans', async () => {
    gbif();
    const { nodes } = await (await bake()).bakeTree();
    expect(nodes).toEqual([
      { k: 1, n: 'Animalia', r: 'K', o: 100_000, s: 1, c: 'Animals' },
      { k: 44, n: 'Chordata', r: 'P', o: 90_000, s: 50, p: 1 },
      { k: 212, n: 'Aves', r: 'C', o: 80_000, s: 40, p: 44 },
    ]);
  });

  it('picks species to pre-render by class share, skipping non-species', async () => {
    gbif();
    const baked = await bake({ SPECIES_PRERENDER_COUNT: '3' });
    expect(baked.prerenderCount()).toBe(3);
    // Birds get ceil(3 × 0.3) = 1 slot (key 10); the next class adds 12, a genus, which is dropped.
    expect(await baked.bakeSpeciesList()).toEqual([{ key: 10, slug: 'species-number10', count: 9000 }]);
    expect(await baked.bakeSpeciesManifest()).toEqual({ 10: 'species-number10' });
  });

  it('fails the build when GBIF errors, rather than dropping the species', async () => {
    gbif((url) => (url.pathname === '/v1/species/10' ? json({}, 400) : undefined));
    const baked = await bake({ SPECIES_PRERENDER_COUNT: '3' });
    // The mocked server module keeps its client (and its cache) across tests.
    (await import('~/lib/gbif/server')).http().clear();
    await expect(baked.bakeSpeciesList()).rejects.toThrow();
  });

  it('pre-renders nothing when the count is 0', async () => {
    const calls = gbif();
    expect(await (await bake({ SPECIES_PRERENDER_COUNT: '0' })).bakeSpeciesList()).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('bakes the name index from higher ranks and top species, most-recorded first', async () => {
    gbif();
    const baked = await bake({ NAME_INDEX_SIZE: '3' });
    const { names } = await baked.bakeNames();
    expect(names).toEqual([
      [1, 'K', 'Animalia', 'Animals', 100_000],
      [44, 'P', 'Chordata', null, 90_000],
      // GBIF's vernacularName alone doesn't name it: names come from englishName() of the full list.
      [212, 'C', 'Aves', null, 80_000],
      [10, 'S', 'Species number10', 'Some bird', 9000],
      [11, 'S', 'Species number11', 'Some bird', 8000],
      [12, 'S', 'Genusonly', 'Some bird', 7000],
    ]);
    const common = await baked.bakedCommonNames();
    expect([common(1), common(212)]).toEqual(['Animals', null]);
  });

  it('indexes the busiest genera, and the other English names of each taxon', async () => {
    (await import('~/lib/gbif/server')).http().clear();
    gbif((url) => {
      const facetFields = url.searchParams.getAll('facet');
      if (url.pathname === '/v1/occurrence/search' && facetFields.includes('genusKey'))
        return { count: 0, results: [], facets: [{ field: 'GENUS_KEY', counts: [{ name: '50', count: 60_000 }] }] };
      if (url.pathname === '/v1/species/50') return usage(50, 'GENUS', 'Larus');
      if (url.pathname === '/v1/species/50/vernacularNames')
        return {
          results: ['Gull', 'Gull', 'Gulls', 'Seagull'].map((vernacularName) => ({ vernacularName, language: 'eng' })),
        };
      return undefined;
    });
    const { names } = await (await bake({ NAME_INDEX_SIZE: '3' })).bakeNames();
    expect(names).toContainEqual([50, 'G', 'Larus', 'Gull', 60_000, null, ['Seagull']]);
  });
});

/**
 * A messier GBIF: facets left out, listings that page and then come back
 * empty, taxa it no longer knows, names without a canonical form.
 */
function messyGbif() {
  return stubNetwork((url) => {
    const path = url.pathname;
    const params = url.searchParams;
    if (path === '/v1/species/search' && params.get('facet') === 'higherTaxonKey')
      return facets(0, 'HIGHER_TAXON_KEY', [[30, 7]]);
    if (path === '/v1/species/search') {
      const rank = params.get('rank');
      // Every listing pages once, then answers an empty page without saying it is the end.
      if (params.get('offset') !== '0') return { endOfRecords: false, results: [] };
      const byRank: Record<string, object[]> = {
        KINGDOM: [{ key: 1, rank: 'KINGDOM', scientificName: 'Animalia Linnaeus' }],
        PHYLUM: [
          usage(2, 'PHYLUM', 'Chordata', { kingdomKey: 1 }),
          usage(3, 'PHYLUM', 'Unrecorded', { kingdomKey: 1 }),
        ],
        CLASS: [usage(20, 'CLASS', 'Odd rank', { rank: 'SUBCLASS' })],
        ORDER: [
          usage(30, 'ORDER', 'Unplaced order', { phylumKey: 2 }),
          usage(31, 'ORDER', 'Recorded, no species count', { classKey: 99, phylumKey: 2 }),
        ],
      };
      return { endOfRecords: false, results: byRank[rank ?? ''] ?? [] };
    }
    if (path === '/v1/occurrence/search') {
      const facetFields = params.getAll('facet');
      if (facetFields.includes('year')) return { count: 0, results: [] };
      if (facetFields.includes('speciesKey')) {
        if (params.get('taxonKey') === '212')
          return facets(0, 'SPECIES_KEY', [
            [10, 9000],
            [11, 8000],
            [13, 5000],
          ]);
        if (params.get('taxonKey') === '216') return facets(0, 'SPECIES_KEY', [[15, 3000]]);
        if (params.get('taxonKey')) return { count: 0, results: [] };
        return facets(0, 'SPECIES_KEY', [
          [10, 9000],
          [14, 4000],
        ]);
      }
      return {
        count: 0,
        results: [],
        facets: [
          { field: 'KINGDOM_KEY', counts: [{ name: '1', count: 5000 }] },
          { field: 'PHYLUM_KEY', counts: [{ name: '2', count: 4000 }] },
          { field: 'ORDER_KEY', counts: [{ name: '31', count: 300 }] },
          {
            field: 'FAMILY_KEY',
            counts: [
              { name: '40', count: 2000 },
              { name: '41', count: 1500 },
            ],
          },
        ],
      };
    }
    if (path === '/v1/species/40') return { key: 40, rank: 'FAMILY', scientificName: 'Turdidae Rafinesque' };
    if (path === '/v1/species/14') return { key: 14, rank: 'SPECIES', scientificName: 'Species 14' };
    if (path === '/v1/species/41' || path === '/v1/species/11' || path === '/v1/species/41/vernacularNames')
      return json({}, 404);
    const species = /^\/v1\/species\/(\d+)$/.exec(path);
    if (species) return usage(Number(species[1]), 'SPECIES', `Species ${species[1]}`);
    if (/^\/v1\/species\/\d+\/vernacularNames$/.test(path)) return { results: [] };
    return undefined;
  });
}

describe('bake with iNaturalist IDs', () => {
  beforeEach(async () => (await import('~/lib/gbif/server')).http().clear());

  /** GBIF holds an iNaturalist record of species 10 only; iNaturalist knows its taxon. */
  const inat = (url: URL) => {
    if (url.host === 'api.inaturalist.org' && url.pathname === '/v2/taxa') return { results: [] };
    if (url.host === 'api.inaturalist.org') return { results: [{ id: 777, name: 'Species number10', rank_level: 10 }] };
    const keys = [...url.searchParams.getAll('speciesKey'), ...url.searchParams.getAll('taxonKey')];
    if (url.searchParams.has('datasetKey'))
      return {
        count: 1,
        endOfRecords: true,
        results: keys.includes('10') ? [{ key: 1, speciesKey: 10, taxonID: '777', species: 'Species number10' }] : [],
      };
    return undefined;
  };

  it('adds the iNaturalist taxon to each species it can match', async () => {
    gbif(inat);
    const { names } = await (await bake({ NAME_INDEX_SIZE: '3' })).bakeNames();
    expect(names.filter((row) => row.length === 6).map((row) => [row[0], row[5]])).toEqual([[10, 777]]);
  });

  it('leaves a chunk without IDs when iNaturalist fails, rather than failing the build', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    gbif((url) => (url.host === 'api.inaturalist.org' ? json({}, 400) : inat(url)));
    const { names } = await (await bake({ NAME_INDEX_SIZE: '3' })).bakeNames();
    expect(names.some((row) => row.length === 6)).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});

describe('bake against a messier GBIF', () => {
  beforeEach(async () => (await import('~/lib/gbif/server')).http().clear());

  it('bakes no years when the facet is missing', async () => {
    messyGbif();
    await expect((await bake()).bakeYears()).resolves.toMatchObject({ total: 0, years: [] });
  });

  it('builds the tree from what it can place', async () => {
    messyGbif();
    const { nodes } = await (await bake()).bakeTree();
    expect(nodes).toEqual([
      { k: 1, n: 'Animalia Linnaeus', r: 'K', o: 5000, s: 1 },
      { k: 2, n: 'Chordata', r: 'P', o: 4000, s: 1, p: 1 },
      // No records, but species: kept, under its phylum when it has no class.
      { k: 30, n: 'Unplaced order', r: 'O', o: 0, s: 7, p: 2 },
    ]);
  });

  it('indexes names with families, skipping taxa GBIF no longer knows', async () => {
    // Birds get one new key (11, gone from GBIF); 13 is past their share.
    messyGbif();
    const baked = await bake({ NAME_INDEX_SIZE: '2' });
    const { names } = await baked.bakeNames();
    expect(names).toEqual([
      [10, 'S', 'Species 10', null, 9000],
      [1, 'K', 'Animalia Linnaeus', null, 5000],
      [2, 'P', 'Chordata', null, 4000],
      [14, 'S', 'Species 14', null, 4000],
      [40, 'F', 'Turdidae Rafinesque', null, 2000],
    ]);
    expect((await baked.bakedCommonNames())(10)).toBeNull();
  });

  it('pre-renders by class, then the global ranking, most-recorded first', async () => {
    messyGbif();
    const baked = await bake({ SPECIES_PRERENDER_COUNT: '4' });
    // Birds take two (11 is gone from GBIF), insects one, the global ranking fills in 14.
    expect(await baked.bakeSpeciesList()).toEqual([
      { key: 10, slug: 'species-10', count: 9000 },
      { key: 14, slug: 'species-14', count: 4000 },
      { key: 15, slug: 'species-15', count: 3000 },
    ]);
  });

  it('skips the global ranking when the classes fill the list', async () => {
    const calls = messyGbif();
    const baked = await bake({ SPECIES_PRERENDER_COUNT: '2' });
    expect((await baked.bakeSpeciesList()).map((species) => species.key)).toEqual([10, 15]);
    expect(
      calls.some((url) => url.searchParams.get('facet') === 'speciesKey' && !url.searchParams.has('taxonKey')),
    ).toBe(false);
  });
});

const globalFacetLimit = (calls: URL[]) =>
  calls
    .find((url) => url.searchParams.get('facet') === 'speciesKey' && !url.searchParams.has('taxonKey'))
    ?.searchParams.get('facetLimit');

describe('build sizes', () => {
  it('are smaller under astro dev, and the env overrides them', async () => {
    gbif();
    const dev = await bake({ SPECIES_PRERENDER_COUNT: 'many' });
    expect(dev.prerenderCount()).toBe(12);
    const devCalls = gbif();
    await dev.bakeNames();
    // 42% of the 300-name dev index comes from the global ranking.
    expect(globalFacetLimit(devCalls)).toBe('126');
    vi.resetModules();
    vi.doMock('~/lib/env', async (original) => ({
      ...(await original<typeof import('~/lib/env')>()),
      isDev: () => false,
    }));
    const prod = await import('~/lib/bake');
    vi.doUnmock('~/lib/env');
    expect(prod.prerenderCount()).toBe(2000);
    const calls = gbif();
    await prod.bakeNames();
    expect(globalFacetLimit(calls)).toBe('2520');
  });
});

describe('bake to disk', () => {
  it('saves every snapshot, and later builds read them without asking GBIF', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'baked-'));
    try {
      gbif();
      const first = await bake({ BAKE_DIR: dir, SPECIES_PRERENDER_COUNT: '3' });
      const steps: string[] = [];
      const saved = await first.bakeToDisk((key) => steps.push(key));
      const list = await first.bakeSpeciesList();
      expect(saved).toEqual(['years', 'names', 'tree', 'species-list']);
      expect(steps).toEqual(saved);
      expect(first.lookupProgress.queued).toBeGreaterThan(0);
      expect(first.lookupProgress.done).toBe(first.lookupProgress.queued);
      const calls = gbif();
      const baked = await bake({ BAKE_DIR: dir });
      expect((await baked.bakeYears()).total).toBe(30);
      expect(await baked.bakeSpeciesList()).toEqual(list);
      expect(calls).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});

describe('bake directory', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('defaults to .cache/baked when BAKE_DIR is unset', async () => {
    vi.stubEnv('BAKE_DIR', undefined);
    const { bakeDir } = await import('~/lib/bake/cache');
    expect(bakeDir()).toBe('.cache/baked');
  });
});
