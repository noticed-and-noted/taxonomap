/**
 * Request meter: counts requests the page makes to GBIF, by kind, so
 * per-session load can be measured. These are upper bounds, since some are
 * answered by the browser's service worker cache. Shown in dev, or with
 * ?debug=requests.
 */
import { map } from 'nanostores';

export type RequestKind = 'tile' | 'json' | 'image';

export interface RequestCounts {
  tile: number;
  json: number;
  image: number;
  startedAt: number;
}

const fresh = (): RequestCounts => ({ tile: 0, json: 0, image: 0, startedAt: Date.now() });

export const $requestCounts = map<RequestCounts>(fresh());

export function countRequest(kind: RequestKind): void {
  const c = $requestCounts.get();
  $requestCounts.setKey(kind, c[kind] + 1);
}

export function resetRequestCounts(): void {
  $requestCounts.set(fresh());
}
