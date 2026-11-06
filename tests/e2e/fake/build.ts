/**
 * Bake and build the site against the fake world, for the journeys: `pnpm build:e2e`.
 * Every base URL points at the fake server, so the baked data, the species
 * pages and the browser's requests all come from world.ts.
 */
import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { startFake } from './server.ts';
import { FAKE_BASE } from './world.ts';

const E2E_BAKE_DIR = '.cache/e2e-bake';

/** Runs a command with the fake world's environment; resolves its exit code. */
function run(command: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { env, stdio: 'inherit' });
    child.on('exit', (exitCode) => resolve(exitCode ?? 1));
  });
}

const server = await startFake();
const env = {
  ...process.env,
  PUBLIC_GBIF_API_BASE: FAKE_BASE,
  PUBLIC_GBIF_TILE_BASE: FAKE_BASE,
  PUBLIC_GBIF_GRAPHQL_BASE: FAKE_BASE,
  // The bake's iNaturalist requests too, so the baked names never depend on the live site.
  PUBLIC_INAT_API_BASE: `${FAKE_BASE}/inat`,
  PUBLIC_BASEMAP_PLAIN_DARK: `${FAKE_BASE}/basemap/dark.json`,
  PUBLIC_BASEMAP_PLAIN_LIGHT: `${FAKE_BASE}/basemap/light.json`,
  PUBLIC_BASEMAP_SATELLITE: `${FAKE_BASE}/basemap/satellite/{z}/{y}/{x}.png`,
  PUBLIC_GEOCODER: 'nominatim',
  PUBLIC_GEOCODER_URL: `${FAKE_BASE}/geocode`,
  // One pre-rendered species page (the blackbird), the whole (tiny) name index, and no stale disk cache.
  SPECIES_PRERENDER_COUNT: '1',
  NAME_INDEX_SIZE: '20',
  GBIF_CACHE_REFRESH: '1',
  // A bake of its own, never the data a local `pnpm bake` left behind.
  BAKE_DIR: E2E_BAKE_DIR,
  ASTRO_TELEMETRY_DISABLED: '1',
  // Sourcemaps let the journeys' coverage (`pnpm test:e2e:coverage`) map back to src/.
  E2E_SOURCEMAP: '1',
};
await rm(E2E_BAKE_DIR, { recursive: true, force: true });
const bakeCode = await run('npx', ['tsx', 'scripts/bake.ts']);
const code = bakeCode || (await run('npx', ['astro', 'build']));
server.close();
process.exit(code);
