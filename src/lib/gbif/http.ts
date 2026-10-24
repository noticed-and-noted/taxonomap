import { atom } from 'nanostores';
import { MINUTE } from '~/lib/util/time';
import { GBIF_API_BASE } from './config';
import { GbifNotFoundError, GbifRequestError, GbifUnavailableError } from './errors';
import { LruCache } from './lru';
import { countRequest } from './metrics';
import { buildUrl, type Params } from './params';

/** Fetch-compatible transport. Browser uses fetch; build time uses node-transport. */
export type Transport = (url: string, requestInit?: { signal?: AbortSignal }) => Promise<Response>;

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
  now: () => number;
}

export interface RequestOptions {
  ttlMs?: number;
  signal?: AbortSignal;
}

/** True once any response has been served from a stale cache entry. */
export const $gbifStale = atom(false);

const isRetryable = (status: number) => status === 429 || status >= 500;
const MIN_429_DELAY_MS = 1000;
const ERROR_DETAIL_MAX_CHARS = 200;

const DEFAULT_OPTIONS: HttpOptions = {
  base: GBIF_API_BASE,
  transport: (url, requestInit) => globalThis.fetch(url, requestInit),
  maxRetries: 3,
  baseDelayMs: 500,
  maxDelayMs: 30_000,
  defaultTtlMs: 10 * MINUTE,
  cacheSize: 300,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random: Math.random,
  now: Date.now,
};

/**
 * Parses a Retry-After header.
 * @param header Header value: delta-seconds or an HTTP date.
 * @param now Current time in ms, for HTTP dates.
 * @returns Milliseconds to wait, or undefined when the header is absent or unparseable.
 */
export function parseRetryAfter(header: string | null, now = Date.now()): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

/** Exponential back-off with full jitter, floored at half the step. */
function backoff(options: HttpOptions, attempt: number): number {
  const step = Math.min(options.maxDelayMs, options.baseDelayMs * 2 ** attempt);
  return step / 2 + options.random() * (step / 2);
}

/** A response that retrying won't fix: GbifNotFoundError for 404, otherwise GbifRequestError. */
async function requestError(url: string, response: Response): Promise<GbifRequestError> {
  const detail = (await response.text().catch(() => '')).slice(0, ERROR_DETAIL_MAX_CHARS);
  const ErrorClass = response.status === 404 ? GbifNotFoundError : GbifRequestError;
  return new ErrorClass(url, response.status, detail);
}

/**
 * A function that GETs a path from GBIF as JSON, retrying throttled and failed requests with back-off.
 * Throws GbifUnavailableError when retries run out, and the request's own error for a definitive failure.
 */
function createRetryingFetcher(options: HttpOptions) {
  /**
   * Shared cool-down after a 429: GBIF rate-limits per client, so once one
   * request is throttled every other request waits too, instead of each
   * hitting the limit again on its own schedule.
   */
  let coolUntil = 0;

  /** One try: the response, or null if the network failed. A cancelled request throws. */
  async function tryOnce(url: string, signal: AbortSignal): Promise<Response | null> {
    countRequest('json');
    try {
      return await options.transport(url, { signal });
    } catch (error) {
      if (signal.aborted) throw error;
      return null;
    }
  }

  /** How long to wait before retrying a failed response; a 429 also starts the shared cool-down. */
  function retryDelay(response: Response, attempt: number): number {
    const retryAfter = parseRetryAfter(response.headers.get('retry-after'));
    // GBIF sends no Retry-After; its 429 window outlasts the first back-off step.
    const isThrottled = response.status === 429;
    const fallback = isThrottled ? Math.max(MIN_429_DELAY_MS, backoff(options, attempt)) : backoff(options, attempt);
    const delay = Math.min(options.maxDelayMs, retryAfter ?? fallback);
    if (isThrottled) coolUntil = Math.max(coolUntil, options.now() + delay);
    return delay;
  }

  return async function fetchWithRetry(path: string, signal: AbortSignal): Promise<unknown> {
    const url = `${options.base}${path}`;
    let lastStatus: number | undefined;
    let hasJustWaited = false;
    for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
      // A request that just slept its own back-off has already waited.
      const cool = coolUntil - options.now();
      if (cool > 0 && !hasJustWaited) await options.sleep(cool);
      // Cancelled during a cool-down or back-off: don't send (or count) it.
      signal.throwIfAborted();
      hasJustWaited = false;

      const response = await tryOnce(url, signal);
      if (response?.ok) return response.json();
      lastStatus = response?.status;
      if (response && !isRetryable(response.status)) throw await requestError(url, response);
      if (attempt < options.maxRetries) {
        await options.sleep(response ? retryDelay(response, attempt) : backoff(options, attempt));
        hasJustWaited = true;
      }
    }
    throw new GbifUnavailableError(url, lastStatus);
  };
}

/** A request shared by every caller waiting on the same URL. */
interface SharedRequest {
  promise: Promise<unknown>;
  controller: AbortController;
  waiting: number;
}

/** The stale cached copy to serve when GBIF is unavailable; rethrows `error` when there is none. */
function staleOrThrow(cache: LruCache<unknown>, url: string, error: unknown): unknown {
  if (error instanceof GbifUnavailableError) {
    const stale = cache.peek(url);
    if (stale !== undefined) {
      $gbifStale.set(true);
      return stale;
    }
  }
  throw error;
}

/**
 * Waits for a shared request, but rejects early when `signal` aborts.
 * @param onLastAbort Called when the aborting caller was the last one waiting (the request is cancelled too).
 */
function waitUnlessAborted<T>(request: SharedRequest, signal: AbortSignal, onLastAbort: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(signal.reason);
      if (--request.waiting === 0) {
        request.controller.abort(signal.reason);
        onLastAbort();
      }
    };
    signal.addEventListener('abort', onAbort, { once: true });
    request.promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value as T);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

/**
 * One request per URL, shared by every caller. The request has its own
 * controller: a caller's signal only stops that caller waiting, and the
 * request itself is cancelled once no caller is left waiting.
 */
function createRequestSharing(
  cache: LruCache<unknown>,
  fetchWithRetry: (path: string, signal: AbortSignal) => Promise<unknown>,
) {
  const inFlight = new Map<string, SharedRequest>();

  /** Drop a finished or cancelled request, unless a newer one for the URL has replaced it. */
  function forget(url: string, request: { promise: Promise<unknown> }) {
    if (inFlight.get(url) === request) inFlight.delete(url);
  }

  function start(url: string, ttlMs: number): SharedRequest {
    const controller = new AbortController();
    const request: SharedRequest = {
      controller,
      waiting: 0,
      promise: fetchWithRetry(url, controller.signal)
        .then((data) => {
          cache.set(url, data, ttlMs);
          return data;
        })
        .catch((error: unknown) => staleOrThrow(cache, url, error))
        .finally(() => forget(url, request)),
    };
    // Callers that stop waiting are rejected on their own; this only silences the shared copy.
    request.promise.catch(() => {});
    inFlight.set(url, request);
    return request;
  }

  return {
    /** The request already in flight for the URL, or a new one; the caller is counted as waiting on it. */
    join(url: string, ttlMs: number): SharedRequest {
      const request = inFlight.get(url) ?? start(url, ttlMs);
      request.waiting++;
      return request;
    },

    /** Waits for the request unless `signal` aborts first. */
    wait<T>(url: string, request: SharedRequest, signal: AbortSignal): Promise<T> {
      return waitUnlessAborted<T>(request, signal, () => forget(url, request));
    },
  };
}

/**
 * An HTTP client for the GBIF API with a response cache, request sharing, retries and stale fallback.
 * @param overrides Any of HttpOptions to replace the defaults (tests inject transport, sleep and clock).
 */
export function createHttp(overrides: Partial<HttpOptions> = {}) {
  const options: HttpOptions = { ...DEFAULT_OPTIONS, ...overrides };
  const cache = new LruCache<unknown>(options.cacheSize);
  const sharing = createRequestSharing(cache, createRetryingFetcher(options));

  /**
   * GET JSON from GBIF. Identical concurrent requests share one request;
   * fresh results come from the LRU; on persistent failure a stale copy is
   * returned and $gbifStale is raised. Aborting `requestOptions.signal` rejects
   * only this caller.
   * @throws GbifNotFoundError, GbifRequestError or GbifUnavailableError when there is no usable response.
   */
  async function getJson<T>(path: string, params?: Params, requestOptions: RequestOptions = {}): Promise<T> {
    // Cache key and path+query, independent of which base serves it.
    const url = buildUrl('', path, params);
    const fresh = cache.get(url);
    if (fresh !== undefined) return fresh as T;

    const { signal } = requestOptions;
    signal?.throwIfAborted();
    const request = sharing.join(url, requestOptions.ttlMs ?? options.defaultTtlMs);
    if (!signal) return request.promise as Promise<T>;
    return sharing.wait<T>(url, request, signal);
  }

  return {
    getJson,
    url: (path: string, params?: Params) => buildUrl(options.base, path, params),
    clear: () => cache.clear(),
    get options(): Readonly<HttpOptions> {
      return options;
    },
  };
}

export type Http = ReturnType<typeof createHttp>;

let current: Http = createHttp();

/** The shared client instance used by all endpoint modules. */
export function http(): Http {
  return current;
}

/** The shared client's transport, for clients of other APIs: at build time, the Node one (User-Agent, disk cache). */
export function sharedTransport(): Transport {
  return current.options.transport;
}

/** Swap transport/options (build time uses the Node disk-cache transport). */
export function configureHttp(overrides: Partial<HttpOptions>): Http {
  current = createHttp(overrides);
  return current;
}
