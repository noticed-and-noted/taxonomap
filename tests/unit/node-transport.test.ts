import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeTransport, userAgent } from '~/lib/gbif/node-transport';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'gbif-cache-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function fakeFetch(status = 200) {
  const seen: { url: string; ua: string | null }[] = [];
  let active = 0;
  let peak = 0;
  const fetchImpl = (async (url: string, requestInit?: RequestInit) => {
    active++;
    peak = Math.max(peak, active);
    seen.push({ url, ua: new Headers(requestInit?.headers).get('user-agent') });
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    return new Response(JSON.stringify({ url }), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { impl: fetchImpl, seen, peak: () => peak };
}

describe('node transport', () => {
  it('sends the User-Agent and caches responses on disk', async () => {
    const fetcher = fakeFetch();
    const transport = createNodeTransport({
      cacheDir: dir,
      fetchImpl: fetcher.impl,
      contact: 'me@example.org',
      refresh: false,
    });
    const first = await transport('https://api.test/v1/a');
    expect(await first.json()).toEqual({ url: 'https://api.test/v1/a' });
    const second = await transport('https://api.test/v1/a');
    expect(second.headers.get('x-cache')).toBe('disk');
    expect(fetcher.seen).toHaveLength(1);
    expect(fetcher.seen[0]?.ua).toMatch(/^Taxonomap\/[\d.]+ \(contact: me@example\.org\)$/);
  });

  it('caps concurrency at 5', async () => {
    const fetcher = fakeFetch();
    const transport = createNodeTransport({ cacheDir: dir, fetchImpl: fetcher.impl, refresh: true });
    await Promise.all(Array.from({ length: 20 }, (_unused, index) => transport(`https://api.test/v1/${index}`)));
    expect(fetcher.peak()).toBe(5);
  });

  it('does not cache a GraphQL answer with errors, which GBIF sends as a 200', async () => {
    const seen: string[] = [];
    const fetchImpl = (async (url: string) => {
      seen.push(url);
      return new Response(JSON.stringify({ data: { occurrenceSearch: null }, errors: [{ message: '400' }] }));
    }) as typeof fetch;
    const transport = createNodeTransport({ cacheDir: dir, fetchImpl, refresh: false });
    await transport('https://graphql.test/graphql?query=x');
    await transport('https://graphql.test/graphql?query=x');
    expect(seen).toHaveLength(2);
  });

  it('does not cache throttled responses', async () => {
    const fetcher = fakeFetch(429);
    const transport = createNodeTransport({ cacheDir: dir, fetchImpl: fetcher.impl, refresh: false });
    await transport('https://api.test/v1/x');
    await transport('https://api.test/v1/x');
    expect(fetcher.seen).toHaveLength(2);
  });

  it('builds a user agent string', () => {
    expect(userAgent('x@y.z')).toContain('(contact: x@y.z)');
  });
});

describe('node transport options', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('takes the version pnpm passes in when there is one', () => {
    vi.stubEnv('npm_package_version', '9.9.9');
    expect(userAgent('a@b.c')).toBe('Taxonomap/9.9.9 (contact: a@b.c)');
  });

  it('reads the version from package.json, falling back to 0.0.0', async () => {
    vi.stubEnv('npm_package_version', '');
    vi.stubEnv('GBIF_CONTACT_EMAIL', '');
    expect(userAgent()).toMatch(/^Taxonomap\/\d+\.\d+\.\d+ \(contact: unset\)$/);
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(dir);
    expect(userAgent('a@b.c')).toBe('Taxonomap/0.0.0 (contact: a@b.c)');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(dir, 'package.json'), '{}');
    expect(userAgent('a@b.c')).toBe('Taxonomap/0.0.0 (contact: a@b.c)');
    cwd.mockRestore();
  });

  it('takes its defaults from the environment', async () => {
    vi.spyOn(process, 'cwd').mockReturnValue(dir);
    vi.stubEnv('GBIF_CACHE_TTL_HOURS', '0');
    vi.stubEnv('GBIF_CACHE_REFRESH', '');
    const fetcher = fakeFetch();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(fetcher.impl);
    const transport = createNodeTransport();
    await transport('https://api.test/v1/a');
    // A zero TTL makes the disk copy stale at once.
    await transport('https://api.test/v1/a');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('passes the signal on, and keeps a content type the response leaves out', async () => {
    const seen: (AbortSignal | undefined)[] = [];
    const fetchImpl = (async (_url: string, requestInit?: RequestInit) => {
      seen.push(requestInit?.signal ?? undefined);
      const response = new Response('{"a":1}', { status: 200 });
      response.headers.delete('content-type');
      return response;
    }) as typeof fetch;
    const transport = createNodeTransport({ cacheDir: dir, fetchImpl, refresh: true });
    const controller = new AbortController();
    const response = await transport('https://api.test/v1/a', { signal: controller.signal });
    expect(response.headers.get('content-type')).toBe('application/json');
    await transport('https://api.test/v1/b');
    expect(seen).toEqual([controller.signal, undefined]);
  });

  it('pauses every queued request after a Retry-After', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] });
    const times: number[] = [];
    const fetchImpl = (async () => {
      times.push(Date.now());
      return new Response('{}', { status: times.length === 1 ? 429 : 200, headers: { 'retry-after': '1' } });
    }) as typeof fetch;
    const transport = createNodeTransport({ cacheDir: dir, fetchImpl, refresh: true, concurrency: 1 });
    await transport('https://api.test/v1/a');
    const second = transport('https://api.test/v1/b');
    await vi.advanceTimersByTimeAsync(1000);
    await second;
    expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(1000);
  });
});
