/**
 * Taxon photos: the ordered list (curated → most-voted → GBIF), the lead
 * photo always being that list's first photo through every fallback, and
 * matching GBIF taxa to iNaturalist (including via ancestors).
 */
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
  /** GBIF keys whose record lookup fails, and iNaturalist taxa whose observations fail. */
  fail?: { records?: number[]; voted?: number[] };
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
    const u = new URL(raw);
    const q = u.searchParams;
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
    expect(thumbnailUrl(img, '400x')).toBe('https://inaturalist-open-data.s3.amazonaws.com/photos/1/medium.jpeg?x-cors');
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
