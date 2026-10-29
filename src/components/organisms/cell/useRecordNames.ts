/**
 * Names for the species in the cell's record list and its species filter. The
 * cell's species table names few species, so names are looked up as rows and
 * options appear, a batch at a time, and shared between the two.
 */
import { computed, shallowRef, type Ref } from 'vue';
import type { Occurrence } from '~/lib/gbif';
import { aboutKey, recordScientificName } from '~/lib/record-fields';
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
 * The names looked up so far, and the lookups that add to them.
 * @param species The cell's species table rows.
 * @param tableNames The common names the table already has, by species key.
 */
function useNameLookups(species: () => readonly SpeciesRow[], tableNames: Ref<ReadonlyMap<number, string>>) {
  /** Common names looked up for species the table hasn't named. */
  const lateNames = shallowRef(new Map<number, string>());
  /** Scientific names looked up for species the index didn't name ("Species 123"). */
  const lateScientificNames = shallowRef(new Map<number, string>());
  /** Keys whose names are being looked up for the options. */
  const pendingNames = shallowRef(new Set<number>());
  const askedNames = new Set<number>();

  /** Names for species the table hasn't named (cached, as on species pages), a batch at a time. */
  async function nameSpecies(keys: Iterable<number | undefined>, signal?: AbortSignal) {
    const missing = [...new Set(keys)].filter(
      (key): key is number => key !== undefined && !tableNames.value.has(key) && !lateNames.value.has(key),
    );
    for (const batch of batches(missing)) {
      const found = await lookupCommonNames(batch, signal);
      if (signal?.aborted) return;
      if (found.size) lateNames.value = new Map([...lateNames.value, ...found]);
    }
  }

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

  return { lateNames, lateScientificNames, pendingNames, nameSpecies, nameOptions };
}

/**
 * Looks up and remembers names for the cell's species and records.
 * @param species The cell's species table rows.
 */
export function useRecordNames(species: () => readonly SpeciesRow[]) {
  const tableNames = computed(
    () => new Map(species().flatMap((row) => (row.commonName ? [[row.key, row.commonName] as const] : []))),
  );
  const { lateNames, lateScientificNames, pendingNames, nameSpecies, nameOptions } = useNameLookups(
    species,
    tableNames,
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
  const recordName = (occurrence: Occurrence) =>
    recordCommonName(occurrence) ?? recordScientificName(occurrence) ?? 'Unnamed record';

  return {
    pendingNames,
    commonNameOf,
    scientificNameOf,
    labelOf,
    hasScientificName,
    recordCommonName,
    recordName,
    nameSpecies,
    nameOptions,
  };
}

/** The names shared by the record list and its species filter. */
export type RecordNames = ReturnType<typeof useRecordNames>;
