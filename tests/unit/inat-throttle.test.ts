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
