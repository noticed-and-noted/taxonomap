/**
 * Optional edge cache (a caching proxy in front of GBIF) with automatic
 * fallback. When PUBLIC_GBIF_API_BASE / PUBLIC_GBIF_TILE_BASE point at the
 * proxy and it fails (quota exceeded, outage, network error), requests go
 * straight to GBIF for a cool-down period, so users never notice.
 *
 * A failure is "the edge's fault" when the response lacks the Worker's
 * proxy's x-gbif-edge header (a platform error page) or the request
 * never completed. GBIF errors relayed by the proxy carry the header and
 * are handled by normal retry/back-off instead.
 */
import { MINUTE } from '~/lib/util/time';
import { GBIF_API_BASE, GBIF_FALLBACK_BASE, GBIF_TILE_BASE } from './config';

export const EDGE_HEADER = 'x-gbif-edge';
const COOL_DOWN_MS = 5 * MINUTE;

let downUntil = 0;
const listeners = new Set<() => void>();

/** True when a base other than GBIF itself is configured. */
export function edgeConfigured(): boolean {
  return GBIF_API_BASE !== GBIF_FALLBACK_BASE || GBIF_TILE_BASE !== GBIF_FALLBACK_BASE;
}

export function edgeAvailable(now = Date.now()): boolean {
  return edgeConfigured() && now >= downUntil;
}

export function apiBase(): string {
  return edgeAvailable() ? GBIF_API_BASE : GBIF_FALLBACK_BASE;
}

export function tileBase(): string {
  return edgeAvailable() ? GBIF_TILE_BASE : GBIF_FALLBACK_BASE;
}

/** Bypass the edge for a while; notifies listeners (e.g. the map re-sets tile URLs). */
export function markEdgeDown(now = Date.now()): void {
  if (!edgeConfigured() || now < downUntil) return;
  downUntil = now + COOL_DOWN_MS;
  listeners.forEach((fn) => fn());
  setTimeout(() => listeners.forEach((fn) => fn()), COOL_DOWN_MS + 50);
}

export function onEdgeChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Whether a URL was addressed to the edge rather than to GBIF directly. */
export function isEdgeUrl(url: string): boolean {
  if (!edgeConfigured()) return false;
  return (
    (GBIF_API_BASE !== GBIF_FALLBACK_BASE && url.startsWith(GBIF_API_BASE)) ||
    (GBIF_TILE_BASE !== GBIF_FALLBACK_BASE && url.startsWith(GBIF_TILE_BASE))
  );
}

/** Response-level check: did this come from our Worker? */
export function servedByEdge(res: Response): boolean {
  return res.headers.has(EDGE_HEADER);
}

/** Test helper. */
export function __resetEdge(): void {
  downUntil = 0;
  listeners.clear();
}
