/**
 * Generates the static name-search files in public/search-data: `pnpm bake:names --downloads <dir>`.
 * Runs locally: iNaturalist has refused requests from Cloudflare, and GitHub Actions is untested.
 * Every step resumes from the disk cache or .cache/name-search, so a run can be stopped and re-run.
 *
 *   --downloads <dir>  Holds simple.txt.gz and inaturalist-taxonomy.dwca.zip, downloaded by hand.
 *   --top <count>      A trial on only the most recorded candidates, through batches: no GBIF account needed.
 *   --higher           Also bakes previews for the name index's higher ranks, a GBIF search each.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { gzipSync } from 'node:zlib';
import { buildLookup, buildPreviewFiles, buildTopFiles, type SearchTaxon } from '~/lib/bake/name-search/build-files';
import { writeCheckpoint } from '~/lib/bake/name-search/checkpoint';
import { speciesFacet } from '~/lib/bake/name-search/facets';
import { higherRankRows } from '~/lib/bake/name-search/higher';
import {
  confirmByBatch,
  CREDENTIAL_VARIABLES,
  credentialsFromEnv,
  runFullSqlDownload,
  testSqlRoute,
} from '~/lib/bake/name-search/inat-ids';
import {
  defaultPhotoRuleBreaks,
  listTaxa,
  taxonFacts,
  toSpeciesLevel,
  type TaxonFacts,
} from '~/lib/bake/name-search/photos';
import { joinCandidates, readBackbone, readInatNamedSpecies, type BackboneName } from '~/lib/bake/name-search/sources';
import { bakeDir } from '~/lib/bake/cache';
import { RANK_BY_CODE } from '~/lib/data/ranks';
import type { NameRow } from '~/lib/data/types';
import { INATURALIST_DATASET_KEY } from '~/lib/gbif/server';
import { fileBudgetProblems } from '~/lib/name-search/budget';
import { filePath, LOOKUPS, MANIFEST_PATH, PREVIEW_LOOKUP_PATH, SEARCH_DATA_PATH } from '~/lib/name-search/format';
import type { PreviewRow } from '~/lib/name-search/preview';

const OUTPUT_ROOT = 'public';
/** An earlier bake's IDs to compare with. It predates `inatIdsFromRecords`, so it's compared, never reused. */
const SNAPSHOT_TO_COMPARE = '.cache/baked.off/names.json';
const TEST_QUERY_SPECIES = 200;

const report: Record<string, unknown> = {};
let stepStart = Date.now();

/** Records and prints a step's outcome and how long it took. */
function finishStep(step: string, outcome: Record<string, unknown>) {
  const seconds = Math.round((Date.now() - stepStart) / 1000);
  report[step] = { seconds, ...outcome };
  console.log(`${step} (${seconds}s):`, JSON.stringify(outcome));
  stepStart = Date.now();
}

/** Species keys and iNaturalist IDs from the earlier bake. */
async function snapshotIds(): Promise<Map<number, number>> {
  const { names } = JSON.parse(await readFile(SNAPSHOT_TO_COMPARE, 'utf8')) as { names: unknown[][] };
  return new Map(
    names.flatMap((row) => (row[1] === 'S' && row[5] ? [[row[0] as number, row[5] as number] as const] : [])),
  );
}

/** How the confirmed IDs compare with the earlier bake's, and with what the name join suggested. */
async function compareIds(ids: ReadonlyMap<number, number | null>, joined: ReadonlyMap<number, number>) {
  const baked = await snapshotIds();
  const comparable = [...baked].filter(([key]) => ids.get(key));
  const withRecord = [...joined].filter(([key]) => ids.get(key));
  return {
    bakedCompared: comparable.length,
    bakedDisagree: comparable.filter(([key, id]) => ids.get(key) !== id).length,
    joinCandidates: joined.size,
    joinFoundNothing: joined.size - withRecord.length,
    joinFoundDifferent: withRecord.filter(([key, id]) => ids.get(key) !== id).length,
  };
}

/** What confirming the IDs found, and how. */
interface ConfirmedIds {
  ids: Map<number, number | null>;
  route: string;
  doi?: string | undefined;
}

/** Tells the user how to give the SQL step its credentials, and stops. */
function stopForCredentials(downloads: string): never {
  console.error(
    `Set ${CREDENTIAL_VARIABLES.join(' and ')} (your GBIF username, not email, and password) in your shell, ` +
      `then run: pnpm bake:names --downloads ${downloads}`,
  );
  process.exit(2);
}

/** Through SQL where it works; species it can't settle, and everything if it can't work, through batches. */
async function confirmIds(candidates: readonly number[], downloads: string): Promise<ConfirmedIds> {
  const credentials = credentialsFromEnv();
  if (!credentials) stopForCredentials(downloads);
  const known = new Map([...(await snapshotIds())].slice(0, TEST_QUERY_SPECIES));
  const test = await testSqlRoute(known, credentials, downloads);
  finishStep('sqlTest', test);
  if (!test.isUsable) return { ids: await confirmByBatch(candidates), route: 'batches: SQL test failed' };

  const { settled, doi, minutesTaken } = await runFullSqlDownload(credentials, downloads);
  const batched = await confirmByBatch(candidates.filter((key) => settled.several.has(key)));
  const ids = new Map(candidates.map((key) => [key, settled.single.get(key) ?? batched.get(key) ?? null]));
  const { single, several, invalidRows } = settled;
  finishStep('sqlDownload', { minutesTaken, doi, single: single.size, several: several.size, invalidRows });
  return { ids, route: 'sql', doi };
}

/** The most recorded candidates. */
function mostRecordedKeys(candidates: Iterable<number>, counts: ReadonlyMap<number, number>, size: number): number[] {
  return [...candidates].sort((left, right) => (counts.get(right) ?? 0) - (counts.get(left) ?? 0)).slice(0, size);
}

/** The preview rows and common names: only species iNaturalist names. */
function previewRows(ids: ReadonlyMap<number, number>, facts: ReadonlyMap<number, TaxonFacts>) {
  const rows = new Map<number, PreviewRow>();
  const names = new Map<number, string>();
  for (const [key, inatId] of ids) {
    const fact = facts.get(inatId);
    if (!fact?.commonName) continue;
    names.set(key, fact.commonName);
    rows.set(key, { inatId, ...(fact.photo && { photo: fact.photo }) });
  }
  return { rows, names };
}

/** Every file a run writes, by path. */
function plannedFiles(taxa: readonly SearchTaxon[], preview: ReadonlyMap<number, PreviewRow>, doi?: string) {
  const lookups = LOOKUPS.map((lookup) => ({ lookup, ...buildLookup(taxa, lookup) }));
  const top = buildTopFiles(lookups);
  const previews = buildPreviewFiles(preview);
  const manifest = {
    ...Object.fromEntries(lookups.map(({ lookup, firstKeys }) => [lookup, firstKeys])),
    top: top.firstPrefixes,
    generated: new Date().toISOString(),
    ...(doi && { downloadDoi: doi }),
  };
  const files = new Map<string, unknown>([
    [MANIFEST_PATH, manifest],
    [PREVIEW_LOOKUP_PATH, previews.firstKeys],
  ]);
  for (const { lookup, files: columns } of lookups)
    columns.forEach((file, at) => files.set(filePath(lookup, at), file));
  top.files.forEach((file, at) => files.set(filePath('top', at), file));
  previews.files.forEach((file, at) => files.set(filePath('preview', at), file));
  const rowCounts = Object.fromEntries(
    lookups.map(({ lookup, files: columns, rows }) => [lookup, { files: columns.length, rows: rows.length }]),
  );
  return { files, stats: { ...rowCounts, topFiles: top.files.length, previewFiles: previews.files.length } };
}

/** Writes the files under `public/`, after checking they fit the budget. */
async function writeFiles(files: ReadonlyMap<string, unknown>) {
  const texts = [...files].map(([path, content]) => ({ path, text: JSON.stringify(content) }));
  const problems = fileBudgetProblems(texts.map(({ path, text }) => ({ path, bytes: text.length })));
  if (problems.length) throw new Error(problems.join('; '));
  await rm(join(OUTPUT_ROOT, SEARCH_DATA_PATH), { recursive: true, force: true });
  const sizes = { files: 0, bytes: 0, gzippedBytes: 0, largestGzipped: 0, manifestGzipped: 0 };
  for (const { path, text } of texts) {
    const file = join(OUTPUT_ROOT, path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, text);
    const gzipped = gzipSync(text).length;
    sizes.files++;
    sizes.bytes += text.length;
    sizes.gzippedBytes += gzipped;
    sizes.largestGzipped = Math.max(sizes.largestGzipped, gzipped);
    if (path === MANIFEST_PATH) sizes.manifestGzipped = gzipped;
  }
  return sizes;
}

/** Taxa to file: every searchable backbone name, with iNaturalist's common name and GBIF's count where known. */
function searchTaxa(
  backbone: readonly BackboneName[],
  names: ReadonlyMap<number, string>,
  counts: ReadonlyMap<number, number>,
): SearchTaxon[] {
  return backbone.map(({ key, rank, name }) => {
    const commonName = names.get(key);
    return { key, rank, name, count: counts.get(key) ?? 0, ...(commonName && { commonName }) };
  });
}

/** Steps 1 to 3: which species have iNaturalist records and counts, and which are worth looking up. */
async function gatherCandidates(downloads: string) {
  const inatSpecies = await speciesFacet(INATURALIST_DATASET_KEY);
  finishStep('inatSpecies', { species: inatSpecies.counts.size, hitCeiling: inatSpecies.hitCeiling });
  const { counts, hitCeiling } = await speciesFacet();
  finishStep('recordCounts', { species: counts.size, hitCeiling, lowestCount: [...counts.values()].at(-1) });
  const backbone = await readBackbone(join(downloads, 'simple.txt.gz'));
  const named = await readInatNamedSpecies(join(downloads, 'inaturalist-taxonomy.dwca.zip'));
  const joined = joinCandidates(backbone, new Set(inatSpecies.counts.keys()), named);
  finishStep('candidates', { backboneNames: backbone.length, inatNamedNames: named.size, candidates: joined.size });
  return { counts, backbone, joined };
}

/** Steps 5 to 7: each confirmed species' taxon at species level, its name and its lead photo. */
async function gatherPhotos(ids: ReadonlyMap<number, number | null>) {
  const recordIds = new Map([...ids].flatMap(([key, id]) => (id ? [[key, id] as const] : [])));
  const speciesIds = await toSpeciesLevel(recordIds, await listTaxa(recordIds.values()));
  const listed = await listTaxa(speciesIds.values());
  const movedToSpecies = [...recordIds].filter(([key, id]) => speciesIds.get(key) !== id).length;
  finishStep('listTaxa', { taxa: listed.size, movedToSpecies });

  const breaks = await defaultPhotoRuleBreaks(listed);
  if (breaks.length) throw new Error(`Default photo isn't the first open curated photo for: ${breaks.join(', ')}`);
  const { facts, curatedRequests } = await taxonFacts([...new Set(speciesIds.values())], listed);
  const unbakeable = [...facts.values()].filter((fact) => fact.hasUnbakeablePhoto).length;
  finishStep('photos', { curatedRequests, unbakeable, ruleBreaks: 0 });
  return previewRows(speciesIds, facts);
}

/** The name index's higher ranks, from the last `pnpm bake`, else the earlier bake. */
async function indexedHigherTaxa() {
  const latest = join(bakeDir(), 'names.json');
  const file = existsSync(latest) ? latest : SNAPSHOT_TO_COMPARE;
  const { names } = JSON.parse(await readFile(file, 'utf8')) as { names: NameRow[] };
  return names.filter((row) => row[1] !== 'S').map((row) => ({ key: row[0], rank: RANK_BY_CODE[row[1]] }));
}

/** The optional step: adds higher ranks' rows to the species' preview rows. */
async function addHigherRanks(rows: Map<number, PreviewRow>) {
  const taxa = await indexedHigherTaxa();
  const higher = await higherRankRows(taxa);
  for (const [key, row] of higher) rows.set(key, row);
  const withPhoto = [...higher.values()].filter((row) => row.photo).length;
  finishStep('higherRanks', { taxa: taxa.length, matched: higher.size, withPhoto });
}

/** Runs every step in turn. */
async function run(downloads: string, top: number | undefined, withHigherRanks: boolean) {
  const { counts, backbone, joined } = await gatherCandidates(downloads);
  const toConfirm = top ? mostRecordedKeys(joined.keys(), counts, top) : [...joined.keys()];
  const confirmed: ConfirmedIds = top
    ? { ids: await confirmByBatch(toConfirm), route: `batches: trial of the top ${top}` }
    : await confirmIds(toConfirm, downloads);
  const lookedUp = new Map(toConfirm.map((key) => [key, joined.get(key)!]));
  finishStep('confirmIds', { route: confirmed.route, ...(await compareIds(confirmed.ids, lookedUp)) });

  const { rows, names } = await gatherPhotos(confirmed.ids);
  if (withHigherRanks) await addHigherRanks(rows);
  const { files, stats } = plannedFiles(searchTaxa(backbone, names, counts), rows, confirmed.doi);
  const sizes = await writeFiles(files);
  const withPhoto = [...rows.values()].filter((row) => row.photo).length;
  finishStep('write', { named: rows.size, withPhoto, searchable: backbone.length, ...stats, ...sizes });
  await writeCheckpoint('report', report);
}

const { values } = parseArgs({
  options: { downloads: { type: 'string' }, top: { type: 'string' }, higher: { type: 'boolean' } },
});
if (!values.downloads) throw new Error('Pass --downloads <dir>: see the top of scripts/bake-names.ts');
await run(values.downloads, values.top ? Number(values.top) : undefined, !!values.higher);
