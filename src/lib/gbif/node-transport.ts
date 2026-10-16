/**
 * Build-time (Node only) transport: identifies us with a User-Agent, caps
 * concurrency at 5, honours Retry-After globally, and keeps an on-disk
 * response cache in .cache/gbif that CI persists between runs.
 *
 * Never import this from browser code. Import `~/lib/gbif/server` instead.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
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
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export function userAgent(contact = process.env['GBIF_CONTACT_EMAIL']): string {
  return `Taxonomap/${packageVersion()} (contact: ${contact || 'unset'})`;
}

export function createNodeTransport(o: NodeTransportOptions = {}): Transport {
  const cacheDir = o.cacheDir ?? join(process.cwd(), '.cache', 'gbif');
  const ttlMs = o.ttlMs ?? Number(process.env['GBIF_CACHE_TTL_HOURS'] ?? 168) * HOUR;
  const refresh = o.refresh ?? process.env['GBIF_CACHE_REFRESH'] === '1';
  const limit = pLimit(o.concurrency ?? 5);
  const doFetch = o.fetchImpl ?? fetch;
  const ua = userAgent(o.contact);
  // Shared pause: a Retry-After on any request delays all queued requests.
  let pausedUntil = 0;

  const pathFor = (url: string) => {
    const h = createHash('sha1').update(url).digest('hex');
    return join(cacheDir, h.slice(0, 2), `${h}.json`);
  };

  async function readCache(url: string): Promise<CachedResponse | undefined> {
    if (refresh) return undefined;
    try {
      const c = JSON.parse(await readFile(pathFor(url), 'utf8')) as CachedResponse;
      return Date.now() - c.fetchedAt < ttlMs ? c : undefined;
    } catch {
      return undefined;
    }
  }

  async function writeCache(entry: CachedResponse): Promise<void> {
    const file = pathFor(entry.url);
    await mkdir(join(file, '..'), { recursive: true });
    await writeFile(file, JSON.stringify(entry));
  }

  return async (url, init) => {
    const cached = await readCache(url);
    if (cached) {
      return new Response(cached.body, {
        status: cached.status,
        headers: { 'content-type': cached.contentType, 'x-cache': 'disk' },
      });
    }
    return limit(async () => {
      const wait = pausedUntil - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      const res = await doFetch(url, {
        headers: { 'User-Agent': ua, Accept: 'application/json' },
        ...(init?.signal ? { signal: init.signal } : {}),
      });
      const ms = parseRetryAfter(res.headers.get('retry-after'));
      if (ms) pausedUntil = Math.max(pausedUntil, Date.now() + Math.min(ms, 2 * MINUTE));
      // Cache successes and definitive 404s; never cache throttling or errors.
      if (res.status === 200 || res.status === 404) {
        const body = await res.text();
        const contentType = res.headers.get('content-type') ?? 'application/json';
        await writeCache({ url, status: res.status, contentType, body, fetchedAt: Date.now() });
        return new Response(body, { status: res.status, headers: { 'content-type': contentType } });
      }
      return res;
    });
  };
}
