import { WEEK } from '~/lib/util/time';
import { http } from './http';
import type { Dataset, Organization } from './types';

/** A dataset's metadata. @throws GbifNotFoundError when GBIF has no such dataset. */
export function getDataset(key: string): Promise<Dataset> {
  return http().getJson(`/v1/dataset/${key}`, undefined, { ttlMs: WEEK });
}

/** Publishing organisation (occurrence records carry only its key). */
export function getOrganization(key: string): Promise<Organization> {
  return http().getJson(`/v1/organization/${key}`, undefined, { ttlMs: WEEK });
}
