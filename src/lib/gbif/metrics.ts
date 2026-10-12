/**
 * Request meter: counts requests the page makes to GBIF (or the edge), by
 * kind, so per-session load can be measured. These are upper bounds for
 * edge/Worker requests, since some are answered by the browser's service
 * worker cache. Shown in dev, or with ?debug=requests.
 */
import { map } from 'nanostores';
import { isEdgeUrl } from './edge';

export type RequestKind = 'tile' | 'json' | 'image';

export interface RequestCounts {
  tile: number;
  json: number;
  image: number;
  /** Requests addressed to the edge (vs GBIF directly). */
  edge: number;
  startedAt: number;
}

const fresh = (): RequestCounts => ({ tile: 0, json: 0, image: 0, edge: 0, startedAt: Date.now() });

export const $requestCounts = map<RequestCounts>(fresh());

export function countRequest(kind: RequestKind, url: string): void {
  const c = $requestCounts.get();
  $requestCounts.setKey(kind, c[kind] + 1);
  if (isEdgeUrl(url)) $requestCounts.setKey('edge', c.edge + 1);
}

export function resetRequestCounts(): void {
  $requestCounts.set(fresh());
}
