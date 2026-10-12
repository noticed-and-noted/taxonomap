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
    expect(f.seen[0]?.ua).toMatch(/^GBIFExplorer\/[\d.]+ \(contact: me@example\.org\)$/);
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
