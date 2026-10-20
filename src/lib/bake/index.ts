/**
 * Build-time data baking (Node only). Each baker is used by a static endpoint in
 * src/pages/data/ and memoised so several pages can share one result within a build.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { bakeDir, startFreshBake } from './cache';
import { bakeNames } from './names';
import { bakeSpeciesList } from './species-list';
import { bakeTree } from './tree';
import { bakeYears } from './years';

export { bakedCommonNames, bakeNames } from './names';
export { bakeSpeciesList, bakeSpeciesManifest, prerenderCount, type PrerenderSpecies } from './species-list';
export { bakeTree } from './tree';
export { bakeYears } from './years';

/**
 * The `pnpm bake` command: fetch everything the build bakes and save it for later builds.
 * @returns The names of the snapshots written.
 */
export async function bakeToDisk(): Promise<string[]> {
  startFreshBake();
  const dir = bakeDir();
  await mkdir(dir, { recursive: true });
  const snapshots = { years: bakeYears, names: bakeNames, tree: bakeTree, 'species-list': bakeSpeciesList };
  for (const [key, bake] of Object.entries(snapshots)) {
    await writeFile(join(dir, `${key}.json`), JSON.stringify(await bake()));
  }
  return Object.keys(snapshots);
}
