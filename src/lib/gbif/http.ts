import { atom } from 'nanostores';
import { GBIF_API_BASE } from './config';
import { GbifNotFoundError, GbifRequestError, GbifUnavailableError } from './errors';
import { LruCache } from './lru';
import { buildUrl, type Params } from './params';

/** Fetch-compatible transport. Browser uses fetch; build time uses node-transport. */
export type Transport = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;

export interface HttpOptions {
  base: string;
  transport: Transport;
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  defaultTtlMs: number;
  cacheSize: number;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
}

export interface RequestOptions {
  ttlMs?: number;
  signal?: AbortSignal;
}

/** True once any response has been served from a stale cache entry. */
export const $gbifStale = atom(false);

const RETRYABLE = (status: number) => status === 429 || status >= 500;

export function parseRetryAfter(header: string | null, now = Date.now()): number | undefined {
  if (!header) return undefined;
  const secs = Number(header);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

export function createHttp(overrides: Partial<HttpOptions> = {}) {
  const opts: HttpOptions = {
    base: GBIF_API_BASE,
    transport: (url, init) => globalThis.fetch(url, init),
    maxRetries: 3,
    baseDelayMs: 500,
    maxDelayMs: 30_000,
    defaultTtlMs: 10 * 60_000,
    cacheSize: 300,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    random: Math.random,
    ...overrides,
  };
  const cache = new LruCache<unknown>(opts.cacheSize);
  const inFlight = new Map<string, Promise<unknown>>();

  /** Exponential back-off with full jitter, floored at half the step. */
  function backoff(attempt: number): number {
    const step = Math.min(opts.maxDelayMs, opts.baseDelayMs * 2 ** attempt);
    return step / 2 + opts.random() * (step / 2);
  }

  async function fetchWithRetry(url: string, signal?: AbortSignal): Promise<unknown> {
    let lastStatus: number | undefined;
    for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
      let res: Response;
      try {
        res = await opts.transport(url, signal ? { signal } : undefined);
      } catch (err) {
        if (signal?.aborted) throw err;
        lastStatus = undefined;
        if (attempt < opts.maxRetries) await opts.sleep(backoff(attempt));
        continue;
      }
      if (res.ok) return res.json();
      lastStatus = res.status;
      if (!RETRYABLE(res.status)) {
        const detail = (await res.text().catch(() => '')).slice(0, 200);
        const Err = res.status === 404 ? GbifNotFoundError : GbifRequestError;
        throw new Err(url, res.status, detail);
      }
      if (attempt < opts.maxRetries) {
        const retryAfter = parseRetryAfter(res.headers.get('retry-after'));
        await opts.sleep(Math.min(opts.maxDelayMs, retryAfter ?? backoff(attempt)));
      }
    }
    throw new GbifUnavailableError(url, lastStatus);
  }

  /**
   * GET JSON from GBIF. Identical concurrent requests share one promise; fresh
   * results come from the LRU; on persistent failure a stale copy is returned
   * and $gbifStale is raised.
   */
  async function getJson<T>(path: string, params?: Params, ro: RequestOptions = {}): Promise<T> {
    const url = buildUrl(opts.base, path, params);
    const fresh = cache.get(url);
    if (fresh !== undefined) return fresh as T;

    const pending = inFlight.get(url);
    if (pending) return pending as Promise<T>;

    const p = fetchWithRetry(url, ro.signal)
      .then((data) => {
        cache.set(url, data, ro.ttlMs ?? opts.defaultTtlMs);
        return data;
      })
      .catch((err: unknown) => {
        if (err instanceof GbifUnavailableError) {
          const stale = cache.peek(url);
          if (stale !== undefined) {
            $gbifStale.set(true);
            return stale;
          }
        }
        throw err;
      })
      .finally(() => inFlight.delete(url));

    inFlight.set(url, p);
    return p as Promise<T>;
  }

  return {
    getJson,
    url: (path: string, params?: Params) => buildUrl(opts.base, path, params),
    clear: () => cache.clear(),
    get options(): Readonly<HttpOptions> {
      return opts;
    },
  };
}

export type Http = ReturnType<typeof createHttp>;

let current: Http = createHttp();

/** The shared client instance used by all endpoint modules. */
export function http(): Http {
  return current;
}

/** Swap transport/options (build time uses the Node disk-cache transport). */
export function configureHttp(overrides: Partial<HttpOptions>): Http {
  current = createHttp(overrides);
  return current;
}
