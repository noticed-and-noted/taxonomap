/**
 * Names for the species in the cell's record list and its species filter. The
 * cell's species table names few species, so names are looked up as rows and
 * options appear, a batch at a time, and shared between the two.
 */
import { computed, shallowRef, type Ref } from 'vue';
import type { Occurrence, Rank } from '~/lib/gbif';
import { aboutKey, aboutRank, recordScientificName } from '~/lib/record-fields';
import { commonNames as lookupCommonNames, resolveNames, type SpeciesRow } from '~/lib/species/groups';
import { tidy } from '~/lib/species/names';

/** Common names looked up per request batch, so they appear as they arrive. */
const NAME_BATCH = 20;

/** Splits keys into request-sized batches. */
function batches<T>(keys: readonly T[]): T[][] {
  const groups: T[][] = [];
  for (let start = 0; start < keys.length; start += NAME_BATCH) groups.push(keys.slice(start, start + NAME_BATCH));
  return groups;
}

/**
 * Applies a batch of looked-up names to the page.
 * @param nameless The keys that turned out to have no common name, whose scientific name takes the name's place.
 * @param update Shows the names; call it exactly once (inside a view transition, say).
 */
export type ApplyNames = (nameless: readonly number[], update: () => void) => void | Promise<void>;

const applyAtOnce: ApplyNames = (_nameless, update) => update();

/**
 * Common names looked up for taxa the table hasn't named, and which rows still wait for their first lookup.
 * @param tableNames The common names the table already has, by species key.
 * @param applyNames How each batch of names reaches the page.
 */
function useCommonNameLookups(tableNames: Ref<ReadonlyMap<number, string>>, applyNames: ApplyNames) {
  /** Common names looked up for species the table hasn't named. */
  const lateNames = shallowRef(new Map<number, string>());
  /** Keys looked up for the first time and not back yet: their rows hold the name's place. */
  const namingKeys = shallowRef(new Set<number>());
  /** Keys looked up at least once, named or not, so a row that settled doesn't go back to waiting. */
  const settledKeys = new Set<number>();

  const stopNaming = (keys: readonly number[]) => {
    namingKeys.value = new Set([...namingKeys.value].filter((key) => !keys.includes(key)));
  };

  /** Shows a batch's names and marks its keys looked up. */
  const showBatch = (batch: readonly number[], found: ReadonlyMap<number, string>) => {
    if (found.size) lateNames.value = new Map([...lateNames.value, ...found]);
    for (const key of batch) settledKeys.add(key);
    stopNaming(batch);
  };

  /** Names for species (or, with `ranks`, higher taxa) the table hasn't named, one request a batch. */
  async function nameSpecies(
    keys: Iterable<number | undefined>,
    signal?: AbortSignal,
    ranks?: ReadonlyMap<number, Rank>,
  ) {
    const missing = [...new Set(keys)].filter(
      (key): key is number => key !== undefined && !tableNames.value.has(key) && !lateNames.value.has(key),
    );
    const fresh = missing.filter((key) => !settledKeys.has(key));
    namingKeys.value = new Set([...namingKeys.value, ...fresh]);
    try {
      for (const batch of batches(missing)) {
        const found = await lookupCommonNames(batch, signal, ranks);
        if (signal?.aborted) return;
        const nameless = batch.filter((key) => !found.has(key) && fresh.includes(key));
        await applyNames(nameless, () => showBatch(batch, found));
      }
    } finally {
      // An aborted lookup (another page) leaves its keys to the next one, showing what they have meanwhile.
      stopNaming(fresh);
    }
  }

  return { lateNames, namingKeys, nameSpecies };
}

/**
 * The names looked up so far, and the lookups that add to them.
 * @param species The cell's species table rows.
 * @param tableNames The common names the table already has, by species key.
 * @param applyNames How each batch of names reaches the page.
 */
function useNameLookups(
  species: () => readonly SpeciesRow[],
  tableNames: Ref<ReadonlyMap<number, string>>,
  applyNames: ApplyNames,
) {
  const { lateNames, namingKeys, nameSpecies } = useCommonNameLookups(tableNames, applyNames);
  /** Scientific names looked up for species the index didn't name ("Species 123"). */
  const lateScientificNames = shallowRef(new Map<number, string>());
  /** Keys whose names are being looked up for the options. */
  const pendingNames = shallowRef(new Set<number>());
  const askedNames = new Set<number>();

  /** Names for unnamed species ("Species 123"), so their options show a real name. */
  async function nameUnnamed(keys: readonly number[]) {
    const unnamed = new Set(species().flatMap((row) => (row.unnamed ? [row.key] : [])));
    const found = await resolveNames(keys.filter((key) => unnamed.has(key)));
    if (found.size) lateScientificNames.value = new Map([...lateScientificNames.value, ...found]);
  }

  /** Looks up names for the options a batch at a time, marking each batch pending until it's back. */
  async function nameOptions(keys: readonly number[]) {
    const fresh = keys.filter((key) => !askedNames.has(key));
    for (const key of fresh) askedNames.add(key);
    pendingNames.value = new Set([...pendingNames.value, ...fresh]);
    for (const batch of batches(fresh)) {
      try {
        await Promise.all([nameSpecies(batch), nameUnnamed(batch)]);
      } finally {
        pendingNames.value = new Set([...pendingNames.value].filter((key) => !batch.includes(key)));
      }
    }
  }

  return { lateNames, lateScientificNames, pendingNames, namingKeys, nameSpecies, nameOptions };
}

/**
 * Looks up and remembers names for the cell's species and records.
 * @param species The cell's species table rows.
 * @param applyNames How each batch of names reaches the page; at once unless given.
 */
export function useRecordNames(species: () => readonly SpeciesRow[], applyNames: ApplyNames = applyAtOnce) {
  const tableNames = computed(
    () => new Map(species().flatMap((row) => (row.commonName ? [[row.key, row.commonName] as const] : []))),
  );
  const { lateNames, lateScientificNames, pendingNames, namingKeys, nameSpecies, nameOptions } = useNameLookups(
    species,
    tableNames,
    applyNames,
  );

  const commonNameOf = (row: SpeciesRow) => row.commonName ?? lateNames.value.get(row.key);
  const scientificNameOf = (row: SpeciesRow) => lateScientificNames.value.get(row.key) ?? row.scientificName;
  const labelOf = (row: SpeciesRow) => commonNameOf(row) ?? scientificNameOf(row);
  /** Whether a row has a real scientific name, not the "Species 123" placeholder. */
  const hasScientificName = (row: SpeciesRow) => !row.unnamed || lateScientificNames.value.has(row.key);

  // The species' name, as everywhere else: the table's, else looked up. The name a recorder typed on the
  // record is only a fallback, so one species doesn't show under several names.
  const recordCommonName = (occurrence: Occurrence) => {
    const key = aboutKey(occurrence);
    const known = key ? (tableNames.value.get(key) ?? lateNames.value.get(key)) : undefined;
    return known ?? (occurrence.vernacularName && tidy(occurrence.vernacularName));
  };
  /** Names each record's taxon at its own rank, so a record named only to class isn't named after one of its species. */
  const nameRecords = (occurrences: readonly Occurrence[], signal?: AbortSignal) => {
    const ranks = new Map(
      occurrences.flatMap((occurrence) => {
        const key = aboutKey(occurrence);
        return key === undefined ? [] : [[key, aboutRank(occurrence)] as const];
      }),
    );
    return nameSpecies(ranks.keys(), signal, ranks);
  };
  /** Whether a record's common name is still being looked up for the first time. */
  const isNamePending = (occurrence: Occurrence) => {
    const key = aboutKey(occurrence);
    return key !== undefined && namingKeys.value.has(key) && !recordCommonName(occurrence);
  };
  const recordName = (occurrence: Occurrence) =>
    recordCommonName(occurrence) ?? recordScientificName(occurrence) ?? 'Unnamed record';

  return {
    pendingNames,
    commonNameOf,
    scientificNameOf,
    labelOf,
    hasScientificName,
    recordCommonName,
    isNamePending,
    recordName,
    nameSpecies,
    nameRecords,
    nameOptions,
  };
}

/** The names shared by the record list and its species filter. */
export type RecordNames = ReturnType<typeof useRecordNames>;
