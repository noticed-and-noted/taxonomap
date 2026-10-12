import { GbifNotFoundError, GbifUnavailableError } from '~/lib/gbif/errors';
import { $gbifStale, createHttp, parseRetryAfter, type Transport } from '~/lib/gbif/http';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

function setup(responses: Array<Response | Error>) {
  const calls: string[] = [];
  const sleeps: number[] = [];
  const transport: Transport = async (url) => {
    calls.push(url);
    const next = responses.shift();
    if (!next) throw new Error('no more responses');
    if (next instanceof Error) throw next;
    return next;
  };
  const client = createHttp({
    base: 'https://api.test',
    transport,
    sleep: async (ms) => void sleeps.push(ms),
    random: () => 0.5,
  });
  return { client, calls, sleeps };
}

beforeEach(() => $gbifStale.set(false));

describe('http client', () => {
  it('normalises params into the request URL', async () => {
    const { client, calls } = setup([json({ ok: 1 })]);
    await client.getJson('/v1/x', { b: 2, a: 1 });
    expect(calls).toEqual(['https://api.test/v1/x?a=1&b=2']);
  });

  it('dedupes concurrent identical requests', async () => {
    const { client, calls } = setup([json({ n: 1 })]);
    const [a, b] = await Promise.all([client.getJson('/v1/x', { a: 1 }), client.getJson('/v1/x', { a: 1 })]);
    expect(a).toEqual({ n: 1 });
    expect(b).toBe(a);
    expect(calls).toHaveLength(1);
  });

  it('serves repeat requests from the LRU', async () => {
    const { client, calls } = setup([json({ n: 1 })]);
    await client.getJson('/v1/x');
    await client.getJson('/v1/x');
    expect(calls).toHaveLength(1);
  });

  it('retries 429/5xx with exponential back-off and honours Retry-After', async () => {
    const { client, calls, sleeps } = setup([
      json({}, 503),
      json({}, 429, { 'retry-after': '2' }),
      new Error('network'),
      json({ ok: true }),
    ]);
    await expect(client.getJson('/v1/x')).resolves.toEqual({ ok: true });
    expect(calls).toHaveLength(4);
    // attempt0: 500ms step → 375; attempt1: Retry-After 2s; attempt2: 2000ms step → 1500
    expect(sleeps).toEqual([375, 2000, 1500]);
  });

  it('gives up after 3 retries and throws GbifUnavailableError when nothing is cached', async () => {
    const { client, calls } = setup([json({}, 500), json({}, 500), json({}, 500), json({}, 500)]);
    await expect(client.getJson('/v1/x')).rejects.toBeInstanceOf(GbifUnavailableError);
    expect(calls).toHaveLength(4);
    expect($gbifStale.get()).toBe(false);
  });

  it('falls back to a stale cached copy and raises the stale flag', async () => {
    const { client } = setup([json({ v: 'old' }), json({}, 502), json({}, 502), json({}, 502), json({}, 502)]);
    await client.getJson('/v1/x', undefined, { ttlMs: -1 }); // immediately stale
    await expect(client.getJson('/v1/x')).resolves.toEqual({ v: 'old' });
    expect($gbifStale.get()).toBe(true);
  });

  it('does not retry 4xx and maps 404 to GbifNotFoundError', async () => {
    const { client, calls } = setup([new Response('nope', { status: 404 })]);
    await expect(client.getJson('/v1/species/0')).rejects.toBeInstanceOf(GbifNotFoundError);
    expect(calls).toHaveLength(1);
  });

  it('parses Retry-After seconds and HTTP dates', () => {
    expect(parseRetryAfter('3')).toBe(3000);
    expect(parseRetryAfter(new Date(10_000).toUTCString(), 4000)).toBe(6000);
    expect(parseRetryAfter(null)).toBeUndefined();
  });
});
