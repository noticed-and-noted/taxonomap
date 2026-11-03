/**
 * The downloaded taxonomies, read line by line (Node only). Both are untrusted data: only rows with
 * numeric IDs and known ranks are kept, and names only ever become strings in JSON.
 */
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import { RANK_CODES, type SearchRankCode } from '~/lib/name-search/format';

const BACKBONE_NULL = '\\N';
const COLUMN = { key: 0, status: 4, rank: 5, kingdomKey: 10, scientificName: 18, canonicalName: 19 } as const;

/** DNA-barcode placeholders, not names anyone searches for: 608,000 `BOLD:` and 356,813 `SH…FU` when measured. */
const PLACEHOLDER_NAME = /^(BOLD:|SH\d+\.\d+FU$)/;

const CODE_BY_RANK = new Map(
  Object.entries(RANK_CODES).map(([code, rank]) => [rank as string, code as SearchRankCode]),
);

/** An accepted, searchable name from GBIF's backbone. */
export interface BackboneName {
  key: number;
  rank: SearchRankCode;
  name: string;
  kingdomKey: number;
}

/** A backbone line as a name, or null for anything not accepted, a placeholder or of a rank the files don't hold. */
export function parseBackboneLine(line: string): BackboneName | null {
  const fields = line.split('\t');
  if (fields[COLUMN.status] !== 'ACCEPTED') return null;
  const canonical = fields[COLUMN.canonicalName];
  const name = canonical && canonical !== BACKBONE_NULL ? canonical : fields[COLUMN.scientificName];
  const rank = CODE_BY_RANK.get(fields[COLUMN.rank] ?? '');
  const key = Number(fields[COLUMN.key]);
  if (!name || !rank || !Number.isInteger(key) || PLACEHOLDER_NAME.test(name)) return null;
  return { key, rank, name, kingdomKey: Number(fields[COLUMN.kingdomKey]) };
}

/** Every searchable name in the gzipped backbone at `path`. */
export async function readBackbone(path: string): Promise<BackboneName[]> {
  const names: BackboneName[] = [];
  const lines = createInterface({ input: createReadStream(path).pipe(createGunzip()), crlfDelay: Infinity });
  for await (const line of lines) {
    const parsed = parseBackboneLine(line);
    if (parsed) names.push(parsed);
  }
  return names;
}

/** The fields of one CSV line. Quoted fields may hold commas and doubled quotes. */
export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = '';
  let isQuoted = false;
  for (let position = 0; position < line.length; position++) {
    const character = line[position];
    if (character === '"' && isQuoted && line[position + 1] === '"') {
      field += '"';
      position++;
    } else if (character === '"') isQuoted = !isQuoted;
    else if (character === ',' && !isQuoted) {
      fields.push(field);
      field = '';
    } else field += character;
  }
  fields.push(field);
  return fields;
}

/** The lines of one file inside a zip, through the system's `unzip`. */
export async function* zipEntryLines(zipPath: string, entry: string): AsyncGenerator<string> {
  const unzip = spawn('unzip', ['-p', zipPath, entry], { stdio: ['ignore', 'pipe', 'inherit'] });
  yield* createInterface({ input: unzip.stdout, crlfDelay: Infinity });
}

const TAXA_COLUMN = { id: 0, kingdom: 4, scientificName: 13, rank: 14 } as const;

/** A species iNaturalist's download gives an English name. The name itself isn't used: the app's differ. */
export interface InatNamedSpecies {
  id: number;
  kingdom: string;
}

/** IDs with an English name, from iNaturalist's download. */
async function idsWithEnglishNames(zipPath: string): Promise<Set<number>> {
  const ids = new Set<number>();
  for await (const line of zipEntryLines(zipPath, 'VernacularNames-english.csv')) {
    const id = Number(line.slice(0, line.indexOf(',')));
    if (Number.isInteger(id) && id > 0) ids.add(id);
  }
  return ids;
}

/** iNaturalist's species with English names, by exact scientific name. */
export async function readInatNamedSpecies(zipPath: string): Promise<Map<string, InatNamedSpecies[]>> {
  const named = await idsWithEnglishNames(zipPath);
  const byName = new Map<string, InatNamedSpecies[]>();
  for await (const line of zipEntryLines(zipPath, 'taxa.csv')) {
    const fields = parseCsvLine(line);
    const id = Number(fields[TAXA_COLUMN.id]);
    const name = fields[TAXA_COLUMN.scientificName];
    if (fields[TAXA_COLUMN.rank] !== 'species' || !name || !named.has(id)) continue;
    const species = { id, kingdom: fields[TAXA_COLUMN.kingdom] ?? '' };
    byName.set(name, [...(byName.get(name) ?? []), species]);
  }
  return byName;
}

/**
 * Which species to look up: those with iNaturalist records whose name matches a named iNaturalist
 * species. Only a filter, as a name match alone isn't trustworthy; kingdom separates homonyms.
 * @returns GBIF species key → the iNaturalist ID its name suggests.
 */
export function joinCandidates(
  backbone: readonly BackboneName[],
  inatSpeciesKeys: ReadonlySet<number>,
  namedSpecies: ReadonlyMap<string, InatNamedSpecies[]>,
): Map<number, number> {
  const kingdoms = new Map(backbone.filter((name) => name.rank === 'K').map((name) => [name.key, name.name]));
  const candidates = new Map<number, number>();
  for (const { key, rank, name, kingdomKey } of backbone) {
    if (rank !== 'S' || !inatSpeciesKeys.has(key)) continue;
    const matches = namedSpecies.get(name) ?? [];
    const match = matches.length > 1 ? matches.find((one) => one.kingdom === kingdoms.get(kingdomKey)) : matches[0];
    if (match) candidates.set(key, match.id);
  }
  return candidates;
}
