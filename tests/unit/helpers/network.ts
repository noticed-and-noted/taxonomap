/**
 * A fake network for modules that call fetch (the GBIF client's default
 * transport, baked /data snapshots, geocoders). Each request is routed to
 * `handler` with its parsed URL; return a body (sent as JSON) or a Response.
 * Relative URLs (/data/…) resolve against http://site.test.
 */
import type { NameRow, TreeNodeRow } from '~/lib/data/types';

export type Handler = (url: URL, init?: RequestInit) => unknown;

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export function stubNetwork(handler: Handler): URL[] {
  const calls: URL[] = [];
  vi.stubGlobal('fetch', async (raw: string | URL, init?: RequestInit) => {
    const url = new URL(String(raw), 'http://site.test');
    calls.push(url);
    if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const out = await handler(url, init);
    if (out instanceof Response) return out;
    if (out === undefined) return json({ message: 'not found' }, 404);
    return json(out);
  });
  return calls;
}

/** Baked snapshots, as served from /data. */
export function snapshots(s: { names?: NameRow[]; tree?: TreeNodeRow[] }) {
  return (url: URL): unknown => {
    if (url.pathname === '/data/names.json') return s.names && { v: 1, generated: '', names: s.names };
    if (url.pathname === '/data/tree.json') return s.tree && { v: 1, generated: '', nodes: s.tree };
    return undefined;
  };
}

/** A GBIF facet response for one field. */
export const facets = (count: number, field: string, counts: [string | number, number][]) => ({
  offset: 0,
  limit: 0,
  endOfRecords: true,
  count,
  results: [],
  facets: [{ field, counts: counts.map(([name, n]) => ({ name: String(name), count: n })) }],
});

/** All values of a repeated query parameter, as numbers. */
export const nums = (url: URL, key: string) => url.searchParams.getAll(key).map(Number);
