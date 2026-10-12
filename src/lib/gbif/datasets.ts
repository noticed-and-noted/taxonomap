import { http } from './http';
import type { Dataset } from './types';

export function getDataset(key: string): Promise<Dataset> {
  return http().getJson(`/v1/dataset/${key}`, undefined, { ttlMs: 7 * 24 * 3_600_000 });
}
