/**
 * Whether a species migrates, from the EOL trait data matched once to GBIF keys (`src/data/migration/`). The table
 * loads on first use, as its own small file, so only a search in Analyse pays for it.
 */
import type { AnalyseTag } from './starting-species';

/** A species' status in the table (see the README beside it). */
export type MigrationStatus =
  'migratory' | 'nonmigratory' | 'partial' | 'oceanodromous' | 'amphidromous' | 'anadromous' | 'catadromous';

let table: Promise<Readonly<Record<string, MigrationStatus>>> | undefined;

/** The table, loaded once. */
function loadTable() {
  table ??= import('~/data/migration/migration.json').then(
    (module) => module.default as Readonly<Record<string, MigrationStatus>>,
  );
  return table;
}

/** The tag a status earns: fish patterns count as migrating; species that don't migrate get none. */
export function migrationTag(status: MigrationStatus | undefined): AnalyseTag | undefined {
  if (!status || status === 'nonmigratory') return undefined;
  return status === 'partial' ? 'Partly migrates' : 'Migrates';
}

/** The migration tags for those of `keys` the table knows. */
export async function migrationTags(keys: readonly number[]): Promise<Map<number, AnalyseTag>> {
  const statuses = await loadTable();
  const tags = new Map<number, AnalyseTag>();
  for (const key of keys) {
    const tag = migrationTag(statuses[String(key)]);
    if (tag) tags.set(key, tag);
  }
  return tags;
}
