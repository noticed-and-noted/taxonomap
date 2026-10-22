/**
 * Live contract tests: one request per endpoint we depend on, asserting the
 * response fields the app reads. Run with `pnpm test:contract`.
 * Not part of default CI (network-dependent); a scheduled job runs them weekly.
 */
import {
  BACKBONE_DATASET_KEY,
  circleToWkt,
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
  occurrenceFacets,
  occurrenceTileTemplate,
  searchOccurrences,
  searchVernacular,
  suggestSpecies,
  thumbnailUrl,
} from '~/lib/gbif';
import { userAgent } from '~/lib/gbif/node-transport';
import { decodeHexes, HEX_PER_TILE, mergeHexes, type Hex } from '~/lib/map/occGrid';
import { geometryOf } from '~/lib/map/style';

const ROBIN = 2492462; // Erithacus rubecula
const SPARROW = 5231190; // Passer domesticus
const AVES = 212;

beforeAll(() => {
  configureHttp({
    transport: (url, requestInit) => fetch(url, { ...requestInit, headers: { 'User-Agent': userAgent() } }),
    maxRetries: 2,
  });
});

const tile = (template: string) => template.replace('{z}', '0').replace('{x}', '0').replace('{y}', '0');

const thumb = (url: string) => fetch(url).then((response) => [response.status, response.headers.get('content-type')]);

describe('maps', () => {
  it('density PNG tile', async () => {
    const response = await fetch(tile(occurrenceTileTemplate({ taxonKey: AVES, year: [2000, 2010] })));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('density MVT tile', async () => {
    const response = await fetch(tile(occurrenceTileTemplate({ taxonKey: AVES }, {}, 'mvt')));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('protobuf');
  });

  it('adhoc tile is used for the photo filter', async () => {
    const url = tile(occurrenceTileTemplate({ taxonKey: AVES, hasImage: true }));
    expect(url).toContain('/adhoc/');
    const response = await fetch(url);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
  });

  describe('hex counts agree with an occurrence search over the same cell', () => {
    // England at z7: dense, and tile 63/41 shares edges with the other two.
    const ZOOM = 7;
    const TILES = [
      { x: 63, y: 41 },
      { x: 64, y: 41 },
      { x: 63, y: 42 },
    ];
    const mvt = (zoom: number, tileX: number, tileY: number, style: Parameters<typeof occurrenceTileTemplate>[1]) =>
      fetch(
        occurrenceTileTemplate({}, style, 'mvt')
          .replace('{z}', String(zoom))
          .replace('{x}', String(tileX))
          .replace('{y}', String(tileY)),
      ).then((response) => response.arrayBuffer());
    const sumTotals = async (data: ArrayBuffer) => {
      const [{ VectorTile }, { PbfReader }] = await Promise.all([import('@mapbox/vector-tile'), import('pbf')]);
      let sum = 0;
      for (const layer of Object.values(new VectorTile(new PbfReader(data)).layers))
        for (let index = 0; index < layer.length; index++) sum += Number(layer.feature(index).properties['total']);
      return sum;
    };

    it('GBIF hex bins count each record twice (hexRecords halves them)', async () => {
      const hexUrl = tile(occurrenceTileTemplate({}, { hexPerTile: HEX_PER_TILE }, 'mvt'));
      const pointUrl = hexUrl.replace(/&?bin=hex&hexPerTile=\d+/, '');
      expect(pointUrl).not.toBe(hexUrl);
      const [hex, points] = await Promise.all(
        [hexUrl, pointUrl].map((url) =>
          fetch(url)
            .then((response) => response.arrayBuffer())
            .then(sumTotals),
        ),
      );
      expect(hex).toBe(2 * points!);
    });

    it('merged cells, edge cells included, match the search', async () => {
      const decoded = await Promise.all(
        TILES.map(async (hexTile) =>
          decodeHexes(await mvt(ZOOM, hexTile.x, hexTile.y, { hexPerTile: HEX_PER_TILE }), hexTile, ZOOM),
        ),
      );
      const homeIds = new Set(decoded[0]!.filter((hex) => hex.properties.home).map((hex) => hex.properties.id));
      const cells = [...mergeHexes(decoded).values()];
      // The busiest cells of the middle tile that also come in a neighbour's padding, and the busiest inside it.
      const shared = cells.filter((cell) =>
        decoded.slice(1).some((otherTile) => otherTile.some((hex) => hex.properties.id === cell.properties.id)),
      );
      const byTotal = (left: Hex, right: Hex) => right.properties.total - left.properties.total;
      const picks = [
        ...shared.sort(byTotal).slice(0, 4),
        ...cells
          .filter((cell) => homeIds.has(cell.properties.id))
          .sort(byTotal)
          .slice(0, 2),
      ];
      const errors = await Promise.all(
        picks.map(async (pick) => {
          const geometry = geometryOf(pick)!;
          const result = await occurrenceFacets({ geometry: geometry.wkt }, [], {});
          return Math.abs(pick.properties.total / result.count - 1);
        }),
      );
      // GBIF snaps records to tile pixels, so a cell can be a few percent off; padded copies were off several-fold.
      errors.sort((left, right) => left - right);
      expect(errors[Math.floor(errors.length / 2)]).toBeLessThan(0.02);
      expect(Math.max(...errors)).toBeLessThan(0.25);
    });
  });

  it('capabilities', async () => {
    const capabilities = await mapCapabilities({ taxonKey: AVES });
    expect(capabilities.total).toBeGreaterThan(0);
    expect(typeof capabilities.minLat).toBe('number');
  });
});

describe('species', () => {
  it('suggest (scientific names)', async () => {
    const result = await suggestSpecies('Erithacus rub');
    expect(result[0]).toMatchObject({ key: expect.any(Number), rank: expect.any(String) });
    expect(result.some((species) => species.key === ROBIN)).toBe(true);
    expect(result[0]?.canonicalName ?? result[0]?.scientificName).toEqual(expect.any(String));
  });

  it('vernacular search returns vernacularNames[]', async () => {
    const result = await searchVernacular('house sparrow');
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0]?.vernacularNames?.[0]).toMatchObject({ vernacularName: expect.any(String) });
  });

  it('listByRank bulk names', async () => {
    const result = await listByRank('PHYLUM', 0, 20);
    expect(result.results[0]).toMatchObject({
      key: expect.any(Number),
      rank: 'PHYLUM',
      scientificName: expect.any(String),
    });
    expect(result.results.every((taxon) => taxon.datasetKey === BACKBONE_DATASET_KEY)).toBe(true);
  });

  it('detail', async () => {
    const usage = await getSpecies(SPARROW);
    expect(usage).toMatchObject({ key: SPARROW, rank: 'SPECIES', canonicalName: 'Passer domesticus', classKey: AVES });
    expect(typeof usage.numDescendants).toBe('number');
  });

  it('vernacularNames', async () => {
    const result = await getVernacularNames(SPARROW);
    expect(result.results[0]).toMatchObject({ vernacularName: expect.any(String), language: expect.any(String) });
  });

  it('synonyms', async () => {
    const result = await getSynonyms(SPARROW, 5);
    expect(Array.isArray(result.results)).toBe(true);
    expect(result.results[0]).toMatchObject({ key: expect.any(Number), scientificName: expect.any(String) });
  });

  it('children', async () => {
    const result = await getChildren(AVES, { limit: 5 });
    expect(result.results[0]).toMatchObject({ key: expect.any(Number), rank: 'ORDER', parentKey: AVES });
  });

  it('parents', async () => {
    const result = await getParents(SPARROW);
    expect(result.map((parent) => parent.rank)).toEqual(expect.arrayContaining(['KINGDOM', 'CLASS', 'GENUS']));
  });
});

describe('occurrences', () => {
  it('facets with limit=0', async () => {
    const result = await occurrenceFacets({ taxonKey: ROBIN }, ['year', 'month', 'country', 'datasetKey'], {
      facetLimit: 5,
    });
    expect(result.count).toBeGreaterThan(1_000_000);
    for (const field of ['year', 'month', 'country', 'datasetKey']) {
      expect(result.facets[field]?.[0]).toMatchObject({ name: expect.any(String), count: expect.any(Number) });
    }
  });

  it('species in an area (WKT polygon + speciesKey facet)', async () => {
    const result = await occurrenceFacets({ geometry: circleToWkt(51.507, -0.128, 2) }, ['speciesKey'], {
      facetLimit: 10,
    });
    expect(result.facets['speciesKey']?.length).toBeGreaterThan(0);
  });

  it('images with media[] and licences', async () => {
    const result = await findImages({ taxonKey: ROBIN }, { limit: 10 });
    expect(result.count).toBeGreaterThan(0);
    expect(result.images.length).toBeGreaterThan(0);
    expect(result.images[0]).toMatchObject({ url: expect.stringMatching(/^https?:/), licence: expect.any(String) });
    // GBIF image cache thumbnail (occurrence key + md5 of identifier).
    expect(await thumb(thumbnailUrl(result.images[0]!, '200x'))).toEqual([200, 'image/jpeg']);
  });

  it('records search + single record', async () => {
    const result = await searchOccurrences({ taxonKey: ROBIN, georeferenced: true }, { limit: 2 });
    const first = result.results[0];
    expect(first).toMatchObject({ key: expect.any(Number), datasetKey: expect.any(String) });
    expect(typeof first?.decimalLatitude).toBe('number');
    const one = await getOccurrence(first!.key);
    expect(one.key).toBe(first!.key);
  });

  it('respects the 100,000 offset cap without calling GBIF', async () => {
    const result = await searchOccurrences({ taxonKey: ROBIN }, { offset: 100_000, limit: 300 });
    expect(result.results).toEqual([]);
  });
});

describe('datasets', () => {
  it('detail', async () => {
    const dataset = await getDataset(BACKBONE_DATASET_KEY);
    expect(dataset).toMatchObject({ key: BACKBONE_DATASET_KEY, title: expect.any(String) });
  });

  it('organization', async () => {
    const dataset = await getDataset(BACKBONE_DATASET_KEY);
    const organization = await getOrganization(dataset.publishingOrganizationKey as string);
    expect(organization).toMatchObject({ key: dataset.publishingOrganizationKey, title: expect.any(String) });
  });
});
