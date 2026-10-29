/**
 * Build-time (Node only) transport: identifies us with a User-Agent, caps
 * concurrency at 5, honours Retry-After globally, and keeps an on-disk
 * response cache in .cache/gbif that CI persists between runs.
 *
 * Never import this from browser code. Import `~/lib/gbif/server` instead.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import pLimit from 'p-limit';
import { HOUR, MINUTE } from '~/lib/util/time';
import { parseRetryAfter, type Transport } from './http';

export interface NodeTransportOptions {
  cacheDir?: string;
  ttlMs?: number;
  refresh?: boolean;
  concurrency?: number;
  contact?: string;
  fetchImpl?: typeof fetch;
}

interface CachedResponse {
  url: string;
  status: number;
  contentType: string;
  body: string;
  fetchedAt: number;
}

function packageVersion(): string {
  if (process.env['npm_package_version']) return process.env['npm_package_version'];
  try {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as { version?: string };
    return packageJson.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** The User-Agent that identifies this build to GBIF, with an optional contact address. */
export function userAgent(contact = process.env['GBIF_CONTACT_EMAIL']): string {
  return `Taxonomap/${packageVersion()} (contact: ${contact || 'unset'})`;
}

const DEFAULT_CACHE_TTL_HOURS = 168;
const DEFAULT_CONCURRENCY = 5;
const MAX_RETRY_PAUSE_MS = 2 * MINUTE;

interface DiskCache {
  read(url: string): Promise<CachedResponse | undefined>;
  write(entry: CachedResponse): Promise<void>;
}

/** Responses stored as JSON files under `cacheDir`, sharded by the first byte of the URL's hash. */
function createDiskCache(cacheDir: string, ttlMs: number, refresh: boolean): DiskCache {
  const pathFor = (url: string) => {
    const hash = createHash('sha1').update(url).digest('hex');
    return join(cacheDir, hash.slice(0, 2), `${hash}.json`);
  };

  return {
    async read(url) {
      if (refresh) return undefined;
      try {
        const cached = JSON.parse(await readFile(pathFor(url), 'utf8')) as CachedResponse;
        return Date.now() - cached.fetchedAt < ttlMs ? cached : undefined;
      } catch {
        return undefined;
      }
    },
    async write(entry) {
      const file = pathFor(entry.url);
      await mkdir(join(file, '..'), { recursive: true });
      await writeFile(file, JSON.stringify(entry));
    },
  };
}

/**
 * A transport for build scripts: a disk cache in front of GBIF, at most N requests at once,
 * with a Retry-After on any response pausing every queued request.
 */
export function createNodeTransport(options: NodeTransportOptions = {}): Transport {
  const cache = createDiskCache(
    options.cacheDir ?? join(process.cwd(), '.cache', 'gbif'),
    options.ttlMs ?? Number(process.env['GBIF_CACHE_TTL_HOURS'] ?? DEFAULT_CACHE_TTL_HOURS) * HOUR,
    options.refresh ?? process.env['GBIF_CACHE_REFRESH'] === '1',
  );
  const limit = pLimit(options.concurrency ?? DEFAULT_CONCURRENCY);
  const doFetch = options.fetchImpl ?? fetch;
  const agent = userAgent(options.contact);
  let pausedUntil = 0;

  async function fetchFromGbif(url: string, requestInit?: Parameters<Transport>[1]): Promise<Response> {
    const wait = pausedUntil - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    const response = await doFetch(url, {
      headers: { 'User-Agent': agent, Accept: 'application/json' },
      ...(requestInit?.signal ? { signal: requestInit.signal } : {}),
    });
    const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'));
    if (retryAfterMs) pausedUntil = Math.max(pausedUntil, Date.now() + Math.min(retryAfterMs, MAX_RETRY_PAUSE_MS));
    // Cache successes and definitive 404s; never cache throttling or errors.
    if (response.status !== 200 && response.status !== 404) return response;
    const body = await response.text();
    const contentType = response.headers.get('content-type') ?? 'application/json';
    await cache.write({ url, status: response.status, contentType, body, fetchedAt: Date.now() });
    return new Response(body, { status: response.status, headers: { 'content-type': contentType } });
  }

  return async (url, requestInit) => {
    const cached = await cache.read(url);
    if (cached) {
      return new Response(cached.body, {
        status: cached.status,
        headers: { 'content-type': cached.contentType, 'x-cache': 'disk' },
      });
    }
    return limit(() => fetchFromGbif(url, requestInit));
  };
}
