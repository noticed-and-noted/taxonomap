import type { APIRoute } from 'astro';
import { bakeNames, bakeTree, bakeYears, isBaked } from '~/lib/bake';

/**
 * The baked snapshots the browser loads: records per year (time slider), the name index
 * (search), and kingdom → order with counts (tree; deeper levels load live).
 */
const SNAPSHOTS = { years: bakeYears, names: bakeNames, tree: bakeTree };

type SnapshotName = keyof typeof SNAPSHOTS;

/** Only the snapshots the bake saved: without a file, the browser's loadSnapshot gets a 404 and asks GBIF live. */
export function getStaticPaths() {
  const baked = (Object.keys(SNAPSHOTS) as SnapshotName[]).filter(isBaked);
  return baked.map((snapshot) => ({ params: { snapshot } }));
}

/** One snapshot as JSON. */
export const GET: APIRoute = async ({ params }) => Response.json(await SNAPSHOTS[params['snapshot'] as SnapshotName]());
