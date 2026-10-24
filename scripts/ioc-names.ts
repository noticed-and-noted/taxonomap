/**
 * Rebuild src/lib/species/ioc-names.json: `pnpm ioc-names <VernacularName.tsv>`.
 *
 * The map holds the IOC World Bird List's English name for each bird whose most frequent GBIF
 * name is something else. Frequency comes from `VernacularName.tsv` in GBIF's backbone archive
 * (hosted-datasets.gbif.org/datasets/backbone/current/backbone.zip), so only the IOC checklist
 * itself is fetched. The archive lags the live API, so a few close votes will have flipped since.
 */
import { createReadStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';

import { http, type NameUsage, type Paged, type VernacularName } from '~/lib/gbif/server';
import { isEnglish, mostFrequentEnglishName, tidy } from '~/lib/species/names';

const IOC_DATASET_KEY = 'c696e5ee-9088-4d11-bdae-ab88daffab78';
const PAGE_SIZE = 500;
const OUTPUT_FILE = 'src/lib/species/ioc-names.json';

type IocUsage = NameUsage & { nubKey?: number; vernacularNames?: VernacularName[] };

/** IOC's English name for each backbone key the IOC checklist links to. */
async function iocNamesByKey(): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await http().getJson<Paged<IocUsage>>('/v1/species/search', {
      datasetKey: IOC_DATASET_KEY,
      rank: 'SPECIES',
      limit: PAGE_SIZE,
      offset,
    });
    for (const usage of page.results) {
      const english = usage.vernacularNames?.find(isEnglish);
      if (usage.nubKey && english) names.set(String(usage.nubKey), english.vernacularName);
    }
    if (page.endOfRecords || page.results.length === 0) return names;
  }
}

/** The archive's names for the given keys, read line by line (the file is about 100 MB). */
async function archiveNames(path: string, keys: ReadonlySet<string>): Promise<Map<string, VernacularName[]>> {
  const names = new Map<string, VernacularName[]>();
  const lines = createInterface({ input: createReadStream(path, 'utf8'), crlfDelay: Infinity });
  for await (const line of lines) {
    const [taxonId = '', vernacularName = '', language = ''] = line.split('\t');
    if (!keys.has(taxonId)) continue;
    const name = { vernacularName, language };
    if (!isEnglish(name)) continue;
    names.set(taxonId, [...(names.get(taxonId) ?? []), name]);
  }
  return names;
}

const [archivePath] = process.argv.slice(2);
if (!archivePath) throw new Error('Usage: pnpm ioc-names <path to VernacularName.tsv>');

const iocNames = await iocNamesByKey();
const frequent = await archiveNames(archivePath, new Set(iocNames.keys()));
const differing: Record<string, string> = {};
const byKey = [...iocNames].sort(([left], [right]) => Number(left) - Number(right));
for (const [key, iocName] of byKey) {
  const picked = mostFrequentEnglishName(frequent.get(key) ?? []);
  const tidied = tidy(iocName);
  if (picked?.toLowerCase() !== tidied.toLowerCase()) differing[key] = tidied;
}
await writeFile(OUTPUT_FILE, `${JSON.stringify(differing, null, 2)}\n`);
console.log(`${Object.keys(differing).length} of ${iocNames.size} IOC birds differ; wrote ${OUTPUT_FILE}`);
