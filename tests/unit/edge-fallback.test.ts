/**
 * Client fallback: when the configured edge cache fails at the platform
 * level, requests go to GBIF directly; GBIF errors relayed by the edge do not
 * trigger fallback.
 */
const EDGE = 'https://edge.test';
const GBIF = 'https://api.gbif.org';

async function load() {
  vi.resetModules();
  vi.stubEnv('PUBLIC_GBIF_API_BASE', EDGE);
  vi.stubEnv('PUBLIC_GBIF_TILE_BASE', EDGE);
  const http = await import('~/lib/gbif/http');
  const edge = await import('~/lib/gbif/edge');
  const maps = await import('~/lib/gbif/maps');
  return { ...http, ...edge, ...maps };
}

const ok = (body: unknown, edge = true) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', ...(edge && { 'x-gbif-edge': 'HIT' }) },
  });

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('edge fallback', () => {
  it('uses the edge while it works', async () => {
    const m = await load();
    const calls: string[] = [];
    const c = m.createHttp({ transport: async (u) => (calls.push(u), ok({ a: 1 })), sleep: async () => undefined });
    await c.getJson('/v1/species/1');
    expect(calls).toEqual([`${EDGE}/v1/species/1`]);
    expect(m.tileBase()).toBe(EDGE);
  });

  it('falls back to GBIF on a platform error page (no edge header) and stays there', async () => {
    const m = await load();
    const calls: string[] = [];
    const c = m.createHttp({
      transport: async (u) => {
        calls.push(u);
        if (u.startsWith(EDGE)) return new Response('<html>1027</html>', { status: 429 });
        return ok({ direct: true }, false);
      },
      sleep: async () => undefined,
    });
    await expect(c.getJson('/v1/species/1')).resolves.toEqual({ direct: true });
    await c.getJson('/v1/species/2');
    expect(calls).toEqual([`${EDGE}/v1/species/1`, `${GBIF}/v1/species/1`, `${GBIF}/v1/species/2`]);
    expect(m.edgeAvailable()).toBe(false);
    expect(m.occurrenceTileTemplate({})).toMatch(/^https:\/\/api\.gbif\.org\/v2\/map\//);
  });

  it('falls back on network errors without waiting', async () => {
    const m = await load();
    const sleeps: number[] = [];
    const c = m.createHttp({
      transport: async (u) => {
        if (u.startsWith(EDGE)) throw new TypeError('Failed to fetch');
        return ok({ direct: true }, false);
      },
      sleep: async (ms) => void sleeps.push(ms),
    });
    await expect(c.getJson('/v1/species/1')).resolves.toEqual({ direct: true });
    expect(sleeps).toEqual([]);
  });

  it('treats GBIF errors relayed by the edge as normal retries', async () => {
    const m = await load();
    let n = 0;
    const c = m.createHttp({
      transport: async () =>
        ++n === 1 ? new Response('{}', { status: 503, headers: { 'x-gbif-edge': 'BYPASS' } }) : ok({ ok: 1 }),
      sleep: async () => undefined,
    });
    await expect(c.getJson('/v1/species/1')).resolves.toEqual({ ok: 1 });
    expect(m.edgeAvailable()).toBe(true);
  });

  it('returns to the edge after the cool-down', async () => {
    const m = await load();
    m.markEdgeDown(0);
    expect(m.edgeAvailable(1000)).toBe(false);
    expect(m.edgeAvailable(5 * 60_000 + 1)).toBe(true);
  });
});
