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
  taxa: Record<number, InatTaxon>;
  voted: Record<number, Obs[]>;
  /** GBIF keys whose record lookup fails, iNaturalist taxa whose observations fail, and names whose search fails. */
  fail?: { records?: number[]; voted?: number[]; names?: string[] };
  /** Species GBIF's batched record search (several speciesKeys) leaves out, or `all` to make it fail. */
  crowdedOut?: number[] | 'all';
  /** iNaturalist taxa found by name search. */
  byName?: Record<string, InatTaxon>;
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
  taxon_photos: photos.map((p) => ({ photo: p })),
});
const obs = (id: number, ...photos: InatPhoto[]): Obs => ({
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

function network(w: World) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (raw: string) => {
    calls.push(raw);
    const u = new URL(raw, 'http://site.test');
    const q = u.searchParams;
    if (u.pathname === '/data/names.json') return json({ v: 1, generated: '', names: w.names ?? [] });
    if (u.host === 'api.gbif.org' && u.pathname === '/v1/occurrence/search' && q.has('speciesKey')) {
      if (w.crowdedOut === 'all') return new Response('bad', { status: 400 });
      const out = (w.crowdedOut ?? []) as number[];
      const results = q
        .getAll('speciesKey')
        .map(Number)
        .flatMap((k) =>
          w.records[k] && !out.includes(k) ? [{ key: 1, datasetKey: 'd', speciesKey: k, ...w.records[k] }] : [],
        );
      return json({ results, count: results.length, endOfRecords: true });
    }
    if (u.host === 'api.gbif.org' && u.pathname === '/v1/occurrence/search') {
      const key = Number(q.get('taxonKey'));
      if (q.get('limit') === '1') {
        if (w.fail?.records?.includes(key)) return new Response('bad', { status: 400 });
        const r = w.records[key];
        return json({ results: r ? [{ key: 1, datasetKey: 'd', ...r }] : [], count: 0, endOfRecords: true });
      }
      const results = (q.get('datasetKey') ? w.gbifInat : w.gbifAny)[key] ?? [];
      return json({ results, count: results.length, endOfRecords: true });
    }
    if (u.host === 'api.inaturalist.org' && u.pathname === '/v2/taxa') {
      if (w.fail?.names?.includes(q.get('q')!)) return new Response('bad', { status: 400 });
      const hit = w.byName?.[q.get('q')!];
      return json({ results: hit ? [hit] : [] });
    }
    if (u.host === 'api.inaturalist.org' && u.pathname.startsWith('/v2/taxa/')) {
      const ids = u.pathname.slice('/v2/taxa/'.length).split(',').map(Number);
      return json({ results: ids.flatMap((id) => w.taxa[id] ?? []) });
    }
    if (u.host === 'api.inaturalist.org' && u.pathname === '/v2/observations') {
      if (w.fail?.voted?.includes(Number(q.get('taxon_id')))) return new Response('bad', { status: 400 });
      return json({ results: w.voted[Number(q.get('taxon_id'))] ?? [] });
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
const label = (img: { source?: string; url: string; photoId?: number }) =>
  img.source === 'inat' ? `inat:${img.photoId}` : `gbif:${img.url}`;

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
      voted: { 8021: [obs(10, photo(3)), obs(11, photo(2, null), photo(4))] },
      gbifInat: {
        100: [
          occ(500, 'https://inaturalist-open-data.s3.amazonaws.com/photos/4/original.jpg'),
          occ(501, 'https://x/a.jpg'),
        ],
      },
      gbifAny: { 100: [occ(501, 'https://x/a.jpg'), occ(502, 'https://x/b.jpg')] },
    });
    const m = await load();
    const list = await m.taxonPhotos({ key: 100, rank: 'SPECIES' });
    // Photo 2 is all rights reserved; 3 and 4 are already listed; record 501 already gave a photo.
    expect(list.map(label)).toEqual(['inat:1', 'inat:3', 'inat:4', 'gbif:https://x/a.jpg', 'gbif:https://x/b.jpg']);
    expect(list[0]).toMatchObject({ licence: 'CC-BY', creator: 'Person 1', publisher: 'iNaturalist' });
    expect(list[2]).toMatchObject({ observationUrl: 'https://www.inaturalist.org/observations/11' });
    expect(label((await m.leadPhoto({ key: 100, rank: 'SPECIES' }))!)).toBe('inat:1');
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
      voted: { 12: [obs(1, photo(122))] },
      gbifInat: { 3: [occ(30, 'https://x/3.jpg')], 4: [occ(40, 'https://x/4.jpg')] },
      gbifAny: { 3: [occ(31, 'https://x/3b.jpg')], 5: [occ(50, 'https://x/5.jpg')] },
    };
    network(world);
    const m = await load();
    const taxa = [1, 2, 3, 4, 5, 6].map((key) => ({ key, rank: 'SPECIES' as const }));
    const { images } = await m.leadPhotos(taxa);
    const leads = taxa.map((t) => images.get(t.key));
    expect(leads.map((l) => (l ? label(l) : null))).toEqual([
      'inat:111',
      'inat:122',
      'gbif:https://x/3.jpg',
      'gbif:https://x/4.jpg',
      'gbif:https://x/5.jpg',
      null,
    ]);
    for (const t of taxa) {
      const first = (await m.taxonPhotos(t))[0];
      expect(first && label(first)).toBe(images.get(t.key) && label(images.get(t.key)!));
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
    const m = await load();
    const { images } = await m.leadPhotos([
      { key: 7, rank: 'SPECIES' },
      { key: 8, rank: 'GENUS' },
    ]);
    expect(label(images.get(7)!)).toBe('inat:2');
    expect(label(images.get(8)!)).toBe('inat:3');
  });

  it('caps the list at 20 photos', async () => {
    network({
      records: { 1: { taxonID: '11' } },
      taxa: {
        11: taxon(
          11,
          10,
          Array.from({ length: 12 }, (_, i) => photo(100 + i)),
        ),
      },
      voted: { 11: Array.from({ length: 20 }, (_, i) => obs(i, photo(200 + i))) },
      gbifInat: { 1: [occ(1, 'https://x/1.jpg')] },
      gbifAny: {},
    });
    const m = await load();
    const list = await m.taxonPhotos({ key: 1, rank: 'SPECIES' });
    expect(list).toHaveLength(20);
    expect(list.every((i) => i.source === 'inat')).toBe(true);
  });

  it('batches iNaturalist taxa 30 to a request', async () => {
    const keys = Array.from({ length: 35 }, (_, i) => i + 1);
    const calls = network({
      records: Object.fromEntries(keys.map((k) => [k, { taxonID: String(1000 + k) }])),
      taxa: Object.fromEntries(keys.map((k) => [1000 + k, taxon(1000 + k, 10, [photo(k)])])),
      voted: {},
      gbifInat: {},
      gbifAny: {},
    });
    const m = await load();
    const { images } = await m.leadPhotos(keys.map((key) => ({ key, rank: 'SPECIES' as const })));
    expect(images.size).toBe(35);
    expect(calls.filter((c) => c.includes('api.inaturalist.org'))).toHaveLength(2);
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
    expect(calls.map((c) => new URL(c).pathname)).toEqual(['/v2/taxa/5', '/v2/taxa/5,40']);
  });
});

describe('iNaturalist photo URLs', () => {
  it('picks the smallest iNaturalist size at least as wide as requested', async () => {
    const { thumbnailUrl } = await import('~/lib/gbif/images');
    const img = {
      source: 'inat' as const,
      photoId: 1,
      licence: 'CC-BY' as const,
      url: 'https://inaturalist-open-data.s3.amazonaws.com/photos/1/square.jpeg',
    };
    expect(thumbnailUrl(img, '200x')).toBe('https://inaturalist-open-data.s3.amazonaws.com/photos/1/small.jpeg?x-cors');
    expect(thumbnailUrl(img, '400x')).toBe(
      'https://inaturalist-open-data.s3.amazonaws.com/photos/1/medium.jpeg?x-cors',
    );
    expect(thumbnailUrl(img, '800x')).toBe('https://inaturalist-open-data.s3.amazonaws.com/photos/1/large.jpeg?x-cors');
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

  it('falls back to GBIF photos for unmatched ranks, failed lookups and taxa without an ancestor at the rank', async () => {
    network({
      ...empty,
      records: { 3: { taxonID: '30' }, 4: { taxonID: '40' } },
      taxa: { 30: { id: 30, name: 'No ancestors', rank_level: 5 }, 40: taxon(40, 10, [], [1, 40]) },
      gbifAny: { 1: [occ(11, 'u.jpg')], 2: [occ(12, 'f.jpg')], 3: [occ(13, 's.jpg')], 4: [occ(14, 'g.jpg')] },
      fail: { records: [2] },
    });
    const m = await load();
    const { images } = await m.leadPhotos(
      [
        { key: 1, rank: 'UNRANKED' as never },
        { key: 2, rank: 'SPECIES' },
        { key: 3, rank: 'SPECIES' },
        { key: 4, rank: 'GENUS' },
      ],
      { signal: new AbortController().signal },
    );
    expect([1, 2, 3, 4].map((k) => label(images.get(k)!))).toEqual([
      'gbif:u.jpg',
      'gbif:f.jpg',
      'gbif:s.jpg',
      'gbif:g.jpg',
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
    const m = await load();
    const photos = await m.taxonPhotos({ key: 5, rank: 'SPECIES' }, { signal: new AbortController().signal });
    expect(photos.map(label)).toEqual(['gbif:a.jpg']);
  });

  it('stops once its signal aborts', async () => {
    const calls = network({ ...empty, gbifAny: { 6: [occ(16, 'x.jpg')] } });
    const m = await load();
    const { images } = await m.leadPhotos([{ key: 6, rank: 'SPECIES' }], { signal: AbortSignal.abort() });
    expect(images.size).toBe(0);
    expect(calls).toHaveLength(0);
  });
});

describe('iNaturalist photos', () => {
  it('credit the attribution name, and allow taxa and observations without photos', async () => {
    vi.resetModules();
    const inat = await import('~/lib/photos/inat');
    const p = { ...photo(1), attribution_name: 'Ann' };
    expect(inat.toImage(p)).toMatchObject({ creator: 'Ann' });
    expect(inat.toImage({ ...photo(2), attribution: 'odd' })).not.toHaveProperty('creator');
    expect(inat.curatedImages({ id: 1, name: 'x', rank_level: 10 })).toEqual([]);
    expect(inat.observationImages([{ id: 1 }, { id: 2, photos: [photo(3, null)] }])).toEqual([]);
  });
});

/** localStorage as a Map, readable and writable from a test. */
function stubStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  });
  return store;
}

const speciesTaxa = (...ids: number[]) =>
  Object.fromEntries(ids.map((id) => [id, taxon(id, 10, [photo(id * 10)], [1, id])]));
const recordsFor = (...keys: number[]) => Object.fromEntries(keys.map((k) => [k, { taxonID: String(k + 100) }]));
const url = (raw: string) => new URL(raw, 'http://site.test');
const batched = (calls: string[]) =>
  calls.filter((c) => url(c).pathname === '/v1/occurrence/search' && url(c).searchParams.has('speciesKey'));
const single = (calls: string[]) => calls.filter((c) => url(c).searchParams.get('limit') === '1');

describe('finding iNaturalist taxa cheaply', () => {
  const base = { records: {}, taxa: {}, voted: {}, gbifInat: {}, gbifAny: {} };
  const species = (...keys: number[]) => keys.map((key) => ({ key, rank: 'SPECIES' as const }));

  it('searches GBIF for several species’ iNaturalist records five to a request', async () => {
    const keys = [1, 2, 3, 4, 5, 6, 7];
    const calls = network({ ...base, records: recordsFor(...keys), taxa: speciesTaxa(...keys.map((k) => k + 100)) });
    const m = await load();
    const { images } = await m.leadPhotos(species(...keys));
    expect(batched(calls).map((c) => new URL(c).searchParams.getAll('speciesKey').length)).toEqual([5, 2]);
    expect(single(calls)).toHaveLength(0);
    expect(keys.map((k) => label(images.get(k)!))).toEqual(keys.map((k) => `inat:${(k + 100) * 10}`));
  });

  it('searches one by one for the species a batch left out or failed on', async () => {
    const keys = [1, 2, 3];
    const world = { ...base, records: recordsFor(...keys), taxa: speciesTaxa(101, 102, 103) };
    const calls = network({ ...world, crowdedOut: [2] });
    const { leadPhotos } = await load();
    await leadPhotos(species(...keys));
    expect(single(calls).map((c) => new URL(c).searchParams.get('taxonKey'))).toEqual(['2']);

    vi.unstubAllGlobals();
    const failed = network({ ...world, crowdedOut: 'all' });
    const again = await load();
    const { images } = await again.leadPhotos(species(...keys));
    expect(single(failed)).toHaveLength(3);
    expect(images.size).toBe(3);
  });

  it('does not batch a lone species, or taxa above species', async () => {
    const calls = network({ ...base, records: recordsFor(1, 2), taxa: speciesTaxa(101, 102) });
    const m = await load();
    await m.leadPhotos([{ key: 1, rank: 'SPECIES' }]);
    await m.leadPhotos([
      { key: 2, rank: 'GENUS' },
      { key: 3, rank: 'FAMILY' },
    ]);
    expect(batched(calls)).toHaveLength(0);
    expect(single(calls)).toHaveLength(3);
  });

  it('ignores batch records without a species or a usable iNaturalist ID, and keeps the first per species', async () => {
    const calls = network({
      ...base,
      records: { 1: { taxonID: 'urn:x' }, 2: { taxonID: '102' }, 3: { taxonID: '0' }, 4: {} },
      taxa: speciesTaxa(102),
    });
    const m = await load();
    const { images, names } = await m.leadPhotos(species(1, 2, 3, 4));
    expect(single(calls)).toHaveLength(3);
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
    const m = await load();
    await (await import('~/lib/data/name-index')).loadNameIndex();
    const { images } = await m.leadPhotos([...species(1, 2, 3), { key: 1, rank: 'GENUS' as const }]);
    // Species 3 has no baked ID, and the genus is not a species: both are looked up the old way.
    expect(single(calls).map((c) => new URL(c).searchParams.get('taxonKey'))).toEqual(['3', '1']);
    expect([1, 2].map((k) => label(images.get(k)!))).toEqual(['inat:5010', 'inat:5020']);
  });

  it('does not wait for the name index to load', async () => {
    const calls = network({ ...base, names: [[1, 'S', 'One', null, 9, 501]] });
    const m = await load();
    await m.leadPhotos(species(1));
    expect(calls.some((c) => c.includes('/data/names.json'))).toBe(false);
    expect(single(calls)).toHaveLength(1);
  });

  it('remembers matched IDs across visits, and skips the GBIF search for them', async () => {
    const store = stubStorage();
    const world = { ...base, records: recordsFor(1, 2), taxa: speciesTaxa(101, 102) };
    network(world);
    await (await load()).leadPhotos(species(1, 2));
    expect(JSON.parse(store.get('inat-ids')!)).toEqual([
      [1, 101],
      [2, 102],
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
    const store = stubStorage({ 'inat-ids': JSON.stringify([[1, 999]]) });
    network({ ...base, gbifAny: { 1: [occ(11, 'g.jpg')] } });
    const { images } = await (await load()).leadPhotos(species(1));
    expect(label(images.get(1)!)).toBe('gbif:g.jpg');
    expect(JSON.parse(store.get('inat-ids')!)).toEqual([]);
  });

  it('finds a species GBIF holds no record of by its name', async () => {
    const store = stubStorage();
    const calls = network({
      ...base,
      records: { 2: { taxonID: '102' } },
      taxa: speciesTaxa(102),
      byName: { 'Genus one': { ...taxon(901, 10, [photo(9010)]), name: 'Genus one' } },
      gbifAny: { 3: [occ(13, 'g.jpg')], 4: [occ(14, 'h.jpg')], 5: [occ(15, 'i.jpg')], 6: [occ(16, 'j.jpg')] },
      fail: { names: ['Broken'] },
    });
    const m = await load();
    const { images } = await m.leadPhotos(
      [
        { key: 1, rank: 'SPECIES', name: 'Genus one' },
        { key: 2, rank: 'SPECIES', name: 'Never searched: GBIF had a record' },
        { key: 3, rank: 'SPECIES' },
        { key: 4, rank: 'SPECIES', name: 'Not on iNaturalist' },
        { key: 5, rank: 'SPECIES', name: 'Broken' },
        { key: 6, rank: 'GENUS', name: 'Genus' },
      ],
      { signal: new AbortController().signal },
    );
    const searched = calls
      .filter((c) => new URL(c).pathname === '/v2/taxa')
      .map((c) => new URL(c).searchParams.get('q'));
    expect(searched).toEqual(['Genus one', 'Not on iNaturalist', 'Broken']);
    expect([1, 2, 3, 4, 5, 6].map((k) => label(images.get(k)!))).toEqual([
      'inat:9010',
      'inat:1020',
      'gbif:g.jpg',
      'gbif:h.jpg',
      'gbif:i.jpg',
      'gbif:j.jpg',
    ]);
    expect(JSON.parse(store.get('inat-ids')!)).toEqual([
      [2, 102],
      [1, 901],
    ]);
  });

  it('does not search by name when GBIF’s record matched a taxon that is not at the rank', async () => {
    const calls = network({
      ...base,
      records: { 1: { taxonID: '50' } },
      taxa: { 50: { id: 50, name: 'Orphan', rank_level: 5 } },
      byName: { Found: taxon(902, 10) },
      gbifAny: { 1: [occ(11, 'g.jpg')] },
    });
    const m = await load();
    await m.leadPhotos([{ key: 1, rank: 'SPECIES', name: 'Found' }]);
    expect(calls.some((c) => new URL(c).pathname === '/v2/taxa')).toBe(false);
  });

  it('tells the species page and the previews the same story: both find the photo by name', async () => {
    network({
      ...base,
      byName: { Found: { ...taxon(902, 10, [photo(9020)]), name: 'found' } },
    });
    const m = await load();
    const t = { key: 1, rank: 'SPECIES' as const, name: 'Found' };
    const lead = (await m.leadPhotos([t])).images.get(1);
    expect(label(lead!)).toBe('inat:9020');
    expect((await m.taxonPhotos(t)).map(label)).toEqual(['inat:9020']);
  });

  it('resolves iNaturalist species IDs for a bake, leaving out species with none', async () => {
    network({
      ...base,
      records: recordsFor(1),
      taxa: speciesTaxa(101),
      byName: { Named: { ...taxon(902, 10), name: 'Named' } },
    });
    const m = await load();
    const ids = await m.resolveInatIds([
      { key: 1, rank: 'SPECIES' },
      { key: 2, rank: 'SPECIES', name: 'Named' },
      { key: 3, rank: 'SPECIES', name: 'Nobody' },
    ]);
    expect(ids).toEqual(
      new Map([
        [1, 101],
        [2, 902],
      ]),
    );
  });
});

describe('remembered iNaturalist IDs', () => {
  const load = async () => {
    vi.resetModules();
    return import('~/lib/photos/inat-ids');
  };

  it('works for this visit alone when there is no storage', async () => {
    vi.stubGlobal('localStorage', undefined);
    const m = await load();
    expect(m.knownInatId(1)).toBeUndefined();
    m.rememberInatIds(new Map([[1, 11]]));
    expect(m.knownInatId(1)).toBe(11);
    m.forgetInatId(1);
    expect(m.knownInatId(1)).toBeUndefined();
  });

  it('reads what an earlier visit stored, ignoring what is not an ID pair', async () => {
    stubStorage({
      'inat-ids': JSON.stringify([
        [1, 11],
        ['x', 2],
        [3, 'y'],
        [4, 44],
      ]),
    });
    const m = await load();
    expect([1, 3, 4].map(m.knownInatId)).toEqual([11, undefined, 44]);
  });

  it('starts empty when the stored value is not JSON', async () => {
    stubStorage({ 'inat-ids': '{' });
    expect((await load()).knownInatId(1)).toBeUndefined();
  });

  it('writes only when something changed, newest last', async () => {
    const store = stubStorage();
    const setItem = vi.spyOn(localStorage, 'setItem');
    const m = await load();
    m.rememberInatIds(new Map([[1, 11]]));
    m.rememberInatIds(new Map([[1, 11]]));
    m.rememberInatIds(
      new Map([
        [2, 22],
        [1, 12],
      ]),
    );
    m.forgetInatId(9);
    m.forgetInatId(2);
    expect(setItem).toHaveBeenCalledTimes(3);
    expect(JSON.parse(store.get('inat-ids')!)).toEqual([[1, 12]]);
  });

  it('keeps the newest 3000', async () => {
    const store = stubStorage();
    const m = await load();
    m.rememberInatIds(new Map(Array.from({ length: 3002 }, (_, i) => [i, i + 1])));
    const kept = JSON.parse(store.get('inat-ids')!) as [number, number][];
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
    const m = await load();
    m.rememberInatIds(new Map([[1, 11]]));
    expect(m.knownInatId(1)).toBe(11);
  });
});
