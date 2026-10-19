/** Refuse to run against a build of the live site: the journeys expect the fake world's data. */
import { readFile } from 'node:fs/promises';

export default async function globalSetup() {
  const manifest = await readFile('dist/data/species-manifest.json', 'utf8').catch(() => '');
  if (!manifest.includes('"2490719"')) {
    throw new Error('dist/ is not an e2e build. Run `pnpm build:e2e` first (it builds against tests/e2e/fake).');
  }
}
