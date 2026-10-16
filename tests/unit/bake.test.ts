/**
 * Build-time baking. The Node transport (disk cache, User-Agent) is swapped
 * for the plain client so these tests never touch .cache/.
 */
import { facets, stubNetwork } from './helpers/network';

vi.mock('~/lib/gbif/server', () => import('~/lib/gbif'));

const usage = (key: number, rank: string, name: string, extra: object = {}) => ({
  key,
  rank,
  scientificName: name,
  canonicalName: name,
  ...extra,
});

/** A tiny GBIF: two kingdoms' worth of taxa and a few species. */
function gbif() {
  return stubNetwork((url) => {
    const p = url.pathname;
    const q = url.searchParams;
    if (p === '/v1/species/search' && q.get('facet') === 'higherTaxonKey')
      return facets(0, 'HIGHER_TAXON_KEY', [
        [44, 50],
        [212, 40],
      ]);
    if (p === '/v1/species/search') {
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
      return { endOfRecords: true, results: byRank[q.get('rank') ?? ''] ?? [] };
    }
    if (p === '/v1/occurrence/search') {
      const f = q.getAll('facet');
      if (f.includes('year'))
        return facets(30, 'YEAR', [
          [2001, 20],
          [2000, 10],
        ]);
      if (f.includes('speciesKey')) {
        const taxon = q.get('taxonKey');
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
          { field: 'FAMILY_KEY', counts: [] },
        ],
      };
    }
    const species = /^\/v1\/species\/(\d+)$/.exec(p);
    if (species) {
      const k = Number(species[1]);
      if (k === 12) return usage(12, 'GENUS', 'Genusonly');
      return usage(k, 'SPECIES', `Species number${k}`);
    }
    if (/^\/v1\/species\/\d+\/vernacularNames$/.test(p))
      return { results: [{ vernacularName: 'Some bird', language: 'eng' }] };
    return undefined;
  });
}

async function bake(env: Record<string, string> = {}) {
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  return import('~/lib/bake');
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('bake', () => {
  it('bakes records per year, ascending, once per build', async () => {
    const calls = gbif();
    const b = await bake();
    const [a, again] = [await b.bakeYears(), await b.bakeYears()];
    expect(a).toMatchObject({
      v: 1,
      total: 30,
      years: [
        [2000, 10],
        [2001, 20],
      ],
    });
    expect(again).toBe(a);
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
    const b = await bake({ SPECIES_PRERENDER_COUNT: '3' });
    expect(b.prerenderCount()).toBe(3);
    // Birds get ceil(3 × 0.3) = 1 slot (key 10); the next class adds 12, a genus, which is dropped.
    expect(await b.bakeSpeciesList()).toEqual([{ key: 10, slug: 'species-number10', count: 9000 }]);
    expect(await b.bakeSpeciesManifest()).toEqual({ 10: 'species-number10' });
  });

  it('pre-renders nothing when the count is 0', async () => {
    const calls = gbif();
    expect(await (await bake({ SPECIES_PRERENDER_COUNT: '0' })).bakeSpeciesList()).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('bakes the name index from higher ranks and top species, most-recorded first', async () => {
    gbif();
    const b = await bake({ NAME_INDEX_SIZE: '3' });
    const { names } = await b.bakeNames();
    expect(names).toEqual([
      [1, 'K', 'Animalia', 'Animals', 100_000],
      [44, 'P', 'Chordata', null, 90_000],
      [212, 'C', 'Aves', 'Birds', 80_000],
      [10, 'S', 'Species number10', 'Some bird', 9000],
      [11, 'S', 'Species number11', 'Some bird', 8000],
      [12, 'S', 'Genusonly', 'Some bird', 7000],
    ]);
    const common = await b.bakedCommonNames();
    expect([common(212), common(44)]).toEqual(['Birds', null]);
  });
});
