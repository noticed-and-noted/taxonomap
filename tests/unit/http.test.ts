import { GbifNotFoundError, GbifRequestError, GbifUnavailableError } from '~/lib/gbif/errors';
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

  it('sends a full URL as it is, on its own host', async () => {
    const { client, calls } = setup([json({ ok: 1 })]);
    await client.getJson('https://graphql.test/graphql', { query: '{ a }' });
    expect(calls).toEqual(['https://graphql.test/graphql?query=%7B%20a%20%7D']);
  });

  it('retries a body that is not complete, never caching it, and serves only a complete one', async () => {
    const { client, calls } = setup([json({ errors: [] }), json({ data: 1 }), json({ errors: [] })]);
    const isComplete = (body: unknown) => 'data' in (body as object);
    await expect(client.getJson('/v1/x', undefined, { isComplete })).resolves.toEqual({ data: 1 });
    expect(calls).toHaveLength(2);

    const failing = setup([json({ errors: [] }), json({ errors: [] }), json({ errors: [] }), json({ errors: [] })]);
    await expect(failing.client.getJson('/v1/y', undefined, { isComplete })).rejects.toBeInstanceOf(
      GbifUnavailableError,
    );
    expect(failing.calls).toHaveLength(4);
  });

  it('dedupes concurrent identical requests', async () => {
    const { client, calls } = setup([json({ n: 1 })]);
    const [first, second] = await Promise.all([client.getJson('/v1/x', { a: 1 }), client.getJson('/v1/x', { a: 1 })]);
    expect(first).toEqual({ n: 1 });
    expect(second).toBe(first);
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

  it('after a 429, other requests wait out the same cool-down', async () => {
    const calls: string[] = [];
    const sleeps: number[] = [];
    let throttled = false;
    const client = createHttp({
      base: 'https://api.test',
      transport: async (url) => {
        calls.push(url);
        if (url.endsWith('/a') && !throttled) {
          throttled = true;
          return json({}, 429, { 'retry-after': '3' });
        }
        return json(url.endsWith('/a') ? { a: 1 } : { b: 1 });
      },
      sleep: async (ms) => void sleeps.push(ms),
      random: () => 0.5,
      now: () => 0,
    });
    // /a is throttled and sleeps its Retry-After; /b, started meanwhile, waits too.
    const requestA = client.getJson('/v1/a');
    await Promise.resolve();
    await Promise.resolve();
    const requestB = client.getJson('/v1/b');
    await expect(Promise.all([requestA, requestB])).resolves.toEqual([{ a: 1 }, { b: 1 }]);
    expect(sleeps).toEqual([3000, 3000]);
    expect(calls).toHaveLength(3);
  });

  it('waits at least a second before retrying a 429 without Retry-After', async () => {
    const { client, sleeps } = setup([json({}, 429), json({ ok: true })]);
    await client.getJson('/v1/x');
    expect(sleeps).toEqual([1000]);
  });

  it('gives up after 3 retries and throws GbifUnavailableError when nothing is cached', async () => {
    const { client, calls } = setup([json({}, 500), json({}, 500), json({}, 500), json({}, 500)]);
    await expect(client.getJson('/v1/x')).rejects.toBeInstanceOf(GbifUnavailableError);
    expect(calls).toHaveLength(4);
    expect($gbifStale.get()).toBe(false);
  });

  it('gives up after network errors on every attempt', async () => {
    const { client, sleeps } = setup([new Error('a'), new Error('b'), new Error('c'), new Error('d')]);
    await expect(client.getJson('/v1/x')).rejects.toMatchObject({ name: 'GbifUnavailableError', status: undefined });
    expect(sleeps).toHaveLength(3);
  });

  it('uses the global fetch by default', async () => {
    const fetch = vi.fn(async () => json({ ok: 1 }));
    vi.stubGlobal('fetch', fetch);
    try {
      await expect(createHttp({ base: 'https://api.test' }).getJson('/v1/x')).resolves.toEqual({ ok: 1 });
      expect(fetch).toHaveBeenCalledWith(
        'https://api.test/v1/x',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
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

  describe('aborting a shared request', () => {
    /** A transport that answers only when told to, and records each request's signal. */
    function gated() {
      const signals: AbortSignal[] = [];
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const client = createHttp({
        base: 'https://api.test',
        transport: async (_url, requestInit) => {
          if (requestInit?.signal) signals.push(requestInit.signal);
          await gate;
          requestInit?.signal?.throwIfAborted();
          return json({ n: 1 });
        },
      });
      return { client, signals, release };
    }

    it('rejects only the caller that aborted', async () => {
      const { client, signals, release } = gated();
      const controller = new AbortController();
      const first = client.getJson('/v1/x', undefined, { signal: controller.signal });
      const second = client.getJson('/v1/x');
      controller.abort();
      release();
      await expect(first).rejects.toThrow();
      await expect(second).resolves.toEqual({ n: 1 });
      expect(signals[0]?.aborted).toBe(false);
    });

    it('cancels the request once every caller has aborted', async () => {
      const { client, signals, release } = gated();
      const controllerA = new AbortController();
      const controllerB = new AbortController();
      const firstRequest = client.getJson('/v1/x', undefined, { signal: controllerA.signal });
      const secondRequest = client.getJson('/v1/x', undefined, { signal: controllerB.signal });
      controllerA.abort();
      expect(signals[0]?.aborted).toBe(false);
      controllerB.abort();
      expect(signals[0]?.aborted).toBe(true);
      release();
      await expect(firstRequest).rejects.toThrow();
      await expect(secondRequest).rejects.toThrow();
    });

    it('starts afresh after a cancelled request', async () => {
      const { client, release } = gated();
      const controller = new AbortController();
      const first = client.getJson('/v1/x', undefined, { signal: controller.signal });
      controller.abort();
      await expect(first).rejects.toThrow();
      const again = client.getJson('/v1/x');
      release();
      await expect(again).resolves.toEqual({ n: 1 });
    });

    it('rejects at once when the signal is already aborted', async () => {
      const { client, signals } = gated();
      await expect(client.getJson('/v1/x', undefined, { signal: AbortSignal.abort() })).rejects.toThrow();
      expect(signals).toHaveLength(0);
    });
  });

  it('parses Retry-After seconds and HTTP dates', () => {
    expect(parseRetryAfter('3')).toBe(3000);
    expect(parseRetryAfter(new Date(10_000).toUTCString(), 4000)).toBe(6000);
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter('soon')).toBeUndefined();
  });

  it('throws GbifRequestError for other 4xx, even when the body cannot be read', async () => {
    const response = new Response('bad', { status: 400 });
    vi.spyOn(response, 'text').mockRejectedValue(new Error('stream'));
    const { client } = setup([response]);
    const error = await client.getJson('/v1/x').catch((error: unknown) => error);
    expect(error).toBeInstanceOf(GbifRequestError);
    expect(error).not.toBeInstanceOf(GbifNotFoundError);
    expect(error).toMatchObject({ status: 400 });
  });

  it('builds URLs, exposes its options and can drop its cache', async () => {
    const { client, calls } = setup([json({ n: 1 }), json({ n: 2 })]);
    expect(client.url('/v1/x', { a: 1 })).toBe('https://api.test/v1/x?a=1');
    expect(client.options.base).toBe('https://api.test');
    await client.getJson('/v1/x');
    client.clear();
    await expect(client.getJson('/v1/x')).resolves.toEqual({ n: 2 });
    expect(calls).toHaveLength(2);
  });

  it('sleeps on a real timer by default', async () => {
    vi.useFakeTimers();
    try {
      const responses = [json({}, 503), json({ ok: true })];
      const client = createHttp({
        base: 'https://api.test',
        transport: async () => responses.shift()!,
        random: () => 0,
      });
      const pending = client.getJson('/v1/x');
      await vi.advanceTimersByTimeAsync(250);
      await expect(pending).resolves.toEqual({ ok: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it('configureHttp swaps the shared client', async () => {
    const shared = await import('~/lib/gbif/http');
    const before = shared.http();
    const next = shared.configureHttp({ base: 'https://other.test' });
    expect(shared.http()).toBe(next);
    expect(next).not.toBe(before);
    expect(next.options.base).toBe('https://other.test');
    shared.configureHttp({});
  });
});
