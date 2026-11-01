/**
 * Build-time data baking (Node only). Each baker is used by a static endpoint in
 * src/pages/data/ and memoised so several pages can share one result within a build.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { bakeDir, bakeProgress, startFreshBake } from './cache';
import { bakeNames } from './names';
import { bakeSpeciesList } from './species-list';
import { bakeTree } from './tree';
import { bakeYears } from './years';

export { bakedCommonNames, bakeNames } from './names';
export { bakeProgress } from './cache';
export { bakeSpeciesList, bakeSpeciesManifest, prerenderCount, type PrerenderSpecies } from './species-list';
export { bakeTree } from './tree';
export { bakeYears } from './years';

/**
 * The `pnpm bake` command: fetch everything the build bakes and save it for later builds.
 * @param onStep Called with each snapshot's name as it starts.
 * @returns The names of the snapshots written.
 */
export async function bakeToDisk(onStep?: (key: string) => void): Promise<string[]> {
  startFreshBake();
  const dir = bakeDir();
  await mkdir(dir, { recursive: true });
  // The species list before the names, which index every species with a page; the tree reads the names.
  const snapshots = { years: bakeYears, 'species-list': bakeSpeciesList, names: bakeNames, tree: bakeTree };
  for (const [key, bake] of Object.entries(snapshots)) {
    // Each step's progress bar starts from zero.
    bakeProgress.clear();
    onStep?.(key);
    await writeFile(join(dir, `${key}.json`), JSON.stringify(await bake()));
  }
  return Object.keys(snapshots);
}
