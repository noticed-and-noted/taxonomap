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
  const impl = (async (url: string, init?: RequestInit) => {
    active++;
    peak = Math.max(peak, active);
    seen.push({ url, ua: new Headers(init?.headers).get('user-agent') });
    await new Promise((r) => setTimeout(r, 5));
    active--;
    return new Response(JSON.stringify({ url }), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { impl, seen, peak: () => peak };
}

describe('node transport', () => {
  it('sends the User-Agent and caches responses on disk', async () => {
    const f = fakeFetch();
    const t = createNodeTransport({ cacheDir: dir, fetchImpl: f.impl, contact: 'me@example.org', refresh: false });
    const a = await t('https://api.test/v1/a');
    expect(await a.json()).toEqual({ url: 'https://api.test/v1/a' });
    const b = await t('https://api.test/v1/a');
    expect(b.headers.get('x-cache')).toBe('disk');
    expect(f.seen).toHaveLength(1);
    expect(f.seen[0]?.ua).toMatch(/^Taxonomap\/[\d.]+ \(contact: me@example\.org\)$/);
  });

  it('caps concurrency at 5', async () => {
    const f = fakeFetch();
    const t = createNodeTransport({ cacheDir: dir, fetchImpl: f.impl, refresh: true });
    await Promise.all(Array.from({ length: 20 }, (_, i) => t(`https://api.test/v1/${i}`)));
    expect(f.peak()).toBe(5);
  });

  it('does not cache throttled responses', async () => {
    const f = fakeFetch(429);
    const t = createNodeTransport({ cacheDir: dir, fetchImpl: f.impl, refresh: false });
    await t('https://api.test/v1/x');
    await t('https://api.test/v1/x');
    expect(f.seen).toHaveLength(2);
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
    const f = fakeFetch();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(f.impl);
    const t = createNodeTransport();
    await t('https://api.test/v1/a');
    // A zero TTL makes the disk copy stale at once.
    await t('https://api.test/v1/a');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('passes the signal on, and keeps a content type the response leaves out', async () => {
    const seen: (AbortSignal | undefined)[] = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      seen.push(init?.signal ?? undefined);
      const res = new Response('{"a":1}', { status: 200 });
      res.headers.delete('content-type');
      return res;
    }) as typeof fetch;
    const t = createNodeTransport({ cacheDir: dir, fetchImpl, refresh: true });
    const ctrl = new AbortController();
    const res = await t('https://api.test/v1/a', { signal: ctrl.signal });
    expect(res.headers.get('content-type')).toBe('application/json');
    await t('https://api.test/v1/b');
    expect(seen).toEqual([ctrl.signal, undefined]);
  });

  it('pauses every queued request after a Retry-After', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] });
    const times: number[] = [];
    const fetchImpl = (async () => {
      times.push(Date.now());
      return new Response('{}', { status: times.length === 1 ? 429 : 200, headers: { 'retry-after': '1' } });
    }) as typeof fetch;
    const t = createNodeTransport({ cacheDir: dir, fetchImpl, refresh: true, concurrency: 1 });
    await t('https://api.test/v1/a');
    const second = t('https://api.test/v1/b');
    await vi.advanceTimersByTimeAsync(1000);
    await second;
    expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(1000);
  });
});
