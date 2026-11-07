/** The iNaturalist token bucket: requests cancelled while queued give up their turn. */
import { throttle } from '~/lib/photos/inat';
import { json, stubNetwork } from './helpers/network';

afterEach(() => vi.useRealTimers());

describe('throttle', () => {
  it('spends no token on a request cancelled while it waited', async () => {
    vi.useFakeTimers();
    const sent: string[] = [];
    const throttled = throttle(
      async (url) => (sent.push(url), new Response('{}')),
      1,
      1,
      () => Date.now(),
    );

    await throttled('a');
    const controller = new AbortController();
    const stale = throttled('stale', { signal: controller.signal });
    const fresh = throttled('fresh');
    controller.abort();
    await expect(stale).rejects.toThrow();

    // The stale request's wait ends on abort, so the fresh one waits one interval, not two.
    await vi.advanceTimersByTimeAsync(1000);
    await fresh;
    expect(sent).toEqual(['a', 'fresh']);
  });

  it('gives up its turn when cancelled during its wait', async () => {
    vi.useFakeTimers();
    const sent: string[] = [];
    const throttled = throttle(
      async (url) => (sent.push(url), new Response('{}')),
      1,
      1,
      () => Date.now(),
    );
    await throttled('a');
    const controller = new AbortController();
    const stale = throttled('stale', { signal: controller.signal });
    // Let its turn start and begin waiting for a token.
    await vi.advanceTimersByTimeAsync(10);
    controller.abort();
    await expect(stale).rejects.toThrow();
    const fresh = throttled('fresh');
    await vi.advanceTimersByTimeAsync(1000);
    await fresh;
    expect(sent).toEqual(['a', 'fresh']);
  });
});

describe('getTaxonNames', () => {
  it('asks for many taxa in one request, sorted, with only the name fields', async () => {
    const calls = stubNetwork(() => ({
      results: [
        { id: 5, name: 'Five', rank_level: 10 },
        { id: 40, name: 'Forty', rank_level: 10 },
      ],
    }));
    vi.resetModules();
    const { getTaxonNames } = await import('~/lib/photos/inat');
    const taxa = await getTaxonNames([40, 5, 5]);
    expect([...taxa.keys()]).toEqual([5, 40]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.pathname).toBe('/v2/taxa');
    expect(calls[0]?.searchParams.get('id')).toBe('5,40');
    expect(calls[0]?.searchParams.get('per_page')).toBe('2');
    expect(calls[0]?.searchParams.get('fields')).not.toContain('taxon_photos');
  });
});

describe('getTaxonNames with a replaced taxon', () => {
  it('fetches the taxa the list hides by path', async () => {
    const calls = stubNetwork((url) => {
      if (url.pathname === '/v2/taxa') return { results: [{ id: 5, name: 'Five', rank_level: 10 }] };
      return { results: [{ id: 40, name: 'Forty', rank_level: 10, preferred_common_name: 'Old name' }] };
    });
    vi.resetModules();
    const { getTaxonNames } = await import('~/lib/photos/inat');
    const taxa = await getTaxonNames([40, 5]);
    expect([...taxa.keys()].sort()).toEqual([40, 5]);
    expect(calls.map((call) => call.pathname)).toEqual(['/v2/taxa', '/v2/taxa/40']);
  });

  it('keeps the listed taxa when fetching a replaced one fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stubNetwork((url) =>
      url.pathname === '/v2/taxa' ? { results: [{ id: 5, name: 'Five', rank_level: 10 }] } : json({}, 400),
    );
    vi.resetModules();
    const { getTaxonNames } = await import('~/lib/photos/inat');
    const taxa = await getTaxonNames([40, 5]);
    expect([...taxa.keys()]).toEqual([5]);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});

describe('iNaturalist sounds and places', () => {
  afterEach(() => vi.unstubAllGlobals());

  async function inat() {
    vi.resetModules();
    return import('~/lib/photos/inat');
  }

  it('asks for research-grade observations with openly licensed sounds', async () => {
    const calls = stubNetwork(() => ({ results: [{ id: 1, sounds: [] }] }));
    const { soundObservations } = await inat();
    expect(await soundObservations(4772)).toEqual([{ id: 1, sounds: [] }]);
    await soundObservations(4772, new AbortController().signal);
    expect(calls[0]?.pathname).toBe('/v2/observations');
    expect(calls[0]?.searchParams.get('taxon_id')).toBe('4772');
    expect(calls[0]?.searchParams.get('quality_grade')).toBe('research');
  });

  it('names the places that are countries', async () => {
    const calls = stubNetwork(() => ({
      results: [
        { id: 6774, name: 'Spain', admin_level: 0 },
        { id: 97391, name: 'Europe', admin_level: null },
      ],
    }));
    const { countryNames } = await inat();
    expect(await countryNames([6774, 97391])).toEqual(new Map([[6774, 'Spain']]));
    await countryNames([6774], new AbortController().signal);
    expect(calls[0]?.pathname).toBe('/v2/places/6774,97391');
  });

  it('finds no sound on an observation without any', async () => {
    const { observationSound } = await inat();
    expect(observationSound({ id: 1 })).toBeNull();
  });

  it('lets the build wrap the throttled fetch', async () => {
    stubNetwork(() => ({ results: [] }));
    const { configureInat, countryNames } = await inat();
    const wrapped: string[] = [];
    configureInat((throttled) => (url, requestInit) => (wrapped.push(url), throttled(url, requestInit)));
    await countryNames([1]);
    expect(wrapped).toHaveLength(1);
  });
});

describe('iNaturalist for the build', () => {
  it('puts the disk cache in .cache/inat in front of the client', async () => {
    vi.resetModules();
    const withDiskCache = vi.fn((transport: unknown) => transport);
    vi.doMock('~/lib/gbif/node-transport', () => ({ withDiskCache }));
    const server = await import('~/lib/photos/inat-server');
    expect(withDiskCache).toHaveBeenCalledWith(expect.any(Function), {
      cacheDir: expect.stringMatching(/\.cache[/\\]inat$/),
    });
    expect(server.getTaxonNames).toBeTypeOf('function');
    vi.doUnmock('~/lib/gbif/node-transport');
  });
});
