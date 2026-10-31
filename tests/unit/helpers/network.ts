/**
 * A fake network for modules that call fetch (the GBIF client's default
 * transport, baked /data snapshots, geocoders). Each request is routed to
 * `handler` with its parsed URL; return a body (sent as JSON) or a Response.
 * Relative URLs (/data/…) resolve against http://site.test.
 */
import type { NameRow, TreeNodeRow } from '~/lib/data/types';

export type Handler = (url: URL, requestInit?: RequestInit) => unknown;

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export function stubNetwork(handler: Handler): URL[] {
  const calls: URL[] = [];
  vi.stubGlobal('fetch', async (raw: string | URL, requestInit?: RequestInit) => {
    const url = new URL(String(raw), 'http://site.test');
    calls.push(url);
    if (requestInit?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const out = await handler(url, requestInit);
    if (out instanceof Response) return out;
    if (out === undefined) return json({ message: 'not found' }, 404);
    return json(out);
  });
  return calls;
}

/** Baked snapshots, as served from /data. */
export function snapshots(data: { names?: NameRow[]; tree?: TreeNodeRow[] }) {
  return (url: URL): unknown => {
    if (url.pathname === '/data/names.json') return data.names && { v: 1, generated: '', names: data.names };
    if (url.pathname === '/data/tree.json') return data.tree && { v: 1, generated: '', nodes: data.tree };
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
  facets: [{ field, counts: counts.map(([name, total]) => ({ name: String(name), count: total })) }],
});

/** All values of a repeated query parameter, as numbers. */
export const nums = (url: URL, key: string) => url.searchParams.getAll(key).map(Number);

/** A GBIF GraphQL facet response for one field; a row's third value is its taxon's name. */
export const namedFacets = (total: number, field: string, buckets: [string | number, number, string?][]) => ({
  data: {
    occurrenceSearch: {
      documents: { total },
      facet: {
        [field]: buckets.map(([key, count, name]) => ({
          key: String(key),
          count,
          taxon: name ? { scientificName: name } : null,
        })),
      },
    },
  },
});

/** Whether a request is a GraphQL query. */
export const isGraphql = (url: URL) => url.pathname === '/graphql';

/** The flat `{ key: values }` of a GraphQL request's predicate (its top-level `equals` and `in` parts). */
export function predicateOf(url: URL): Record<string, string[]> {
  const { predicate } = JSON.parse(url.searchParams.get('variables') ?? '{}') as {
    predicate?: { predicates?: { key?: string; value?: string; values?: string[] }[] };
  };
  const parts = (predicate?.predicates ?? []).filter((part) => part.key);
  return Object.fromEntries(parts.map((part) => [part.key!, part.values ?? [part.value!]]));
}
