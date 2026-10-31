/** GBIF's GraphQL API: predicates from REST filters, named facets, and records per taxon. */
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

  it('batches the main ranks only', async () => {
    const api = await gbif();
    expect([api.canBatchRank('GENUS'), api.canBatchRank('SUBSPECIES')]).toEqual([true, false]);
    await expect(api.firstRecordsByTaxon([1], 'SUBSPECIES', {}, { perTaxon: 1 })).rejects.toThrow(/SUBSPECIES/);
  });
});
