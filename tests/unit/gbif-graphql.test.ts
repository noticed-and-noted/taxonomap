/** GBIF's GraphQL API: predicates from REST filters, named facets, records and common names per taxon. */
import { isGraphql, stubNetwork } from './helpers/network';

async function gbif() {
  vi.resetModules();
  return import('~/lib/gbif');
}

/** A request's GraphQL query text and variables. */
function sent(url: URL) {
  return {
    query: url.searchParams.get('query') ?? '',
    variables: JSON.parse(url.searchParams.get('variables') ?? '{}') as Record<string, unknown>,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('toPredicate', () => {
  it('keeps ranges as REST strings, lists as `in`, and leaves out unset values', async () => {
    const { toPredicate } = await gbif();
    expect(toPredicate({ year: '1990,2000', month: [5, 6], hasCoordinate: true, country: undefined })).toEqual({
      type: 'and',
      predicates: [
        { type: 'equals', key: 'year', value: '1990,2000' },
        { type: 'in', key: 'month', values: ['5', '6'] },
        { type: 'equals', key: 'hasCoordinate', value: 'true' },
      ],
    });
  });

  it('ORs several polygons, as REST does repeated geometry', async () => {
    const { toPredicate } = await gbif();
    expect(toPredicate({ geometry: 'POLYGON((a))' }).predicates).toEqual([
      { type: 'within', geometry: 'POLYGON((a))' },
    ]);
    expect(toPredicate({ geometry: ['POLYGON((a))', 'POLYGON((b))'] }).predicates).toEqual([
      {
        type: 'or',
        predicates: [
          { type: 'within', geometry: 'POLYGON((a))' },
          { type: 'within', geometry: 'POLYGON((b))' },
        ],
      },
    ]);
  });
});

describe('namedOccurrenceFacets', () => {
  it('names taxa and datasets, under REST field names and string keys', async () => {
    const calls = stubNetwork(() => ({
      data: {
        occurrenceSearch: {
          documents: { total: 9 },
          facet: {
            speciesKey: [{ key: '5', count: 3, taxon: { scientificName: 'Turdus merula' } }],
            month: [{ key: 4, count: 2 }],
            countryCode: [{ key: 'GB', count: 1 }],
            datasetKey: [{ key: 'd1', count: 1, dataset: { title: 'Garden birds' } }],
          },
        },
      },
    }));
    const api = await gbif();
    const result = await api.namedOccurrenceFacets(
      { taxonKey: 212 },
      ['speciesKey', 'month', 'country', 'datasetKey'],
      {
        limits: { speciesKey: 50 },
      },
    );
    expect(result).toEqual({
      count: 9,
      facets: {
        speciesKey: [{ name: '5', count: 3, label: 'Turdus merula' }],
        month: [{ name: '4', count: 2 }],
        country: [{ name: 'GB', count: 1 }],
        datasetKey: [{ name: 'd1', count: 1, label: 'Garden birds' }],
      },
    });
    const { query, variables } = sent(calls[0]!);
    expect(calls[0]!.origin).toBe('https://graphql.gbif.org');
    expect(query).toContain('speciesKey(size: 50) { key count taxon { scientificName } }');
    expect(query).toContain('countryCode(size: 200) { key count }');
    expect(query).toContain('datasetKey(size: 200) { key count dataset { title } }');
    expect(variables).toEqual({
      predicate: { type: 'and', predicates: [{ type: 'equals', key: 'taxonKey', value: '212' }] },
    });
  });

  it('retries an answer of only errors and does not keep it', async () => {
    vi.useFakeTimers();
    let isBroken = true;
    const calls = stubNetwork(() =>
      isBroken
        ? { data: null, errors: [{ message: 'upstream' }] }
        : { data: { occurrenceSearch: { documents: { total: 1 }, facet: {} } } },
    );
    const api = await gbif();
    const failing = api.namedOccurrenceFacets({}, ['month']).catch((error: unknown) => error);
    await vi.runAllTimersAsync();
    expect(await failing).toBeInstanceOf(api.GbifUnavailableError);
    isBroken = false;
    await expect(api.namedOccurrenceFacets({}, ['month'])).resolves.toEqual({ count: 1, facets: { month: [] } });
    expect(calls.filter(isGraphql)).toHaveLength(5);
    vi.useRealTimers();
  });

  it('retries an answer whose search came back null beside an error', async () => {
    vi.useFakeTimers();
    let isBroken = true;
    const calls = stubNetwork(() => ({
      data: { occurrenceSearch: isBroken ? null : { documents: { total: 1 }, facet: {} } },
      ...(isBroken && { errors: [{ message: '400: Bad Request' }] }),
    }));
    const api = await gbif();
    const failing = api.namedOccurrenceFacets({}, ['month']).catch((error: unknown) => error);
    await vi.runAllTimersAsync();
    expect(await failing).toBeInstanceOf(api.GbifUnavailableError);
    isBroken = false;
    await expect(api.namedOccurrenceFacets({}, ['month'])).resolves.toEqual({ count: 1, facets: { month: [] } });
    expect(calls.filter(isGraphql)).toHaveLength(5);
    vi.useRealTimers();
  });
});

describe('firstRecordsByTaxon', () => {
  it('buckets records by taxon in one request, with each species key and name', async () => {
    const calls = stubNetwork(() => ({
      data: {
        occurrenceSearch: {
          facet: {
            speciesKey: [
              {
                key: '7',
                taxon: { scientificName: 'Erithacus rubecula' },
                occurrences: { documents: { results: [{ key: 70, taxonID: '13094', publisher: null }] } },
              },
            ],
          },
        },
      },
    }));
    const api = await gbif();
    const records = await api.firstRecordsByTaxon(
      [7, 8],
      'SPECIES',
      { datasetKey: 'inat', license: ['CC0_1_0'] },
      {
        perTaxon: 2,
      },
    );
    expect([...records]).toEqual([
      [7, { name: 'Erithacus rubecula', records: [{ key: 70, taxonID: '13094', speciesKey: 7 }] }],
    ]);
    const { query, variables } = sent(calls[0]!);
    expect(query).toContain('speciesKey(size: 2) { key taxon { scientificName } occurrences { documents(size: 2)');
    expect(variables).toEqual({
      predicate: {
        type: 'and',
        predicates: [
          { type: 'in', key: 'taxonKey', values: ['7', '8'] },
          { type: 'equals', key: 'datasetKey', value: 'inat' },
          { type: 'in', key: 'license', values: ['CC0_1_0'] },
        ],
      },
    });
  });

  it('searches taxa of several ranks and filters in one request, each with its own predicate', async () => {
    const bucket = (key: string, name: string, taxonID: string, count: number) => ({
      key,
      count,
      taxon: { scientificName: name },
      occurrences: { documents: { results: [{ key: 1, taxonID }] } },
    });
    const calls = stubNetwork(() => ({
      data: {
        speciesKey_0: { facet: { speciesKey: [bucket('7', 'Erithacus rubecula', '13094', 3)] } },
        genusKey_0: { facet: { genusKey: [bucket('9', 'Larus', '4388', 2)] } },
        speciesKey_1: { facet: { speciesKey: [bucket('7', 'Erithacus rubecula', '13094', 50)] } },
        genusKey_1: { facet: { genusKey: [] } },
      },
    }));
    const api = await gbif();
    const [photos, everything] = await api.firstRecordsBySearches(
      [
        { key: 7, rank: 'SPECIES' },
        { key: 9, rank: 'GENUS' },
        { key: 8, rank: 'SPECIES' },
      ],
      [
        { filter: { datasetKey: 'inat' }, perTaxon: 1 },
        { filter: {}, perTaxon: 0 },
      ],
      {},
    );
    expect(calls.filter(isGraphql)).toHaveLength(1);
    expect([...photos!.keys()]).toEqual([7, 9]);
    expect(photos!.get(9)?.name).toBe('Larus');
    expect(everything!.get(7)?.count).toBe(50);
    const { query, variables } = sent(calls[0]!);
    expect(query).toContain('speciesKey_0: occurrenceSearch(predicate: $predicateSPECIES_0)');
    expect(query).toContain('documents(size: 0)');
    expect(Object.keys(variables)).toEqual([
      'predicateSPECIES_0',
      'predicateGENUS_0',
      'predicateSPECIES_1',
      'predicateGENUS_1',
    ]);
  });

  it('batches the main ranks only', async () => {
    const api = await gbif();
    expect([api.canBatchRank('GENUS'), api.canBatchRank('SUBSPECIES')]).toEqual([true, false]);
    await expect(api.firstRecordsByTaxon([1], 'SUBSPECIES', {}, { perTaxon: 1 })).rejects.toThrow(/SUBSPECIES/);
  });
});

describe('vernacularNamesByTaxon', () => {
  it('looks up every taxon in one request, leaving out those GBIF does not know', async () => {
    const robin = { vernacularName: 'Robin', language: 'eng' };
    const calls = stubNetwork(() => ({ data: { k7: { vernacularNames: [robin] }, k8: null, k9: {} } }));
    const api = await gbif();
    expect([...(await api.vernacularNamesByTaxon([7, 8, 9]))]).toEqual([
      [7, [robin]],
      [9, []],
    ]);
    expect(calls).toHaveLength(1);
    expect(sent(calls[0]!).query).toContain('k8: taxonInfo(key: "8") { vernacularNames { vernacularName language } }');
  });

  it('sends nothing for no taxa', async () => {
    const calls = stubNetwork(() => undefined);
    const api = await gbif();
    expect((await api.vernacularNamesByTaxon([])).size).toBe(0);
    expect(calls).toHaveLength(0);
  });
});
