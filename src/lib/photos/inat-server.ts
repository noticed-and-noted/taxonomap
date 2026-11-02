/**
 * Build-time entry point for iNaturalist (Node only). Importing this module puts the on-disk
 * response cache in front of the client, so a re-bake re-asks iNaturalist for nothing it already
 * answered. Use it from the bakers, never from islands.
 */
import { join } from 'node:path';
import { withDiskCache } from '~/lib/gbif/node-transport';
import { configureInat } from './inat';

configureInat((throttled) => withDiskCache(throttled, { cacheDir: join(process.cwd(), '.cache', 'inat') }));

export * from './inat';
