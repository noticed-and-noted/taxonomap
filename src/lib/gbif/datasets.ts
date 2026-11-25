import { WEEK } from '~/lib/util/time';
import { http } from './http';
import type { Organization } from './types';

/** Publishing organisation (occurrence records carry only its key). */
export function getOrganization(key: string): Promise<Organization> {
  return http().getJson(`/v1/organization/${key}`, undefined, { ttlMs: WEEK });
}
