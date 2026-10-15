import { EDGE_HEADER, handle, normaliseQuery, policyFor, type EdgeDeps, type EdgeEnv } from '../../worker/src/proxy';

class FakeCache {
  store = new Map<string, Response>();
  async match(key: RequestInfo | URL) {
    const r = this.store.get(String(key));
    return r ? r.clone() : undefined;
  }
  async put(key: RequestInfo | URL, res: Response) {
    // Read the body now, like the real cache does.
    const body = await res.arrayBuffer();
    this.store.set(String(key), new Response(body, res));
  }
}

function setup(upstream: (url: string) => Response | Promise<Response>, env: EdgeEnv = {}) {
  const cache = new FakeCache();
  const pending: Promise<unknown>[] = [];
  const calls: { url: string; ua: string | null }[] = [];
  let now = 1_000_000;
  const deps: EdgeDeps = {
    cache,
    fetch: async (req) => {
      calls.push({ url: req.url, ua: req.headers.get('user-agent') });
      return upstream(req.url);
    },
    waitUntil: (p) => void pending.push(p),
    now: () => now,
  };
  const get = (path: string, headers: Record<string, string> = {}) =>
    handle(new Request(`https://edge.test${path}`, { headers }), { CONTACT_EMAIL: 'me@x.org', ...env }, deps);
  const settle = () => Promise.all(pending.splice(0));
  return { cache, calls, get, settle, advance: (s: number) => (now += s * 1000) };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('edge worker', () => {
  it('normalises query strings', () => {
    expect(normaliseQuery(new URLSearchParams('b=2&a=1&empty=&facet=year&facet=month&a=1'))).toBe(
      'a=1&b=2&facet=month&facet=year',
    );
  });

  it('allowlists only the paths the app uses', () => {
    expect(policyFor('/v2/map/occurrence/density/3/4/2.mvt')).not.toBeNull();
    expect(policyFor('/v2/map/occurrence/adhoc/3/4/2@1x.png')).not.toBeNull();
    expect(policyFor('/v1/occurrence/search')).not.toBeNull();
    expect(policyFor('/v1/species/212/vernacularNames')).not.toBeNull();
    expect(policyFor('/v1/organization/bb646dff-a905-4403-a49b-6d378c2cf0d9')).not.toBeNull();
    expect(policyFor('/v1/occurrence/download/request')).toBeNull();
    expect(policyFor('/v1/user/login')).toBeNull();
  });

  it('misses, stores, then hits; equivalent queries share an entry', async () => {
    const t = setup(() => json({ ok: 1 }));
    const a = await t.get('/v1/occurrence/search?taxonKey=1&limit=0');
    expect(a.headers.get(EDGE_HEADER)).toBe('MISS');
    await t.settle();
    const b = await t.get('/v1/occurrence/search?limit=0&taxonKey=1');
    expect(b.headers.get(EDGE_HEADER)).toBe('HIT');
    expect(await b.json()).toEqual({ ok: 1 });
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0]?.url).toBe('https://api.gbif.org/v1/occurrence/search?limit=0&taxonKey=1');
    expect(t.calls[0]?.ua).toMatch(/^Taxonomap-edge\/[\d.]+ \(contact: me@x\.org\)$/);
  });

  it('serves stale while revalidating in the background', async () => {
    let n = 0;
    const t = setup(() => json({ n: ++n }));
    await t.get('/v1/species/212');
    await t.settle();
    t.advance(8 * 24 * 3600); // past the 7-day fresh period, inside 30-day stale
    const stale = await t.get('/v1/species/212');
    expect(stale.headers.get(EDGE_HEADER)).toBe('STALE');
    expect(await stale.json()).toEqual({ n: 1 });
    await t.settle();
    const hit = await t.get('/v1/species/212');
    expect(hit.headers.get(EDGE_HEADER)).toBe('HIT');
    expect(await hit.json()).toEqual({ n: 2 });
  });

  it('keeps serving stale copies when GBIF fails', async () => {
    let fail = false;
    const t = setup(() => (fail ? json({}, 503) : json({ v: 'old' })));
    await t.get('/v1/occurrence/search?taxonKey=1');
    await t.settle();
    fail = true;
    t.advance(7 * 3600);
    const r = await t.get('/v1/occurrence/search?taxonKey=1');
    expect(r.headers.get(EDGE_HEADER)).toBe('STALE');
    await t.settle();
    expect(await (await t.get('/v1/occurrence/search?taxonKey=1')).json()).toEqual({ v: 'old' });
  });

  it('passes GBIF errors through uncached, marked BYPASS', async () => {
    const t = setup(() => json({}, 429));
    const r = await t.get('/v1/occurrence/search?q=x');
    expect(r.status).toBe(429);
    expect(r.headers.get(EDGE_HEADER)).toBe('BYPASS');
    expect(r.headers.get('cache-control')).toBe('no-store');
    await t.settle();
    expect(t.cache.store.size).toBe(0);
  });

  it('dedupes concurrent misses into one upstream call', async () => {
    const t = setup(() => new Promise((r) => setTimeout(() => r(json({ ok: 1 })), 5)));
    const rs = await Promise.all([1, 2, 3].map(() => t.get('/v1/dataset/d7dddbf4-2cf0-4f39-9b2a-bb099caae36c')));
    expect(rs.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(t.calls).toHaveLength(1);
  });

  it('rejects unlisted paths, other methods and disallowed origins', async () => {
    const t = setup(() => json({}), { ALLOWED_ORIGINS: 'https://site.example' });
    expect((await t.get('/v1/user/login')).status).toBe(404);
    expect((await t.get('/v1/occurrence/search', { origin: 'https://evil.example' })).status).toBe(403);
    expect((await t.get('/v1/occurrence/search')).status).toBe(403); // no Origin on a JSON route
    const ok = await t.get('/v1/occurrence/search', { origin: 'https://site.example' });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://site.example');
    expect(ok.headers.get('access-control-expose-headers')).toContain(EDGE_HEADER);
    // Thumbnails load via <img>, which sends no Origin.
    expect((await t.get('/v1/image/cache/200x/occurrence/1/media/0123456789abcdef0123456789abcdef')).status).toBe(200);
    const post = await handle(
      new Request('https://edge.test/v1/occurrence/search', { method: 'POST' }),
      {},
      {
        cache: t.cache,
        fetch: async () => json({}),
        waitUntil: () => undefined,
      },
    );
    expect(post.status).toBe(405);
  });

  it('answers CORS preflight', async () => {
    const t = setup(() => json({}));
    const r = await handle(
      new Request('https://edge.test/v1/occurrence/search', { method: 'OPTIONS' }),
      {},
      {
        cache: t.cache,
        fetch: async () => json({}),
        waitUntil: () => undefined,
      },
    );
    expect(r.status).toBe(204);
    expect(r.headers.get('access-control-allow-origin')).toBe('*');
  });
});
