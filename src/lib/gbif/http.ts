import { atom } from 'nanostores';
import { apiBase, isEdgeUrl, markEdgeDown, servedByEdge } from './edge';
import { GbifNotFoundError, GbifRequestError, GbifUnavailableError } from './errors';
import { LruCache } from './lru';
import { countRequest } from './metrics';
import { buildUrl, type Params } from './params';

/** Fetch-compatible transport. Browser uses fetch; build time uses node-transport. */
export type Transport = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;

export interface HttpOptions {
  /** Base URL, or a function so the edge fallback can switch it per attempt. */
  base: string | (() => string);
  transport: Transport;
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  defaultTtlMs: number;
  cacheSize: number;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
  now: () => number;
}

export interface RequestOptions {
  ttlMs?: number;
  signal?: AbortSignal;
}

/** True once any response has been served from a stale cache entry. */
export const $gbifStale = atom(false);

const RETRYABLE = (status: number) => status === 429 || status >= 500;
const MIN_429_DELAY_MS = 1000;

export function parseRetryAfter(header: string | null, now = Date.now()): number | undefined {
  if (!header) return undefined;
  const secs = Number(header);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

export function createHttp(overrides: Partial<HttpOptions> = {}) {
  const opts: HttpOptions = {
    base: apiBase,
    transport: (url, init) => globalThis.fetch(url, init),
    maxRetries: 3,
    baseDelayMs: 500,
    maxDelayMs: 30_000,
    defaultTtlMs: 10 * 60_000,
    cacheSize: 300,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    random: Math.random,
    now: Date.now,
    ...overrides,
  };
  const cache = new LruCache<unknown>(opts.cacheSize);
  const inFlight = new Map<string, Promise<unknown>>();
  /**
   * Shared cool-down after a 429: GBIF rate-limits per client, so once one
   * request is throttled every other request waits too, instead of each
   * hitting the limit again on its own schedule.
   */
  let coolUntil = 0;

  /** Exponential back-off with full jitter, floored at half the step. */
  function backoff(attempt: number): number {
    const step = Math.min(opts.maxDelayMs, opts.baseDelayMs * 2 ** attempt);
    return step / 2 + opts.random() * (step / 2);
  }

  const baseUrl = () => (typeof opts.base === 'function' ? opts.base() : opts.base);

  async function fetchWithRetry(rel: string, signal?: AbortSignal): Promise<unknown> {
    let lastStatus: number | undefined;
    let url = `${baseUrl()}${rel}`;
    let waited = false;
    for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
      // A request that just slept its own back-off has already waited.
      const cool = coolUntil - opts.now();
      if (cool > 0 && !waited) await opts.sleep(cool);
      waited = false;
      url = `${baseUrl()}${rel}`;
      let res: Response;
      countRequest('json', url);
      try {
        res = await opts.transport(url, signal ? { signal } : undefined);
      } catch (err) {
        if (signal?.aborted) throw err;
        lastStatus = undefined;
        // Edge unreachable (or a CORS-less platform error): go direct, no wait.
        if (isEdgeUrl(url)) {
          markEdgeDown();
          continue;
        }
        if (attempt < opts.maxRetries) {
          await opts.sleep(backoff(attempt));
          waited = true;
        }
        continue;
      }
      if (!res.ok && isEdgeUrl(url) && !servedByEdge(res)) {
        // Cloudflare platform error (e.g. quota exceeded), not GBIF: go direct.
        markEdgeDown();
        lastStatus = res.status;
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
        // GBIF sends no Retry-After; its 429 window outlasts the first back-off step.
        const fallback = res.status === 429 ? Math.max(MIN_429_DELAY_MS, backoff(attempt)) : backoff(attempt);
        const delay = Math.min(opts.maxDelayMs, retryAfter ?? fallback);
        if (res.status === 429) coolUntil = Math.max(coolUntil, opts.now() + delay);
        await opts.sleep(delay);
        waited = true;
      }
    }
    throw new GbifUnavailableError(url, lastStatus);
  }

  /** Cache key and path+query, independent of which base serves it. */
  const relative = (path: string, params?: Params) => buildUrl('', path, params);

  /**
   * GET JSON from GBIF. Identical concurrent requests share one promise; fresh
   * results come from the LRU; on persistent failure a stale copy is returned
   * and $gbifStale is raised.
   */
  async function getJson<T>(path: string, params?: Params, ro: RequestOptions = {}): Promise<T> {
    const url = relative(path, params);
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
    url: (path: string, params?: Params) => buildUrl(baseUrl(), path, params),
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
