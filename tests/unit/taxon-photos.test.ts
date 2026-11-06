/**
 * Taxon photos: the ordered list (curated → most-voted → GBIF), the lead
 * photo always being that list's first photo through every fallback, and
 * matching GBIF taxa to iNaturalist (including via ancestors).
 */
import type { NameRow } from '~/lib/data/types';
import type { InatPhoto, InatTaxon } from '~/lib/photos/inat';

interface Obs {
  id: number;
  uri: string;
  photos: InatPhoto[];
}
interface World {
  /** GBIF key → the iNaturalist record GBIF holds (taxonID, species). */
  records: Record<number, { taxonID?: string; species?: string }>;
  gbifInat: Record<number, object[]>;
  gbifAny: Record<number, object[]>;
  /** GBIF key → how many records GBIF holds of the taxon. */
  counts?: Record<number, number>;
  taxa: Record<number, InatTaxon>;
  voted: Record<number, Obs[]>;
  /** GBIF keys whose record lookup fails, and iNaturalist taxa whose observations fail. */
  fail?: { records?: number[]; voted?: number[] };
  /** Species GBIF's batched iNaturalist record search (GraphQL) leaves out, or `all` to make it fail. */
  crowdedOut?: number[] | 'all';
  /** Make GBIF's batched lead-photo search (GraphQL) fail. */
  isPhotoBatchDown?: boolean;
  /** A baked name index, as /data/names.json serves it. */
  names?: NameRow[];
}

const photo = (id: number, license_code: string | null = 'cc-by'): InatPhoto => ({
  id,
  url: `https://inaturalist-open-data.s3.amazonaws.com/photos/${id}/square.jpg`,
  license_code,
  attribution: `(c) Person ${id}, some rights reserved`,
});
const taxon = (id: number, rank_level: number, photos: InatPhoto[] = [], ancestor_ids = [1, id]): InatTaxon => ({
  id,
  name: `Taxon ${id}`,
  rank_level,
  ancestor_ids,
  taxon_photos: photos.map((photoItem) => ({ photo: photoItem })),
});
const observation = (id: number, ...photos: InatPhoto[]): Obs => ({
  id,
  uri: `https://www.inaturalist.org/observations/${id}`,
  photos,
});
/** A GBIF record with one photo. */
const occ = (key: number, url: string) => ({
  key,
  datasetKey: 'd',
  license: 'http://creativecommons.org/licenses/by/4.0/legalcode',
  media: [{ type: 'StillImage', identifier: url }],
});

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

interface PredicatePart {
  key?: string;
  value?: string;
  values?: string[];
}

/**
 * GBIF's GraphQL API: records bucketed per taxon, from the iNaturalist record search (no
 * mediaType) or a lead-photo search (first 3 photo records per taxon).
 */
function graphql(world: World, params: URLSearchParams): Response {
  const query = params.get('query') ?? '';
  const variables = JSON.parse(params.get('variables')!) as Record<string, { predicates: PredicatePart[] }>;
  const answer = (predicate: { predicates: PredicatePart[] }, selection: string) => {
    const size = Number(/documents\(size: (\d+)\)/.exec(selection)?.[1] ?? 3);
    const parts = predicate.predicates;
    const part = (key: string) => parts.find((candidate) => candidate.key === key);
    const isPhotoSearch = !!part('mediaType');
    const isCountSearch = parts.every((candidate) => candidate.key === 'taxonKey');
    if (isCountSearch) {
      const counted = part('taxonKey')!
        .values!.map(Number)
        .filter((key) => world.counts?.[key] !== undefined);
      return counted.map((key) => ({
        key: String(key),
        count: world.counts![key],
        taxon: null,
        occurrences: { documents: { results: [] } },
      }));
    }
    if (!isPhotoSearch && world.crowdedOut === 'all') return null;
    if (isPhotoSearch && world.isPhotoBatchDown) return null;
    const out = (world.crowdedOut ?? []) as number[];
    const recordsOf = (key: number): object[] => {
      if (isPhotoSearch) return ((part('datasetKey') ? world.gbifInat : world.gbifAny)[key] ?? []).slice(0, size);
      const record = world.records[key];
      return record && !out.includes(key) ? [{ key: 1, datasetKey: 'd', ...record }] : [];
    };
    return part('taxonKey')!
      .values!.map(Number)
      .flatMap((key) => {
        const results = recordsOf(key);
        const name = world.records[key]?.species;
        return results.length
          ? [
              {
                key: String(key),
                taxon: name ? { scientificName: name } : null,
                occurrences: { documents: { results } },
              },
            ]
          : [];
      });
  };
  const respond = (facet: string, predicate: { predicates: PredicatePart[] }, selection: string) => {
    const buckets = answer(predicate, selection);
    return buckets && { facet: { [facet]: buckets } };
  };
  // One search per rank, each with its own predicate, when the query mixes ranks.
  const ranked = [
    ...query.matchAll(/(\w+): occurrenceSearch\(predicate: \$(\w+)\)([^]*?)(?=\w+: occurrenceSearch\(|$)/g),
  ];
  if (ranked.length) {
    const data = Object.fromEntries(
      ranked.map(([, alias, name, selection]) => [
        alias!,
        respond(/facet \{ (\w+)\(/.exec(selection!)![1]!, variables[name!]!, selection!),
      ]),
    );
    return Object.values(data).includes(null) ? new Response('bad', { status: 400 }) : json({ data });
  }
  const facet = /facet \{ (\w+)\(/.exec(query)![1]!;
  const single = respond(facet, variables['predicate'] as unknown as { predicates: PredicatePart[] }, query);
  return single ? json({ data: { occurrenceSearch: single } }) : new Response('bad', { status: 400 });
}

function network(world: World) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (raw: string) => {
    calls.push(raw);
    const parsedUrl = new URL(raw, 'http://site.test');
    const params = parsedUrl.searchParams;
    if (parsedUrl.pathname === '/data/names.json') return json({ v: 1, generated: '', names: world.names ?? [] });
    if (parsedUrl.host === 'graphql.gbif.org') return graphql(world, params);
    if (parsedUrl.host === 'api.gbif.org' && parsedUrl.pathname === '/v1/occurrence/search') {
      const key = Number(params.get('taxonKey'));
      if (params.get('limit') === '1') {
        if (world.fail?.records?.includes(key)) return new Response('bad', { status: 400 });
        const record = world.records[key];
        return json({ results: record ? [{ key: 1, datasetKey: 'd', ...record }] : [], count: 0, endOfRecords: true });
      }
      const results = (params.get('datasetKey') ? world.gbifInat : world.gbifAny)[key] ?? [];
      return json({ results, count: results.length, endOfRecords: true });
    }
    if (parsedUrl.host === 'api.inaturalist.org' && parsedUrl.pathname.startsWith('/v2/taxa/')) {
      const ids = parsedUrl.pathname.slice('/v2/taxa/'.length).split(',').map(Number);
      return json({ results: ids.flatMap((id) => world.taxa[id] ?? []) });
    }
    if (parsedUrl.host === 'api.inaturalist.org' && parsedUrl.pathname === '/v2/observations') {
      if (world.fail?.voted?.includes(Number(params.get('taxon_id')))) return new Response('bad', { status: 400 });
      return json({ results: world.voted[Number(params.get('taxon_id'))] ?? [] });
    }
    return new Response('not found', { status: 404 });
  });
  return calls;
}

/** Fresh modules per test: caches and the iNaturalist throttle start empty. */
async function load() {
  vi.resetModules();
  return import('~/lib/photos/taxon-photos');
}

/** A short label per photo, to compare lists. */
const label = (image: { source?: string; url: string; photoId?: number }) =>
  image.source === 'inat' ? `inat:${image.photoId}` : `gbif:${image.url}`;

// Remembered IDs would otherwise carry between tests through the runtime's own localStorage.
beforeEach(() => void stubStorage());

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('taxon photos', () => {
  it('lists curated, then most-voted, then GBIF photos, skipping duplicates and closed licences', async () => {
    network({
      records: { 100: { taxonID: '8021', species: 'Corvus brachyrhynchos' } },
      taxa: { 8021: taxon(8021, 10, [photo(1), photo(2, null), photo(3, 'cc-by-nc-sa')]) },
      voted: { 8021: [observation(10, photo(3)), observation(11, photo(2, null), photo(4))] },
      gbifInat: {
        100: [
          occ(500, 'https://inaturalist-open-data.s3.amazonaws.com/photos/4/original.jpg'),
          occ(501, 'https://x/a.jpg'),
        ],
      },
      gbifAny: { 100: [occ(501, 'https://x/a.jpg'), occ(502, 'https://x/b.jpg')] },
    });
    const loaded = await load();
    const list = await loaded.taxonPhotos({ key: 100, rank: 'SPECIES' });
    // Photo 2 is all rights reserved; 3 and 4 are already listed; record 501 already gave a photo.
    expect(list.map(label)).toEqual(['inat:1', 'inat:3', 'inat:4', 'gbif:https://x/a.jpg', 'gbif:https://x/b.jpg']);
    expect(list[0]).toMatchObject({ licence: 'CC-BY', creator: 'Person 1', publisher: 'iNaturalist' });
    expect(list[2]).toMatchObject({ observationUrl: 'https://www.inaturalist.org/observations/11' });
    expect(label((await loaded.leadPhoto({ key: 100, rank: 'SPECIES' }))!)).toBe('inat:1');
  });

  it('keeps the lead photo equal to the first listed photo through every fallback', async () => {
    const world: World = {
      records: {
        1: { taxonID: '11' }, // curated photos
        2: { taxonID: '12' }, // curated photos all rights reserved → most-voted
        3: { taxonID: '13' }, // nothing on iNaturalist → GBIF's iNaturalist dataset
        4: {}, // no iNaturalist record → GBIF's iNaturalist dataset
        5: {}, // → any GBIF dataset
        6: {}, // no photos at all
      },
      taxa: { 11: taxon(11, 10, [photo(111)]), 12: taxon(12, 10, [photo(121, null)]), 13: taxon(13, 10) },
      voted: { 12: [observation(1, photo(122))] },
      gbifInat: { 3: [occ(30, 'https://x/3.jpg')], 4: [occ(40, 'https://x/4.jpg')] },
      gbifAny: { 3: [occ(31, 'https://x/3b.jpg')], 5: [occ(50, 'https://x/5.jpg')] },
    };
    network(world);
    const loaded = await load();
    const taxa = [1, 2, 3, 4, 5, 6].map((key) => ({ key, rank: 'SPECIES' as const }));
    const { images } = await loaded.leadPhotos(taxa);
    const leads = taxa.map((lead) => images.get(lead.key));
    expect(leads.map((lead) => (lead ? label(lead) : null))).toEqual([
      'inat:111',
      'inat:122',
      'gbif:https://x/3.jpg',
      'gbif:https://x/4.jpg',
      'gbif:https://x/5.jpg',
      null,
    ]);
    for (const candidate of taxa) {
      const first = (await loaded.taxonPhotos(candidate))[0];
      expect(first && label(first)).toBe(images.get(candidate.key) && label(images.get(candidate.key)!));
    }
  });

  it('matches a record of a lower rank to its ancestor at the taxon’s rank', async () => {
    network({
      records: { 7: { taxonID: '9001' }, 8: { taxonID: '9001' } },
      taxa: {
        9001: taxon(9001, 5, [photo(1)], [1, 70, 8000, 8021, 9001]), // subspecies
        8021: taxon(8021, 10, [photo(2)], [1, 70, 8000, 8021]), // its species
        8000: taxon(8000, 20, [photo(3)], [1, 70, 8000]), // its genus
        70: taxon(70, 70, [photo(4)], [1, 70]),
      },
      voted: {},
      gbifInat: {},
      gbifAny: {},
    });
    const loaded = await load();
    const { images } = await loaded.leadPhotos([
      { key: 7, rank: 'SPECIES' },
      { key: 8, rank: 'GENUS' },
    ]);
    expect(label(images.get(7)!)).toBe('inat:2');
    expect(label(images.get(8)!)).toBe('inat:3');
  });

  it('matches by GBIF’s name when iNaturalist ranks the group differently', async () => {
    network({
      // GBIF's order Cetacea is an infraorder inside iNaturalist's order Artiodactyla.
      records: { 733: { taxonID: '41481', order: 'Cetacea' } as { taxonID: string } },
      taxa: {
        41481: taxon(41481, 10, [photo(1)], [1, 152870, 152871, 41481]),
        152870: { ...taxon(152870, 40, [photo(2)], [1, 152870]), name: 'Artiodactyla' },
        152871: { ...taxon(152871, 35, [photo(3)], [1, 152870, 152871]), name: 'Cetacea' },
      },
      voted: {},
      gbifInat: {},
      gbifAny: {},
    });
    const loaded = await load();
    expect(label((await loaded.leadPhoto({ key: 733, rank: 'ORDER' }))!)).toBe('inat:3');
  });

  it('caps the list at 20 photos', async () => {
    network({
      records: { 1: { taxonID: '11' } },
      taxa: {
        11: taxon(
          11,
          10,
          Array.from({ length: 12 }, (_unused, index) => photo(100 + index)),
        ),
      },
      voted: { 11: Array.from({ length: 20 }, (_unused, index) => observation(index, photo(200 + index))) },
      gbifInat: { 1: [occ(1, 'https://x/1.jpg')] },
      gbifAny: {},
    });
    const loaded = await load();
    const list = await loaded.taxonPhotos({ key: 1, rank: 'SPECIES' });
    expect(list).toHaveLength(20);
    expect(list.every((index) => index.source === 'inat')).toBe(true);
  });

  it('batches iNaturalist taxa 30 to a request', async () => {
    const keys = Array.from({ length: 35 }, (_unused, index) => index + 1);
    const calls = network({
      records: Object.fromEntries(keys.map((key) => [key, { taxonID: String(1000 + key) }])),
      taxa: Object.fromEntries(keys.map((key) => [1000 + key, taxon(1000 + key, 10, [photo(key)])])),
      voted: {},
      gbifInat: {},
      gbifAny: {},
    });
    const loaded = await load();
    const { images } = await loaded.leadPhotos(keys.map((key) => ({ key, rank: 'SPECIES' as const })));
    expect(images.size).toBe(35);
    expect(calls.filter((call) => call.includes('api.inaturalist.org'))).toHaveLength(2);
  });

  it('forms taxa batches from the requested IDs, not from what is already loaded', async () => {
    const calls = network({
      records: {},
      taxa: { 5: taxon(5, 10), 40: taxon(40, 10) },
      voted: {},
      gbifInat: {},
      gbifAny: {},
    });
    vi.resetModules();
    const { getTaxa } = await import('~/lib/photos/inat');
    await getTaxa([5]);
    // The same list always makes the same request, so caches can share it.
    await getTaxa([40, 5]);
    expect(calls.map((call) => new URL(call).pathname)).toEqual(['/v2/taxa/5', '/v2/taxa/5,40']);
  });
});

describe('iNaturalist photo URLs', () => {
  it('picks the smallest iNaturalist size at least as wide as requested', async () => {
    const { thumbnailUrl } = await import('~/lib/gbif/images');
    const image = {
      source: 'inat' as const,
      photoId: 1,
      licence: 'CC-BY' as const,
      url: 'https://inaturalist-open-data.s3.amazonaws.com/photos/1/square.jpeg',
    };
    expect(thumbnailUrl(image, '200x')).toBe(
      'https://inaturalist-open-data.s3.amazonaws.com/photos/1/small.jpeg?x-cors',
    );
    expect(thumbnailUrl(image, '400x')).toBe(
      'https://inaturalist-open-data.s3.amazonaws.com/photos/1/medium.jpeg?x-cors',
    );
    expect(thumbnailUrl(image, '800x')).toBe(
      'https://inaturalist-open-data.s3.amazonaws.com/photos/1/large.jpeg?x-cors',
    );
  });

  it('sizes iNaturalist photos on GBIF records at iNaturalist, other photos through GBIF’s cache', async () => {
    const { thumbnailUrl } = await import('~/lib/gbif/images');
    const record = { licence: 'CC-BY' as const, occurrenceKey: 1, datasetKey: 'dataset' };
    expect(
      thumbnailUrl({ ...record, url: 'https://inaturalist-open-data.s3.amazonaws.com/photos/1/original.jpg' }, '200x'),
    ).toBe('https://inaturalist-open-data.s3.amazonaws.com/photos/1/small.jpg?x-cors');
    expect(thumbnailUrl({ ...record, url: 'https://example.org/photo.jpg' }, '200x')).toMatch(
      /\/v1\/image\/cache\/200x\/occurrence\/1\/media\/[0-9a-f]{32}$/,
    );
  });

  it('asks for CORS only from hosts that send it (GBIF’s image cache does not)', async () => {
    const { photoCrossOrigin } = await import('~/lib/gbif/images');
    expect(photoCrossOrigin('https://inaturalist-open-data.s3.amazonaws.com/photos/1/small.jpeg')).toBe('anonymous');
    expect(photoCrossOrigin('https://api.gbif.org/v1/image/cache/400x/occurrence/1/media/abc')).toBeUndefined();
    expect(photoCrossOrigin('https://static.inaturalist.org/photos/1/small.jpg')).toBeUndefined();
  });

  it('retries a failed CORS photo once without crossorigin, then gives up', async () => {
    const { photoCrossOrigin, retryWithoutCors } = await import('~/lib/gbif/images');
    const url = 'https://inaturalist-open-data.s3.amazonaws.com/photos/2/small.jpeg';
    expect(retryWithoutCors(url)).toBe(true);
    expect(photoCrossOrigin(url)).toBeUndefined();
    expect(retryWithoutCors(url)).toBe(false);
    // GBIF photos never load with CORS, so there is nothing to retry.
    expect(retryWithoutCors('https://api.gbif.org/v1/image/cache/400x/occurrence/1/media/abc')).toBe(false);
  });
});

describe('taxon photo edge cases', () => {
  const empty = { records: {}, taxa: {}, voted: {}, gbifInat: {}, gbifAny: {} };

  it('falls back to GBIF photos for unmatched ranks, failed lookups, records above the rank and taxa without an ancestor at it', async () => {
    network({
      ...empty,
      records: { 3: { taxonID: '30' }, 4: { taxonID: '40' }, 5: { taxonID: '50' } },
      taxa: { 30: { id: 30, name: 'No ancestors', rank_level: 5 }, 40: taxon(40, 10, [], [1, 40]), 50: taxon(50, 20) },
      gbifAny: {
        1: [occ(11, 'u.jpg')],
        2: [occ(12, 'f.jpg')],
        3: [occ(13, 's.jpg')],
        4: [occ(14, 'g.jpg')],
        5: [occ(15, 'h.jpg')],
      },
      fail: { records: [2] },
    });
    const loaded = await load();
    const { images } = await loaded.leadPhotos(
      [
        { key: 1, rank: 'UNRANKED' as never },
        { key: 2, rank: 'SPECIES' },
        { key: 3, rank: 'SPECIES' },
        { key: 4, rank: 'GENUS' },
        // Its record is only named to genus.
        { key: 5, rank: 'SPECIES' },
      ],
      { signal: new AbortController().signal },
    );
    expect([1, 2, 3, 4, 5].map((key) => label(images.get(key)!))).toEqual([
      'gbif:u.jpg',
      'gbif:f.jpg',
      'gbif:s.jpg',
      'gbif:g.jpg',
      'gbif:h.jpg',
    ]);
  });

  it('skips a source that fails, and takes one photo per GBIF record', async () => {
    network({
      ...empty,
      records: { 5: { taxonID: '50' } },
      taxa: { 50: { id: 50, name: 'Bare', rank_level: 10 } },
      gbifInat: { 5: [{ ...occ(15, 'a.jpg'), media: [{ identifier: 'a.jpg' }, { identifier: 'b.jpg' }] }] },
      fail: { voted: [50] },
    });
    const loaded = await load();
    const photos = await loaded.taxonPhotos({ key: 5, rank: 'SPECIES' }, { signal: new AbortController().signal });
    expect(photos.map(label)).toEqual(['gbif:a.jpg']);
  });

  it('asks GBIF’s REST search for a lone taxon when GraphQL is down', async () => {
    network({ ...empty, gbifAny: { 6: [occ(16, 'x.jpg')] }, isPhotoBatchDown: true });
    const loaded = await load();
    const { images } = await loaded.leadPhotos([{ key: 6, rank: 'SPECIES' }]);
    expect(label(images.get(6)!)).toBe('gbif:x.jpg');
  });

  it('gives up on the batch, not falling back, when it is cancelled as the batch fails', async () => {
    const calls = network({ ...empty, gbifAny: { 6: [occ(16, 'x.jpg')] }, isPhotoBatchDown: true });
    const answer = globalThis.fetch;
    const controller = new AbortController();
    vi.stubGlobal('fetch', async (raw: string) => {
      const isPhotoBatch = raw.includes('graphql.gbif.org') && raw.includes('mediaType');
      if (isPhotoBatch) controller.abort();
      return answer(raw);
    });
    const loaded = await load();
    const taxa = [
      { key: 6, rank: 'SPECIES' as const },
      { key: 7, rank: 'SPECIES' as const },
    ];
    const { images } = await loaded.leadPhotos(taxa, { signal: controller.signal });
    expect(images.size).toBe(0);
    expect(calls.filter((url) => url.includes('/v1/occurrence/search'))).toHaveLength(0);
  });

  it('leaves out a taxon whose batched records carry no usable photo', async () => {
    const unlicensed = { ...occ(17, 'y.jpg'), license: 'All rights reserved' };
    network({ ...empty, gbifAny: { 6: [occ(16, 'x.jpg')], 7: [unlicensed] } });
    const loaded = await load();
    const taxa = [
      { key: 6, rank: 'SPECIES' as const },
      { key: 7, rank: 'SPECIES' as const },
    ];
    const { images } = await loaded.leadPhotos(taxa);
    expect([...images.keys()]).toEqual([6]);
  });

  it('stops once its signal aborts', async () => {
    const calls = network({ ...empty, gbifAny: { 6: [occ(16, 'x.jpg')] } });
    const loaded = await load();
    const { images } = await loaded.leadPhotos([{ key: 6, rank: 'SPECIES' }], { signal: AbortSignal.abort() });
    expect(images.size).toBe(0);
    expect(calls).toHaveLength(0);
  });
});

describe('iNaturalist photos', () => {
  it('credit the attribution name, and allow taxa and observations without photos', async () => {
    vi.resetModules();
    const inat = await import('~/lib/photos/inat');
    const photoWithAttribution = { ...photo(1), attribution_name: 'Ann' };
    expect(inat.toImage(photoWithAttribution)).toMatchObject({ creator: 'Ann' });
    expect(inat.toImage({ ...photo(2), attribution: 'odd' })).not.toHaveProperty('creator');
    expect(inat.curatedImages({ id: 1, name: 'x', rank_level: 10 })).toEqual([]);
    expect(inat.observationImages([{ id: 1 }, { id: 2, photos: [photo(3, null)] }])).toEqual([]);
  });
});

/** localStorage as a Map, readable and writable from a test. */
function stubStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  });
  return store;
}

const speciesTaxa = (...ids: number[]) =>
  Object.fromEntries(ids.map((id) => [id, taxon(id, 10, [photo(id * 10)], [1, id])]));
const recordsFor = (...keys: number[]) => Object.fromEntries(keys.map((key) => [key, { taxonID: String(key + 100) }]));
const url = (raw: string) => new URL(raw, 'http://site.test');
/** The batched iNaturalist record searches (GraphQL, without the photo searches' mediaType). */
const batched = (calls: string[]) =>
  calls.filter((call) => url(call).pathname === '/graphql' && !call.includes('mediaType'));
const batchedKeys = (call: string) =>
  (
    JSON.parse(url(call).searchParams.get('variables')!) as { predicate: { predicates: PredicatePart[] } }
  ).predicate.predicates.find((part) => part.key === 'taxonKey')!.values!.length;
const single = (calls: string[]) => calls.filter((call) => url(call).searchParams.get('limit') === '1');

describe('finding iNaturalist taxa cheaply', () => {
  const base = { records: {}, taxa: {}, voted: {}, gbifInat: {}, gbifAny: {} };
  const species = (...keys: number[]) => keys.map((key) => ({ key, rank: 'SPECIES' as const }));

  it('searches GBIF for every species’ iNaturalist records in one request', async () => {
    const keys = [1, 2, 3, 4, 5, 6, 7];
    const calls = network({
      ...base,
      records: recordsFor(...keys),
      taxa: speciesTaxa(...keys.map((key) => key + 100)),
    });
    const loaded = await load();
    const { images } = await loaded.leadPhotos(species(...keys));
    expect(batched(calls).map(batchedKeys)).toEqual([7]);
    expect(single(calls)).toHaveLength(0);
    expect(keys.map((key) => label(images.get(key)!))).toEqual(keys.map((key) => `inat:${(key + 100) * 10}`));
  });

  it('finds GBIF photos for the species iNaturalist has none of in one request per source', async () => {
    const calls = network({
      ...base,
      gbifInat: { 1: [occ(10, 'a.jpg')] },
      gbifAny: { 2: [{ ...occ(20, 'b.jpg'), media: [{ type: 'Sound', identifier: 'x.mp3' }] }, occ(21, 'c.jpg')] },
    });
    const { leadPhotos } = await load();
    const { images } = await leadPhotos(species(1, 2, 3));
    expect([1, 2, 3].map((key) => images.get(key) && label(images.get(key)!))).toEqual([
      'gbif:a.jpg',
      // The first record holds no photo, so the lead is the next record's.
      'gbif:c.jpg',
      undefined,
    ]);
    const photoSearches = calls.filter((call) => call.includes('mediaType'));
    expect(photoSearches).toHaveLength(2);
    expect(calls.some((call) => url(call).pathname === '/v1/occurrence/search')).toBe(false);
  });

  it('gives a lone taxon the same lead photo as its page, however deep the first photo sits', async () => {
    const soundOnly = (key: number) => ({ ...occ(key, 'x.jpg'), media: [{ type: 'Sound', identifier: 'x.mp3' }] });
    network({ ...base, gbifAny: { 9: [soundOnly(1), soundOnly(2), soundOnly(3), soundOnly(4), occ(95, 'deep.jpg')] } });
    const { leadPhotos, taxonPhotos } = await load();
    const target = { key: 9, rank: 'GENUS' as const };
    const lead = (await leadPhotos([target])).images.get(9);
    expect(label(lead!)).toBe('gbif:deep.jpg');
    expect(label((await taxonPhotos(target))[0]!)).toBe('gbif:deep.jpg');
  });

  it('brings the record counts with the GBIF photos', async () => {
    const calls = network({
      ...base,
      gbifAny: { 9: [occ(90, 'g.jpg')] },
      counts: { 9: 123 },
    });
    const { leadPhotos } = await load();
    const lead = await leadPhotos([{ key: 9, rank: 'GENUS' }], { withCounts: true });
    expect(label(lead.images.get(9)!)).toBe('gbif:g.jpg');
    expect(lead.counts).toEqual(new Map([[9, 123]]));
    // One request for the genus's iNaturalist record, and one for its photos and count together.
    expect(single(calls)).toHaveLength(1);
    expect(calls.filter((call) => url(call).pathname === '/graphql')).toHaveLength(1);
    // A taxon with no records has no facet value: its count is known to be none.
    expect((await leadPhotos([{ key: 8, rank: 'GENUS' }], { withCounts: true })).counts).toEqual(new Map([[8, 0]]));
  });

  it('searches GBIF photos one taxon at a time when the batched search fails', async () => {
    const calls = network({
      ...base,
      gbifInat: { 1: [occ(10, 'a.jpg')] },
      gbifAny: { 2: [occ(20, 'b.jpg')] },
      isPhotoBatchDown: true,
    });
    const { leadPhotos } = await load();
    const { images } = await leadPhotos(species(1, 2));
    expect([1, 2].map((key) => label(images.get(key)!))).toEqual(['gbif:a.jpg', 'gbif:b.jpg']);
    expect(calls.some((call) => url(call).pathname === '/v1/occurrence/search')).toBe(true);
  });

  it('trusts the batch about the species it left out, and searches one by one only when it fails', async () => {
    const keys = [1, 2, 3];
    const world = { ...base, records: recordsFor(...keys), taxa: speciesTaxa(101, 102, 103) };
    const calls = network({ ...world, crowdedOut: [2] });
    const { leadPhotos } = await load();
    await leadPhotos(species(...keys));
    expect(single(calls)).toHaveLength(0);

    vi.unstubAllGlobals();
    const failed = network({ ...world, crowdedOut: 'all' });
    const again = await load();
    const { images } = await again.leadPhotos(species(...keys));
    expect(single(failed)).toHaveLength(3);
    expect(images.size).toBe(3);
  });

  it('does not batch a lone species, or taxa above species', async () => {
    const calls = network({ ...base, records: recordsFor(1, 2), taxa: speciesTaxa(101, 102) });
    const loaded = await load();
    await loaded.leadPhotos([{ key: 1, rank: 'SPECIES' }]);
    await loaded.leadPhotos([
      { key: 2, rank: 'GENUS' },
      { key: 3, rank: 'FAMILY' },
    ]);
    expect(batched(calls)).toHaveLength(0);
    expect(single(calls)).toHaveLength(3);
  });

  it('goes to REST as soon as a batched photo search fails', async () => {
    const calls = network({
      ...base,
      isPhotoBatchDown: true,
      gbifInat: { 1: [occ(11, 'a.jpg')], 2: [occ(12, 'b.jpg')] },
    });
    const { images } = await (await load()).leadPhotos(species(1, 2));
    expect(calls.filter((call) => url(call).pathname === '/graphql' && call.includes('mediaType'))).toHaveLength(1);
    expect([1, 2].map((key) => label(images.get(key)!))).toEqual(['gbif:a.jpg', 'gbif:b.jpg']);
  });

  it('ignores batch records without a species or a usable iNaturalist ID, and keeps the first per species', async () => {
    const calls = network({
      ...base,
      records: { 1: { taxonID: 'urn:x' }, 2: { taxonID: '102' }, 3: { taxonID: '0' }, 4: {} },
      taxa: speciesTaxa(102),
    });
    const loaded = await load();
    const { images, names } = await loaded.leadPhotos(species(1, 2, 3, 4));
    expect(single(calls)).toHaveLength(0);
    expect([...images.keys()]).toEqual([2]);
    expect(names.size).toBe(0);
  });

  it('uses an ID baked into the name index without searching GBIF', async () => {
    const calls = network({
      ...base,
      taxa: speciesTaxa(501, 502),
      names: [
        [1, 'S', 'One', null, 9, 501],
        [2, 'S', 'Two', null, 8, 502],
        [3, 'S', 'Three', null, 7],
      ],
    });
    const loaded = await load();
    await (await import('~/lib/data/name-index')).loadNameIndex();
    const { images } = await loaded.leadPhotos([...species(1, 2, 3), { key: 1, rank: 'GENUS' as const }]);
    // Species 3 has no baked ID, and the genus is not a species: both are looked up the old way.
    expect(single(calls).map((call) => new URL(call).searchParams.get('taxonKey'))).toEqual(['3', '1']);
    expect([1, 2].map((key) => label(images.get(key)!))).toEqual(['inat:5010', 'inat:5020']);
  });

  it('does not wait for the name index to load', async () => {
    const calls = network({ ...base, names: [[1, 'S', 'One', null, 9, 501]] });
    const loaded = await load();
    await loaded.leadPhotos(species(1));
    expect(calls.some((call) => call.includes('/data/names.json'))).toBe(false);
    expect(single(calls)).toHaveLength(1);
  });

  it('remembers matched IDs across visits, and skips the GBIF search for them', async () => {
    const store = stubStorage();
    const world = { ...base, records: recordsFor(1, 2), taxa: speciesTaxa(101, 102) };
    network(world);
    await (await load()).leadPhotos(species(1, 2));
    // Each with iNaturalist's name, null here: these taxa have none.
    expect(JSON.parse(store.get('inat-ids-v3')!)).toEqual([
      [1, 101, null],
      [2, 102, null],
    ]);

    vi.unstubAllGlobals();
    stubStorage(Object.fromEntries(store));
    const calls = network(world);
    const { images } = await (await load()).leadPhotos(species(1, 2));
    expect(batched(calls)).toHaveLength(0);
    expect(single(calls)).toHaveLength(0);
    expect(images.size).toBe(2);
  });

  it('forgets a remembered ID iNaturalist no longer has, so the next visit looks it up afresh', async () => {
    const store = stubStorage({ 'inat-ids-v3': JSON.stringify([[1, 999]]) });
    network({ ...base, gbifAny: { 1: [occ(11, 'g.jpg')] } });
    const { images } = await (await load()).leadPhotos(species(1));
    expect(label(images.get(1)!)).toBe('gbif:g.jpg');
    expect(JSON.parse(store.get('inat-ids-v3')!)).toEqual([]);
  });

  it('never searches iNaturalist by name: a species GBIF holds no record of keeps GBIF photos', async () => {
    const calls = network({
      ...base,
      records: { 2: { taxonID: '102' } },
      taxa: speciesTaxa(102),
      gbifAny: { 1: [occ(11, 'f.jpg')], 3: [occ(13, 'g.jpg')] },
    });
    const loaded = await load();
    const { images } = await loaded.leadPhotos(
      [
        { key: 1, rank: 'SPECIES' },
        { key: 2, rank: 'SPECIES' },
        { key: 3, rank: 'GENUS' },
      ],
      { signal: new AbortController().signal },
    );
    expect(calls.some((call) => new URL(call).pathname === '/v2/taxa')).toBe(false);
    expect([1, 2, 3].map((key) => label(images.get(key)!))).toEqual(['gbif:f.jpg', 'inat:1020', 'gbif:g.jpg']);
  });

  it('matches nothing when GBIF’s record matched a taxon that is not at the rank', async () => {
    const calls = network({
      ...base,
      records: { 1: { taxonID: '50' } },
      taxa: { 50: { id: 50, name: 'Orphan', rank_level: 5 } },
      gbifAny: { 1: [occ(11, 'g.jpg')] },
    });
    const loaded = await load();
    await loaded.leadPhotos([{ key: 1, rank: 'SPECIES' }]);
    expect(calls.some((call) => new URL(call).pathname === '/v2/taxa')).toBe(false);
  });

  it('resolves iNaturalist species IDs for a bake, leaving out species with none', async () => {
    network({
      ...base,
      records: recordsFor(1),
      taxa: speciesTaxa(101),
    });
    const loaded = await load();
    const ids = await loaded.resolveInatIds([
      { key: 1, rank: 'SPECIES' },
      { key: 2, rank: 'SPECIES' },
      { key: 3, rank: 'SPECIES' },
    ]);
    expect(ids).toEqual(new Map([[1, 101]]));
  });
});

describe('remembered iNaturalist IDs', () => {
  const load = async () => {
    vi.resetModules();
    return import('~/lib/photos/inat-ids');
  };

  it('works for this visit alone when there is no storage', async () => {
    vi.stubGlobal('localStorage', undefined);
    const loaded = await load();
    expect(loaded.knownInatId(1)).toBeUndefined();
    loaded.rememberInatMatches(new Map([[1, { id: 11 }]]));
    expect(loaded.knownInatId(1)).toBe(11);
    loaded.forgetInatId(1);
    expect(loaded.knownInatId(1)).toBeUndefined();
  });

  it('reads what an earlier visit stored, ignoring what is not an ID pair', async () => {
    stubStorage({
      'inat-ids-v3': JSON.stringify([[1, 11], ['x', 2], [3, 'y'], [4, 44], 5]),
    });
    const loaded = await load();
    expect([1, 3, 4].map(loaded.knownInatId)).toEqual([11, undefined, 44]);
  });

  it('starts empty when the stored value is not JSON', async () => {
    stubStorage({ 'inat-ids-v3': '{' });
    expect((await load()).knownInatId(1)).toBeUndefined();
  });

  it('writes only when something changed, newest last', async () => {
    const store = stubStorage();
    const setItem = vi.spyOn(localStorage, 'setItem');
    const loaded = await load();
    loaded.rememberInatMatches(new Map([[1, { id: 11 }]]));
    loaded.rememberInatMatches(new Map([[1, { id: 11 }]]));
    loaded.rememberInatMatches(
      new Map([
        [2, { id: 22 }],
        [1, { id: 12 }],
      ]),
    );
    loaded.forgetInatId(9);
    loaded.forgetInatId(2);
    expect(setItem).toHaveBeenCalledTimes(3);
    expect(JSON.parse(store.get('inat-ids-v3')!)).toEqual([[1, 12]]);
  });

  it('remembers names beside IDs, keeping a name while the ID stays the same', async () => {
    const store = stubStorage();
    const loaded = await load();
    loaded.rememberInatMatches(
      new Map([
        [1, { id: 11, name: 'Robin' }],
        [2, { id: 22, name: null }],
      ]),
    );
    loaded.rememberInatMatches(new Map([[1, { id: 11 }]]));
    expect(loaded.knownInatName(1)).toBe('Robin');
    loaded.rememberInatMatches(new Map([[1, { id: 11, name: 'European robin' }]]));
    expect(loaded.knownInatName(1)).toBe('European robin');
    expect(loaded.knownInatName(2)).toBeNull();
    expect(loaded.knownInatName(3)).toBeUndefined();
    loaded.rememberInatMatches(new Map([[1, { id: 12 }]]));
    expect(loaded.knownInatName(1)).toBeUndefined();
    expect(JSON.parse(store.get('inat-ids-v3')!)).toEqual([
      [2, 22, null],
      [1, 12],
    ]);
  });

  it('reads stored names, ignoring ones that are not text', async () => {
    stubStorage({
      'inat-ids-v3': JSON.stringify([
        [1, 11, 'Robin'],
        [2, 22, null],
        [3, 33, 5],
      ]),
    });
    const loaded = await load();
    expect([1, 2, 3].map(loaded.knownInatName)).toEqual(['Robin', null, undefined]);
    expect(loaded.knownInatId(3)).toBe(33);
  });

  it('keeps the newest 3000', async () => {
    const store = stubStorage();
    const loaded = await load();
    loaded.rememberInatMatches(new Map(Array.from({ length: 3002 }, (_unused, index) => [index, { id: index + 1 }])));
    const kept = JSON.parse(store.get('inat-ids-v3')!) as [number, number][];
    expect(kept).toHaveLength(3000);
    expect(kept[0]).toEqual([2, 3]);
  });

  it('carries on when storage is full', async () => {
    stubStorage();
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
    });
    const loaded = await load();
    loaded.rememberInatMatches(new Map([[1, { id: 11 }]]));
    expect(loaded.knownInatId(1)).toBe(11);
  });
});

describe('iNaturalist common names', () => {
  const base = { records: {}, taxa: {}, voted: {}, gbifInat: {}, gbifAny: {} };
  const species = (...keys: number[]) => keys.map((key) => ({ key, rank: 'SPECIES' as const }));
  const named = (id: number, name: string | null): InatTaxon => ({
    ...taxon(id, 10, [photo(id * 10)]),
    preferred_common_name: name,
  });
  const world = {
    ...base,
    records: recordsFor(1, 2),
    taxa: { 101: named(101, 'european robin'), 102: named(102, null) },
  };
  const inatCalls = (calls: string[]) => calls.filter((call) => url(call).host === 'api.inaturalist.org');

  it('come with the lead photos, from the same requests, in English and tidied', async () => {
    const calls = network(world);
    const heard: ReadonlyMap<number, string>[] = [];
    const { commonNames } = await (
      await load()
    ).leadPhotos(species(1, 2), { onCommonNames: (names) => void heard.push(names) });
    expect(commonNames).toEqual(new Map([[1, 'European robin']]));
    expect(heard).toEqual([commonNames]);
    const taxaCall = url(inatCalls(calls)[0]!);
    expect(taxaCall.searchParams.get('locale')).toBe('en');
    expect(taxaCall.searchParams.get('preferred_place_id')).toBe('6857');
    expect(taxaCall.searchParams.get('fields')).toContain('preferred_common_name');
    expect(inatCalls(calls)).toHaveLength(1);
  });

  it('are remembered, so the next visit names a taxon without a request', async () => {
    const store = stubStorage();
    network(world);
    expect(await (await load()).inatNames(species(1, 2))).toEqual(
      new Map([
        [1, 'European robin'],
        [2, null],
      ]),
    );

    vi.unstubAllGlobals();
    stubStorage(Object.fromEntries(store));
    const calls = network(world);
    expect(await (await load()).inatNames(species(1, 2))).toEqual(
      new Map([
        [1, 'European robin'],
        [2, null],
      ]),
    );
    expect(calls).toEqual([]);
  });

  it('are never searched for by name: a species with no iNaturalist record just has none', async () => {
    const calls = network({ ...base });
    const names = await (await load()).inatNames([{ key: 3, rank: 'SPECIES' }]);
    expect(names).toEqual(new Map([[3, null]]));
    expect(calls.some((call) => url(call).pathname === '/v2/taxa')).toBe(false);
  });
});
