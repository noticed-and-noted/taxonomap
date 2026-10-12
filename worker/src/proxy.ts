/**
 * GBIF edge cache: core logic, free of Workers-specific globals so it can
 * be unit-tested in Node (cache and fetch are injected).
 *
 * - Only GET requests to an allowlist of GBIF paths are proxied.
 * - Query strings are normalised (sorted, empties dropped) so equivalent
 *   requests share one cache entry.
 * - Each entry has a "fresh" period and a longer "stale" period. Stale
 *   entries are served immediately while one background request
 *   revalidates them, and they are also served if GBIF fails
 *   (stale-while-revalidate + stale-if-error at the edge).
 * - Upstream requests carry an identifying User-Agent.
 */

export interface EdgeEnv {
  /** Upstream origin, normally https://api.gbif.org */
  UPSTREAM?: string;
  /** Contact address for the User-Agent sent to GBIF. */
  CONTACT_EMAIL?: string;
  /** Comma-separated allowed browser origins, or "*". */
  ALLOWED_ORIGINS?: string;
}

export interface EdgeDeps {
  cache: Pick<Cache, 'match' | 'put'>;
  fetch: (req: Request) => Promise<Response>;
  waitUntil: (p: Promise<unknown>) => void;
  now?: () => number;
}

export const EDGE_HEADER = 'x-gbif-edge';
const STORED_AT = 'x-edge-stored-at';
const VERSION = '1.0.0';

const HOUR = 3600;
const DAY = 24 * HOUR;

export interface Policy {
  /** Seconds an entry is served without revalidation. */
  fresh: number;
  /** Seconds an entry may be served stale (and kept in the cache). */
  stale: number;
  /** Browser max-age for the response. */
  browser: number;
}

/** Allowlisted GBIF paths and their cache policy. First match wins. */
const RULES: [RegExp, Policy][] = [
  [/^\/v2\/map\/occurrence\/(density|adhoc)\/capabilities\.json$/, { fresh: 6 * HOUR, stale: 2 * DAY, browser: HOUR }],
  [
    /^\/v2\/map\/occurrence\/(density|adhoc)\/\d+\/\d+\/\d+(@\dx)?\.(png|mvt)$/,
    { fresh: DAY, stale: 7 * DAY, browser: HOUR },
  ],
  [
    /^\/v1\/image\/cache\/[\w-]+(\/[\w-]+)?\/occurrence\/\d+\/media\/[0-9a-f]{32}$/,
    { fresh: 30 * DAY, stale: 90 * DAY, browser: 7 * DAY },
  ],
  [/^\/v1\/occurrence\/search$/, { fresh: 6 * HOUR, stale: 3 * DAY, browser: 600 }],
  [/^\/v1\/occurrence\/\d+$/, { fresh: DAY, stale: 7 * DAY, browser: HOUR }],
  [/^\/v[12]\/species(\/[\w-]+){0,2}$/, { fresh: 7 * DAY, stale: 30 * DAY, browser: HOUR }],
  [/^\/v1\/(dataset|organization)\/[0-9a-f-]{36}$/, { fresh: 7 * DAY, stale: 30 * DAY, browser: HOUR }],
];

export function policyFor(path: string): Policy | null {
  for (const [re, p] of RULES) if (re.test(path)) return p;
  return null;
}

/** Sorted, de-duplicated query string with empty values dropped. */
export function normaliseQuery(params: URLSearchParams): string {
  const pairs = [...params].filter(([, v]) => v !== '');
  const unique = [...new Set(pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`))];
  return unique.sort().join('&');
}

function allowedOrigins(env: EdgeEnv): string[] | '*' {
  const raw = (env.ALLOWED_ORIGINS ?? '*').trim();
  if (raw === '*' || raw === '') return '*';
  return raw
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

function corsHeaders(origin: string | null, env: EdgeEnv): Record<string, string> {
  const allowed = allowedOrigins(env);
  const h: Record<string, string> = {
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-expose-headers': EDGE_HEADER,
    'access-control-max-age': '86400',
  };
  if (allowed === '*') h['access-control-allow-origin'] = '*';
  else if (origin && allowed.includes(origin)) {
    h['access-control-allow-origin'] = origin;
    h['vary'] = 'Origin';
  }
  return h;
}

function originAllowed(req: Request, path: string, env: EdgeEnv): boolean {
  const allowed = allowedOrigins(env);
  if (allowed === '*') return true;
  const origin = req.headers.get('origin');
  // <img> requests carry no Origin; only thumbnails are fetched that way.
  if (!origin) return path.startsWith('/v1/image/cache/');
  return allowed.includes(origin);
}

function text(status: number, body: string, extra: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', [EDGE_HEADER]: 'REJECT', ...extra },
  });
}

/** Per-isolate dedupe of concurrent upstream fetches for the same key. */
const inflight = new Map<string, Promise<Response>>();

export function userAgent(env: EdgeEnv): string {
  return `GBIFExplorer-edge/${VERSION} (contact: ${env.CONTACT_EMAIL || 'unset'})`;
}

async function fetchUpstream(
  url: string,
  key: string,
  policy: Policy,
  env: EdgeEnv,
  deps: EdgeDeps,
): Promise<Response> {
  let p = inflight.get(key);
  if (!p) {
    p = (async () => {
      const res = await deps.fetch(
        new Request(url, { headers: { 'user-agent': userAgent(env), accept: '*/*' }, redirect: 'follow' }),
      );
      if (res.status === 200) {
        // Store a copy with our timestamp; Cloudflare keeps it until the stale limit.
        const stored = new Response(res.clone().body, res);
        stored.headers.set(STORED_AT, String((deps.now ?? Date.now)()));
        stored.headers.set('cache-control', `public, s-maxage=${policy.stale}`);
        stored.headers.delete('set-cookie');
        deps.waitUntil(deps.cache.put(key, stored));
      }
      return res;
    })().finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return (await p).clone();
}

function finalise(
  res: Response,
  state: 'HIT' | 'MISS' | 'STALE' | 'BYPASS',
  policy: Policy,
  cors: Record<string, string>,
): Response {
  const out = new Response(res.body, res);
  out.headers.delete(STORED_AT);
  out.headers.delete('set-cookie');
  for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
  out.headers.set(EDGE_HEADER, state);
  if (res.status === 200) out.headers.set('cache-control', `public, max-age=${policy.browser}`);
  else out.headers.set('cache-control', 'no-store');
  return out;
}

export async function handle(req: Request, env: EdgeEnv, deps: EdgeDeps): Promise<Response> {
  const url = new URL(req.url);
  const origin = req.headers.get('origin');
  const cors = corsHeaders(origin, env);

  if (req.method === 'OPTIONS')
    return new Response(null, { status: 204, headers: { ...cors, [EDGE_HEADER]: 'PREFLIGHT' } });
  if (req.method !== 'GET') return text(405, 'Method not allowed', { allow: 'GET, OPTIONS', ...cors });

  if (url.pathname === '/' || url.pathname === '/health') {
    return text(200, 'GBIF Explorer edge cache', { ...cors, [EDGE_HEADER]: 'HEALTH' });
  }

  const policy = policyFor(url.pathname);
  if (!policy) return text(404, 'Path is not proxied', cors);
  if (!originAllowed(req, url.pathname, env)) return text(403, 'Origin not allowed', cors);

  const qs = normaliseQuery(url.searchParams);
  const upstream = `${(env.UPSTREAM ?? 'https://api.gbif.org').replace(/\/+$/, '')}${url.pathname}${qs ? `?${qs}` : ''}`;
  const key = `${url.origin}${url.pathname}${qs ? `?${qs}` : ''}`;
  const now = (deps.now ?? Date.now)();

  const cached = await deps.cache.match(key);
  if (cached) {
    const storedAt = Number(cached.headers.get(STORED_AT) ?? 0);
    const age = (now - storedAt) / 1000;
    if (age < policy.fresh) return finalise(cached, 'HIT', policy, cors);
    if (age < policy.stale) {
      // Serve stale now; refresh in the background (errors keep the stale copy).
      deps.waitUntil(fetchUpstream(upstream, key, policy, env, deps).catch(() => undefined));
      return finalise(cached, 'STALE', policy, cors);
    }
  }

  try {
    const res = await fetchUpstream(upstream, key, policy, env, deps);
    return finalise(res, res.status === 200 ? 'MISS' : 'BYPASS', policy, cors);
  } catch {
    return text(502, 'GBIF is unreachable', cors);
  }
}
