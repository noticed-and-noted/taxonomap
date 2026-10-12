/**
 * Live contract tests: one request per endpoint we depend on, asserting the
 * response fields the app reads. Run with `npm run test:contract`.
 * Not part of default CI (network-dependent); a scheduled job runs them weekly.
 */
import {
  BACKBONE_DATASET_KEY,
  configureHttp,
  findImages,
  getChildren,
  getDataset,
  getOccurrence,
  getOrganization,
  getParents,
  getSpecies,
  getSynonyms,
  getVernacularNames,
  listByRank,
  mapCapabilities,
  matchName,
  matchNameV2,
  occurrenceFacets,
  occurrenceTileTemplate,
  searchOccurrences,
  searchVernacular,
  speciesInRadius,
  suggestSpecies,
  thumbnailUrl,
} from '~/lib/gbif';
import { userAgent } from '~/lib/gbif/node-transport';

const ROBIN = 2492462; // Erithacus rubecula
const SPARROW = 5231190; // Passer domesticus
const AVES = 212;

beforeAll(() => {
  configureHttp({
    transport: (url, init) => fetch(url, { ...init, headers: { 'User-Agent': userAgent() } }),
    maxRetries: 2,
  });
});

const tile = (template: string) => template.replace('{z}', '0').replace('{x}', '0').replace('{y}', '0');

const thumb = (u: string) => fetch(u).then((r) => [r.status, r.headers.get('content-type')]);

describe('maps', () => {
  it('density PNG tile', async () => {
    const res = await fetch(tile(occurrenceTileTemplate({ taxonKey: AVES, year: [2000, 2010] })));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('density MVT tile', async () => {
    const res = await fetch(tile(occurrenceTileTemplate({ taxonKey: AVES }, {}, 'mvt')));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('protobuf');
  });

  it('adhoc tile is used for the photo filter', async () => {
    const url = tile(occurrenceTileTemplate({ taxonKey: AVES, hasImage: true }));
    expect(url).toContain('/adhoc/');
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
  });

  it('capabilities', async () => {
    const c = await mapCapabilities({ taxonKey: AVES });
    expect(c.total).toBeGreaterThan(0);
    expect(typeof c.minLat).toBe('number');
  });
});

describe('species', () => {
  it('suggest (scientific names)', async () => {
    const r = await suggestSpecies('Erithacus rub');
    expect(r[0]).toMatchObject({ key: expect.any(Number), rank: expect.any(String) });
    expect(r.some((s) => s.key === ROBIN)).toBe(true);
    expect(r[0]?.canonicalName ?? r[0]?.scientificName).toEqual(expect.any(String));
  });

  it('vernacular search returns vernacularNames[]', async () => {
    const r = await searchVernacular('house sparrow');
    expect(r.results.length).toBeGreaterThan(0);
    expect(r.results[0]?.vernacularNames?.[0]).toMatchObject({ vernacularName: expect.any(String) });
  });

  it('listByRank bulk names', async () => {
    const r = await listByRank('PHYLUM', 0, 20);
    expect(r.results[0]).toMatchObject({ key: expect.any(Number), rank: 'PHYLUM', scientificName: expect.any(String) });
    expect(r.results.every((x) => x.datasetKey === BACKBONE_DATASET_KEY)).toBe(true);
  });

  it('match v1', async () => {
    const m = await matchName('Erithacus rubecula');
    expect(m).toMatchObject({ usageKey: ROBIN, matchType: 'EXACT', classKey: AVES });
  });

  it('match v2', async () => {
    const m = await matchNameV2('Erithacus rubecula');
    expect(m.usage).toMatchObject({ key: String(ROBIN), rank: 'SPECIES' });
    expect(m.classification?.find((c) => c.rank === 'CLASS')?.key).toBe(String(AVES));
  });

  it('detail', async () => {
    const s = await getSpecies(SPARROW);
    expect(s).toMatchObject({ key: SPARROW, rank: 'SPECIES', canonicalName: 'Passer domesticus', classKey: AVES });
    expect(typeof s.numDescendants).toBe('number');
  });

  it('vernacularNames', async () => {
    const r = await getVernacularNames(SPARROW, 50);
    expect(r.results[0]).toMatchObject({ vernacularName: expect.any(String), language: expect.any(String) });
  });

  it('synonyms', async () => {
    const r = await getSynonyms(SPARROW, 5);
    expect(Array.isArray(r.results)).toBe(true);
    expect(r.results[0]).toMatchObject({ key: expect.any(Number), scientificName: expect.any(String) });
  });

  it('children', async () => {
    const r = await getChildren(AVES, { limit: 5 });
    expect(r.results[0]).toMatchObject({ key: expect.any(Number), rank: 'ORDER', parentKey: AVES });
  });

  it('parents', async () => {
    const r = await getParents(SPARROW);
    expect(r.map((p) => p.rank)).toEqual(expect.arrayContaining(['KINGDOM', 'CLASS', 'GENUS']));
  });
});

describe('occurrences', () => {
  it('facets with limit=0', async () => {
    const r = await occurrenceFacets({ taxonKey: ROBIN }, ['year', 'month', 'country', 'datasetKey'], {
      facetLimit: 5,
    });
    expect(r.count).toBeGreaterThan(1_000_000);
    for (const f of ['year', 'month', 'country', 'datasetKey']) {
      expect(r.facets[f]?.[0]).toMatchObject({ name: expect.any(String), count: expect.any(Number) });
    }
  });

  it('species in an area (WKT polygon + speciesKey facet)', async () => {
    const r = await speciesInRadius(51.507, -0.128, 2, {}, 10);
    expect(r.facets['speciesKey']?.length).toBeGreaterThan(0);
  });

  it('images with media[] and licences', async () => {
    const r = await findImages({ taxonKey: ROBIN }, { limit: 10 });
    expect(r.count).toBeGreaterThan(0);
    expect(r.images.length).toBeGreaterThan(0);
    expect(r.images[0]).toMatchObject({ url: expect.stringMatching(/^https?:/), licence: expect.any(String) });
    // GBIF image cache thumbnail (occurrence key + md5 of identifier).
    expect(await thumb(thumbnailUrl(r.images[0]!, '200x'))).toEqual([200, 'image/jpeg']);
  });

  it('records search + single record', async () => {
    const r = await searchOccurrences({ taxonKey: ROBIN, georeferenced: true }, { limit: 2 });
    const first = r.results[0];
    expect(first).toMatchObject({ key: expect.any(Number), datasetKey: expect.any(String) });
    expect(typeof first?.decimalLatitude).toBe('number');
    const one = await getOccurrence(first!.key);
    expect(one.key).toBe(first!.key);
  });

  it('respects the 100,000 offset cap without calling GBIF', async () => {
    const r = await searchOccurrences({ taxonKey: ROBIN }, { offset: 100_000, limit: 300 });
    expect(r.results).toEqual([]);
  });
});

describe('datasets', () => {
  it('detail', async () => {
    const d = await getDataset(BACKBONE_DATASET_KEY);
    expect(d).toMatchObject({ key: BACKBONE_DATASET_KEY, title: expect.any(String) });
  });

  it('organization', async () => {
    const d = await getDataset(BACKBONE_DATASET_KEY);
    const o = await getOrganization(d.publishingOrganizationKey as string);
    expect(o).toMatchObject({ key: d.publishingOrganizationKey, title: expect.any(String) });
  });
});
