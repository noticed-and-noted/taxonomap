// @vitest-environment jsdom
/** The static name search: its files, how queries pick them, and how the generator makes them. */
import { effectScope } from 'vue';
import { buildLookup, buildPreviewFiles, buildTopFiles, type SearchTaxon } from '~/lib/bake/name-search/build-files';
import { pageFacet } from '~/lib/bake/name-search/facets';
import { settleRows } from '~/lib/bake/name-search/inat-ids';
import { joinCandidates, parseBackboneLine, parseCsvLine } from '~/lib/bake/name-search/sources';
import { fileBudgetProblems, SEARCH_FILE_BUDGET, SITE_FILE_LIMIT } from '~/lib/name-search/budget';
import {
  fileSpan,
  filesForPrefix,
  MAX_FILES_PER_QUERY,
  previewFileFor,
  ROWS_PER_FILE,
  sortKey,
  topFileFor,
  type SearchManifest,
} from '~/lib/name-search/format';
import { bakeablePhotoUrl, bakedPhotoImage } from '~/lib/name-search/preview';
import { planSearch, rankHits, rowsUnderPrefix, topRowsFor } from '~/lib/name-search/provider';
import { GbifNotFoundError } from '~/lib/gbif/errors';
import { thumbnailUrl } from '~/lib/gbif/images';
import { SEARCH_DEBOUNCE_MS } from '~/lib/util/debounce';
import { stubNetwork } from './helpers/network';

const species = (key: number, name: string, commonName?: string, count = 0): SearchTaxon => ({
  key,
  rank: 'S',
  name,
  count,
  ...(commonName && { commonName }),
});

const BLACKBIRD = species(1, 'Turdus merula', 'Common Blackbird', 500);
const ROBIN = species(2, 'Erithacus rubecula', 'European Robin', 900);
const NAMELESS = species(3, 'Turdus maximus', undefined, 10);

/** The same taxa under the same common word, enough to fill `files` files of a lookup. */
const crowd = (files: number, word: string) =>
  Array.from({ length: files * ROWS_PER_FILE }, (_unused, index) =>
    species(1000 + index, `Genus${index} epithet`, `${word} bird${String(index).padStart(6, '0')}`, index),
  );

describe('file lookup', () => {
  const firstKeys = ['apple', 'mango', 'pear', 'plum'];

  it('finds the file a key falls in', () => {
    expect(filesForPrefix(firstKeys, 'melon')).toEqual({ from: 1, to: 1 });
    expect(filesForPrefix(firstKeys, 'zebra')).toEqual({ from: 3, to: 3 });
  });

  it('spans every file a prefix runs through, and the one it can run on from', () => {
    expect(filesForPrefix(firstKeys, 'p')).toEqual({ from: 1, to: 3 });
  });

  it('stays on the first file for a key before them all', () => {
    expect(filesForPrefix(firstKeys, 'aardvark')).toEqual({ from: 0, to: 0 });
  });

  it('finds the preview file holding a key', () => {
    expect(previewFileFor([10, 20, 30], 25)).toBe(1);
    expect(previewFileFor([10, 20, 30], 30)).toBe(2);
    expect(previewFileFor([10, 20, 30], 5)).toBe(-1);
  });

  it('finds the top-taxa file holding a prefix', () => {
    expect(topFileFor(['abc', 'mno'], 'mno')).toBe(1);
    expect(topFileFor(['abc', 'mno'], 'mnz')).toBe(1);
    expect(topFileFor(['abc', 'mno'], 'lmn')).toBe(0);
  });
});

describe('building lookups', () => {
  it('stores columns, not rows', () => {
    const { files } = buildLookup([BLACKBIRD, NAMELESS], 'first');
    expect(files[0]).toEqual({
      names: ['Turdus maximus', 'Turdus merula'],
      commons: ['', 'Common Blackbird'],
      keys: [3, 1],
      ranks: 'SS',
      counts: [10, 500],
    });
  });

  it('files a scientific name under its second word, so "merula" finds Turdus merula', () => {
    const { files, firstKeys } = buildLookup([BLACKBIRD, ROBIN], 'second');
    expect(firstKeys).toEqual(['m']);
    expect(rowsUnderPrefix(files[0]!, 'second', 'merula').map((hit) => hit.key)).toEqual([1]);
  });

  it('leaves one-word names out of the second-word lookup', () => {
    expect(buildLookup([species(4, 'Turdus')], 'second').files).toEqual([]);
  });

  it('files a common name under every word, so "blackbird" finds Common Blackbird', () => {
    const { files } = buildLookup([BLACKBIRD], 'common');
    expect(rowsUnderPrefix(files[0]!, 'common', 'blackbird').map((hit) => hit.commonName)).toEqual([
      'Common Blackbird',
    ]);
    expect(rowsUnderPrefix(files[0]!, 'common', 'common bl').map((hit) => hit.commonName)).toEqual([
      'Common Blackbird',
    ]);
  });

  it('gives no common-lookup row to a taxon without a common name', () => {
    expect(buildLookup([NAMELESS], 'common').files).toEqual([]);
  });

  it('cuts sorted rows into evenly sized files and lists each one first key', () => {
    const { files, firstKeys } = buildLookup(crowd(2, 'grey'), 'first');
    expect(files.map((file) => file.keys.length)).toEqual([ROWS_PER_FILE, ROWS_PER_FILE]);
    expect(firstKeys).toEqual([...firstKeys].sort());
    // A boundary is no later than its file's first key, and later than the last key of the file before.
    expect(sortKey(files[1]!, 'first', 0).startsWith(firstKeys[1]!)).toBe(true);
    expect(sortKey(files[0]!, 'first', ROWS_PER_FILE - 1) < firstKeys[1]!).toBe(true);
  });
});

describe('planning a search', () => {
  const manifestFrom = (taxa: readonly SearchTaxon[]): SearchManifest => {
    const lookups = (['first', 'second', 'common'] as const).map((lookup) => buildLookup(taxa, lookup));
    return {
      first: lookups[0]!.firstKeys,
      second: lookups[1]!.firstKeys,
      common: lookups[2]!.firstKeys,
      top: buildTopFiles(lookups).firstPrefixes,
      generated: '',
    };
  };

  it('reads files for a specific query, with no top-taxa list', () => {
    const plan = planSearch(manifestFrom([BLACKBIRD, ROBIN, ...crowd(1, 'grey')]), 'blackbird');
    expect(plan.topFile).toBeUndefined();
    expect(plan.reads.map((read) => read.lookup)).toEqual(['first', 'second', 'common']);
  });

  it('never fans out: a wide prefix goes to the top-taxa list instead', () => {
    const manifest = manifestFrom(crowd(5, 'grey'));
    const plan = planSearch(manifest, 'gre');
    expect(plan.topFile).toBe(0);
    expect(plan.reads.some((read) => read.lookup === 'common' && read.prefix === 'gre')).toBe(false);
    for (const read of plan.reads) expect(read.files.length).toBeLessThanOrEqual(MAX_FILES_PER_QUERY);
  });

  it('looks a multi-word query up by phrase and by its narrowest word', () => {
    const plan = planSearch(manifestFrom([...crowd(5, 'grey'), BLACKBIRD]), 'grey common');
    expect(plan.reads.filter((read) => read.lookup === 'common').map((read) => read.prefix)).toContain('common');
  });
});

describe('top-taxa lists', () => {
  const lookupsOf = (taxa: readonly SearchTaxon[]) =>
    (['first', 'second', 'common'] as const).map((lookup) => buildLookup(taxa, lookup));

  it('ranks a too-wide prefix by record count, most recorded first', () => {
    const { files } = buildTopFiles(lookupsOf(crowd(5, 'grey')));
    const hits = topRowsFor(files[0]!, 'gre');
    expect(hits).toHaveLength(20);
    expect(hits[0]!.count).toBe(5 * ROWS_PER_FILE - 1);
    expect(hits.map((hit) => hit.count)).toEqual(
      [...hits.map((hit) => hit.count)].sort((left, right) => right! - left!),
    );
  });

  it('has a list for every prefix a lookup says is too wide', () => {
    const lookups = lookupsOf(crowd(5, 'grey'));
    const { files } = buildTopFiles(lookups);
    const prefixes = files.flatMap((file) => file.prefixes);
    for (const prefix of ['gre', 'grey', 'grey b', 'grey bird0000']) {
      const isWide = fileSpan(filesForPrefix(lookups[2]!.firstKeys, prefix)) > MAX_FILES_PER_QUERY;
      expect(prefixes.includes(prefix)).toBe(isWide);
    }
  });

  it('answers nothing for a prefix without a list', () => {
    const { files } = buildTopFiles(lookupsOf(crowd(5, 'grey')));
    expect(topRowsFor(files[0]!, 'zzz')).toEqual([]);
  });

  it('keeps every prefix row together when grouping into files', () => {
    const { files, firstPrefixes } = buildTopFiles(lookupsOf(crowd(5, 'grey')));
    expect(firstPrefixes).toEqual(files.map((file) => file.prefixes[0]));
    for (const file of files) expect(file.starts).toHaveLength(file.prefixes.length);
  });
});

describe('ranking', () => {
  const hit = (key: number, scientificName: string, commonName?: string, count?: number) => ({
    key,
    scientificName,
    rank: 'SPECIES' as const,
    source: 'static' as const,
    ...(commonName && { commonName }),
    ...(count && { count }),
  });

  it('puts a better match first, then more records', () => {
    const hits = [
      hit(1, 'Aaa aaa', 'Blue Robin', 1000),
      hit(2, 'Bbb bbb', 'Robin', 1),
      hit(3, 'Ccc ccc', 'Robin Hood', 5),
    ];
    expect(rankHits(hits, 'robin').map((one) => one.key)).toEqual([2, 3, 1]);
  });

  it('keeps one hit per taxon and drops what does not match', () => {
    const hits = [
      hit(1, 'Turdus merula', 'Common Blackbird'),
      hit(1, 'Turdus merula', 'Common Blackbird'),
      hit(2, 'Xxx yyy'),
    ];
    expect(rankHits(hits, 'merula').map((one) => one.key)).toEqual([1]);
  });
});

describe('preview rows', () => {
  const photo = { photoId: 42, extension: 'jpg', licence: 'cc-by', creator: 'Ann Smith' };

  it('builds the same image toImage makes from iNaturalist', () => {
    expect(bakedPhotoImage(photo)).toEqual({
      source: 'inat',
      photoId: 42,
      url: 'https://inaturalist-open-data.s3.amazonaws.com/photos/42/square.jpg',
      licence: 'CC-BY',
      publisher: 'iNaturalist',
      creator: 'Ann Smith',
    });
  });

  it('keeps an unusual extension exactly as given', () => {
    const image = bakedPhotoImage({ ...photo, extension: 'JPG' })!;
    expect(image.url).toMatch(/square\.JPG$/);
    expect(thumbnailUrl(image, '200x')).toMatch(/\/small\.JPG\?x-cors$/);
  });

  it('handles an empty extension as the API URL does', () => {
    const url = 'https://inaturalist-open-data.s3.amazonaws.com/photos/42/square';
    expect(bakeablePhotoUrl(url, 42)).toEqual({ photoId: 42, extension: '' });
    expect(bakedPhotoImage({ ...photo, extension: '' })!.url).toBe(url);
  });

  it('rejects a closed licence', () => {
    expect(bakedPhotoImage({ ...photo, licence: 'all-rights-reserved' })).toBeNull();
  });

  it('leaves out the creator when there is none', () => {
    expect(bakedPhotoImage({ ...photo, creator: '' })).not.toHaveProperty('creator');
  });

  it('will not bake a URL it could not rebuild', () => {
    expect(bakeablePhotoUrl('https://static.inaturalist.org/photos/42/square.jpg', 42)).toBeNull();
    expect(bakeablePhotoUrl('https://inaturalist-open-data.s3.amazonaws.com/photos/42/medium.jpg', 42)).toBeNull();
    expect(bakeablePhotoUrl('https://inaturalist-open-data.s3.amazonaws.com/photos/43/square.jpg', 42)).toBeNull();
  });

  it('sorts rows by key and marks a row with no photo with ID 0', () => {
    const { files, firstKeys } = buildPreviewFiles(
      new Map([
        [20, { inatId: 200 }],
        [10, { inatId: 100, photo }],
      ]),
    );
    expect(firstKeys).toEqual([10]);
    expect(files[0]).toEqual({
      keys: [10, 20],
      inatIds: [100, 200],
      photoIds: [42, 0],
      extensions: ['jpg', ''],
      licences: ['cc-by', ''],
      creators: ['Ann Smith', ''],
    });
  });
});

describe('the SQL result', () => {
  it('settles a species with one ID', () => {
    expect(settleRows(['1\t100\t5']).single).toEqual(new Map([[1, 100]]));
  });

  it('leaves a species with several IDs to the batch lookup', () => {
    const { single, several } = settleRows(['1\t100\t5', '1\t101\t2']);
    expect(single.size).toBe(0);
    expect(several).toEqual(new Set([1]));
  });

  it('counts the same ID twice as one', () => {
    expect(settleRows(['1\t100\t5', '1\t100\t2']).single.get(1)).toBe(100);
  });

  it('filters out null and non-numeric IDs', () => {
    const { single, several, invalidRows } = settleRows(['1\t\\N\t5', '2\t\t1', '3\thttps://x/4\t9', '4\t40\t1']);
    expect(invalidRows).toBe(3);
    expect(single).toEqual(new Map([[4, 40]]));
    expect(several.size).toBe(0);
  });

  it('is settled by a valid ID even beside an invalid one', () => {
    expect(settleRows(['1\t\\N\t5', '1\t100\t1']).single.get(1)).toBe(100);
  });

  it('skips a header row', () => {
    expect(settleRows(['specieskey\ttaxonid\tcount']).invalidRows).toBe(0);
  });
});

describe('the file budget', () => {
  const files = (count: number, prefix: string) =>
    Array.from({ length: count }, (_unused, index) => ({ path: `${prefix}/${index}.json`, bytes: 10 }));

  it('passes a site within its limits', () => {
    expect(fileBudgetProblems(files(100, '/search-data'))).toEqual([]);
  });

  it('fails too many search files, leaving room for species pages', () => {
    expect(fileBudgetProblems(files(SEARCH_FILE_BUDGET + 1, '/search-data'))).toHaveLength(1);
    expect(SEARCH_FILE_BUDGET).toBeLessThan(SITE_FILE_LIMIT);
  });

  it('fails too many files in the site', () => {
    expect(fileBudgetProblems(files(SITE_FILE_LIMIT + 1, '/species'))).toHaveLength(1);
  });

  it('fails a file over the size limit', () => {
    expect(fileBudgetProblems([{ path: '/huge.bin', bytes: 26 * 1024 * 1024 }])).toHaveLength(1);
  });
});

describe('reading the downloads', () => {
  const backboneLine = (overrides: Record<number, string>) => {
    const fields = Array.from({ length: 20 }, () => '\\N');
    for (const [column, value] of Object.entries(overrides)) fields[Number(column)] = value;
    return fields.join('\t');
  };

  it('keeps an accepted species', () => {
    const line = backboneLine({
      0: '7',
      4: 'ACCEPTED',
      5: 'SPECIES',
      10: '1',
      18: 'Turdus merula L.',
      19: 'Turdus merula',
    });
    expect(parseBackboneLine(line)).toEqual({ key: 7, rank: 'S', name: 'Turdus merula', kingdomKey: 1 });
  });

  it('falls back to the scientific name when the canonical name is null', () => {
    const line = backboneLine({ 0: '7', 4: 'ACCEPTED', 5: 'GENUS', 18: 'AHJD-like viruses' });
    expect(parseBackboneLine(line)?.name).toBe('AHJD-like viruses');
  });

  it.each([
    ['a synonym', { 0: '7', 4: 'SYNONYM', 5: 'SPECIES', 19: 'Turdus merula' }],
    ['a BOLD placeholder', { 0: '7', 4: 'ACCEPTED', 5: 'SPECIES', 18: 'BOLD:AAA0001' }],
    ['an SH placeholder', { 0: '7', 4: 'ACCEPTED', 5: 'SPECIES', 18: 'SH1161990.09FU' }],
    ['an unranked name', { 0: '7', 4: 'ACCEPTED', 5: 'UNRANKED', 19: 'Something' }],
    ['a non-numeric key', { 0: 'x', 4: 'ACCEPTED', 5: 'SPECIES', 19: 'Turdus merula' }],
  ])('drops %s', (_label, overrides) => {
    expect(parseBackboneLine(backboneLine(overrides))).toBeNull();
  });

  it('keeps a name that only starts like a placeholder', () => {
    const line = backboneLine({ 0: '7', 4: 'ACCEPTED', 5: 'GENUS', 19: 'Shorea' });
    expect(parseBackboneLine(line)?.name).toBe('Shorea');
  });

  it('parses quoted CSV fields', () => {
    expect(parseCsvLine('1,"a, b","say ""hi""",')).toEqual(['1', 'a, b', 'say "hi"', '']);
  });

  it('uses kingdom to separate homonyms', () => {
    const backbone = [
      { key: 1, rank: 'K' as const, name: 'Animalia', kingdomKey: 1 },
      { key: 6, rank: 'K' as const, name: 'Plantae', kingdomKey: 6 },
      { key: 10, rank: 'S' as const, name: 'Morus alba', kingdomKey: 6 },
      { key: 11, rank: 'S' as const, name: 'Solo name', kingdomKey: 1 },
      { key: 12, rank: 'S' as const, name: 'No records', kingdomKey: 1 },
    ];
    const named = new Map([
      [
        'Morus alba',
        [
          { id: 100, kingdom: 'Animalia' },
          { id: 200, kingdom: 'Plantae' },
        ],
      ],
      ['Solo name', [{ id: 300, kingdom: 'Protozoa' }]],
      ['No records', [{ id: 400, kingdom: 'Animalia' }]],
    ]);
    expect(joinCandidates(backbone, new Set([10, 11]), named)).toEqual(
      new Map([
        [10, 200],
        [11, 300],
      ]),
    );
  });
});

describe('the three preview states', () => {
  const LOOKUP = [10];
  const hitFor = (key: number) => ({ key, rank: 'SPECIES' as const, source: 'static' as const });
  const COLUMNS = {
    keys: [10, 11],
    inatIds: [100, 110],
    photoIds: [42, 0],
    extensions: ['jpeg', ''],
    licences: ['cc-by-nc', ''],
    creators: ['Ann Smith', ''],
  };

  const loadPreview = async (network: (url: URL) => unknown) => {
    vi.resetModules();
    const calls = stubNetwork(network);
    const { bakedPreview } = await import('~/lib/name-search/preview');
    return { bakedPreview, calls };
  };

  const files = (url: URL) => {
    if (url.pathname === '/search-data/preview.json') return LOOKUP;
    if (url.pathname === '/search-data/preview/0.json') return COLUMNS;
    return undefined;
  };

  afterEach(() => vi.unstubAllGlobals());

  it('shows a baked photo, asking only our own origin', async () => {
    const { bakedPreview, calls } = await loadPreview(files);
    const preview = await bakedPreview(hitFor(10));
    expect(preview).toMatchObject({
      state: 'photo',
      image: { photoId: 42, licence: 'CC-BY-NC', creator: 'Ann Smith' },
    });
    expect(calls.every((url) => url.hostname === 'site.test')).toBe(true);
  });

  it('hands a named species with no open curated photo to the live path, with its ID', async () => {
    const { bakedPreview } = await loadPreview(files);
    expect(await bakedPreview(hitFor(11))).toEqual({ state: 'live', inatId: 110 });
  });

  it('shows nothing for a taxon with no row, in or before the files', async () => {
    const { bakedPreview, calls } = await loadPreview(files);
    expect(await bakedPreview(hitFor(12))).toEqual({ state: 'nothing' });
    expect(await bakedPreview(hitFor(5))).toEqual({ state: 'nothing' });
    expect(calls.every((url) => url.hostname === 'site.test')).toBe(true);
  });

  it('shows nothing when a file fails, and tries again next time', async () => {
    let isDown = true;
    const { bakedPreview } = await loadPreview((url) => (isDown ? new Response('', { status: 500 }) : files(url)));
    expect(await bakedPreview(hitFor(10))).toEqual({ state: 'nothing' });
    isDown = false;
    expect((await bakedPreview(hitFor(10))).state).toBe('photo');
  });

  it('skips the GBIF search for a known ID, asking iNaturalist alone', async () => {
    vi.resetModules();
    const calls = stubNetwork((url) => (url.pathname.startsWith('/v2/') ? { results: [] } : undefined));
    const { rememberInatMatches } = await import('~/lib/photos/inat-ids');
    const { leadPhotos } = await import('~/lib/photos/taxon-photos');
    rememberInatMatches(new Map([[11, { id: 110 }]]));
    await leadPhotos([{ key: 11, rank: 'SPECIES' }]);
    expect(calls.some((url) => url.pathname === '/v2/taxa/110')).toBe(true);
    expect(
      calls.some(
        (url) =>
          url.pathname === '/v1/occurrence/search' &&
          url.searchParams.has('datasetKey') &&
          !url.searchParams.has('mediaType'),
      ),
    ).toBe(false);
  });

  it('keeps a higher rank from the baked index with no row on the live path', async () => {
    const { bakedPreview } = await loadPreview(files);
    expect(await bakedPreview({ key: 12, rank: 'FAMILY', source: 'index' })).toEqual({ state: 'live' });
    expect(await bakedPreview({ key: 12, rank: 'GENUS', source: 'static' })).toEqual({ state: 'nothing' });
    expect(await bakedPreview({ key: 12, rank: 'SPECIES', source: 'index' })).toEqual({ state: 'nothing' });
  });

  it('shows a baked photo for a higher rank that has one', async () => {
    const { bakedPreview } = await loadPreview(files);
    expect((await bakedPreview({ key: 10, rank: 'FAMILY', source: 'index' })).state).toBe('photo');
  });
});

describe('searching with the switch on', () => {
  const taxa = [BLACKBIRD, ROBIN, NAMELESS];

  /** The generator's real files, served by a fake origin. Anything else counts as a stray request. */
  const staticSite = (isDown = false) => {
    const lookups = (['first', 'second', 'common'] as const).map((lookup) => buildLookup(taxa, lookup));
    const site = new Map<string, unknown>([
      ['/data/names.json', { v: 1, generated: '', names: [] }],
      [
        '/search-data/manifest.json',
        {
          first: lookups[0]!.firstKeys,
          second: lookups[1]!.firstKeys,
          common: lookups[2]!.firstKeys,
          top: [],
          generated: '',
        },
      ],
    ]);
    (['first', 'second', 'common'] as const).forEach((lookup, index) =>
      site.set(`/search-data/${lookup}/0.json`, lookups[index]!.files[0]),
    );
    return stubNetwork((url) => {
      if (isDown && url.pathname.startsWith('/search-data/')) return new Response('', { status: 500 });
      return site.get(url.pathname) ?? new Response('', { status: 599 });
    });
  };

  const searchFor = async (text: string) => {
    vi.resetModules();
    vi.stubEnv('PUBLIC_NAME_SEARCH', 'static');
    const { useNameSearch } = await import('~/composables/useNameSearch');
    const scope = effectScope();
    const search = scope.run(() => useNameSearch({ max: 8 }))!;
    search.search(text);
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    await vi.waitFor(() => expect(search.loading.value).toBe(false));
    return { search, stop: () => scope.stop() };
  };

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it.each([
    ['blackbird', 1],
    ['merula', 1],
    ['common bl', 1],
    ['turdus m', 1],
    ['robin', 2],
  ])('finds %s from the files, asking no API', async (text, key) => {
    const calls = staticSite();
    const { search, stop } = await searchFor(text);
    expect(search.hits.value.map((hit) => hit.key)).toContain(key);
    expect(search.failed.value).toBe(false);
    expect(calls.every((url) => url.hostname === 'site.test')).toBe(true);
    expect(search.hits.value.every((hit) => !hit.isNamePending)).toBe(true);
    stop();
  });

  it('finds nothing for a query that matches no name', async () => {
    staticSite();
    const { search, stop } = await searchFor('zzzqqq');
    expect(search.hits.value).toEqual([]);
    expect(search.failed.value).toBe(false);
    stop();
  });

  it('shows the failed state rather than going live when a file fails', async () => {
    const calls = staticSite(true);
    const { search, stop } = await searchFor('blackbird');
    expect(search.failed.value).toBe(true);
    expect(calls.every((url) => url.hostname === 'site.test')).toBe(true);
    stop();
  });
});

describe('paging the species facet', () => {
  const rows = (size: number) => Array.from({ length: size }, (_unused, at) => ({ name: String(at), count: 5 }));
  const notFound = () => new GbifNotFoundError('url', 404, '');

  it('reports a list that ended', async () => {
    const { counts, hitCeiling } = await pageFacet(async () => rows(3));
    expect(counts.size).toBe(3);
    expect(hitCeiling).toBe(false);
  });

  it('treats a lasting 404 on a deep page as the ceiling', async () => {
    const { counts, hitCeiling } = await pageFacet(async (offset) => {
      if (offset === 0) return rows(100_000);
      throw notFound();
    });
    expect(counts.size).toBe(100_000);
    expect(hitCeiling).toBe(true);
  });

  it('fails on a 404 for the first page, which is no ceiling', async () => {
    await expect(pageFacet(() => Promise.reject(notFound()))).rejects.toThrow();
  });

  it('fails on any other error, so a partial list cannot pass for a whole one', async () => {
    const fetchPage = async (offset: number) => {
      if (offset === 0) return rows(100_000);
      throw new Error('down');
    };
    await expect(pageFacet(fetchPage)).rejects.toThrow('down');
  });
});
