/**
 * Lazy details for species-table rows: each row's lead photo, its name when
 * the baked index lacked it, and its common name when the index had none.
 * Photos are fetched for rows in view; names and common names for rows in
 * view, or for every row when `needAllNames` (sorting by name, searching).
 * Photos go first because their records carry names too, and the iNaturalist
 * taxa they fetch carry common names, so a row with a photo lookup needs no
 * common-name request of its own (only GBIF's, if iNaturalist has none). Each
 * key is asked for once per data set; a new data set (`dataset` changes)
 * forgets the last one's lookups and aborts them.
 */
import { computed, onScopeDispose, ref, watch, type Ref } from 'vue';
import type { UsableImage } from '~/lib/gbif';
import { commonNames, gbifCommonNames, photosForKeys, resolveNames, type SpeciesRow } from '~/lib/species/groups';

/** Common names looked up per batch, so a search's matches appear as they arrive. */
const COMMON_NAME_BATCH = 20;

/** Options for `useRowDetails`. */
export interface RowDetailsOptions {
  rows: () => readonly SpeciesRow[];
  /** Identity of the data set (a new value means new rows). */
  dataset: () => unknown;
  /** Keys of rows currently scrolled into view. */
  inView: Ref<Set<number>>;
  needAllNames: () => boolean;
}

/** Merges `additions` into a ref'd map, replacing it so Vue sees the change. */
function mergeInto<Value>(target: Ref<Map<number, Value>>, additions: ReadonlyMap<number, Value>) {
  if (additions.size) target.value = new Map([...target.value, ...additions]);
}

/** What has been looked up for the current data set, what was already asked, and the controller to cancel it. */
function useLookupState(dataset: () => unknown) {
  /** Names looked up after load, for rows the index and batch search missed. */
  const lateNames = ref(new Map<number, string>());
  /** Lookups that came back empty: show the "Species N" fallback, not a skeleton. */
  const noName = ref(new Set<number>());
  /** Photos found after load; `photoDone` marks keys searched (found or not). */
  const latePhotos = ref(new Map<number, UsableImage>());
  const photoDone = ref(new Set<number>());
  /** Common names looked up after load, for rows in view the index had none for. */
  const lateCommon = ref(new Map<number, string>());
  /** Name and common-name lookups in flight. */
  const namesInFlight = ref(0);
  const asked = { photo: new Set<number>(), name: new Set<number>(), common: new Set<number>() };
  let controller: AbortController | undefined;
  let current: unknown;

  function forget() {
    controller?.abort();
    controller = new AbortController();
    asked.photo = new Set();
    asked.name = new Set();
    asked.common = new Set();
    lateNames.value = new Map();
    noName.value = new Set();
    latePhotos.value = new Map();
    photoDone.value = new Set();
    lateCommon.value = new Map();
  }

  /** Start over when the data set changes; returns this data set's controller. */
  function sync() {
    if (current !== dataset()) {
      current = dataset();
      forget();
    }
    return controller;
  }

  onScopeDispose(() => controller?.abort());

  return {
    lateNames,
    noName,
    latePhotos,
    photoDone,
    lateCommon,
    namesInFlight,
    asked,
    sync,
    isCurrent: (mine: AbortController | undefined) => mine === controller,
  };
}

type LookupState = ReturnType<typeof useLookupState>;

/** Looks up common names the index had none for, a batch at a time so they show as they arrive. */
async function lookUpCommonNames(keys: number[], state: LookupState) {
  const mine = state.sync();
  // A row whose photo was looked up was named by that lookup.
  const ask = keys.filter((key) => !state.asked.common.has(key) && !state.asked.photo.has(key));
  for (const key of ask) state.asked.common.add(key);
  if (ask.length) await trackNames(state, () => lookUpCommonNamesInBatches(ask, mine, state));
}

/** Runs a name lookup, counting it as in flight until it settles. */
async function trackNames(state: LookupState, lookup: () => Promise<void>) {
  state.namesInFlight.value++;
  try {
    await lookup();
  } finally {
    state.namesInFlight.value--;
  }
}

/** Merges each batch as it arrives, so a search's matches show early. */
async function lookUpCommonNamesInBatches(ask: number[], mine: AbortController | undefined, state: LookupState) {
  for (let start = 0; start < ask.length; start += COMMON_NAME_BATCH) {
    const found = await commonNames(ask.slice(start, start + COMMON_NAME_BATCH), mine?.signal);
    if (!state.isCurrent(mine)) return;
    mergeInto(state.lateCommon, found);
  }
}

/**
 * Merges the common names a photo lookup found, then asks GBIF for the rows iNaturalist didn't name.
 * @param keys The rows the photo lookup was for that have no common name.
 */
async function mergePhotoCommonNames(
  keys: readonly number[],
  found: ReadonlyMap<number, string>,
  mine: AbortController | undefined,
  state: LookupState,
) {
  if (!state.isCurrent(mine)) return;
  mergeInto(state.lateCommon, found);
  const unnamed = keys.filter((key) => !found.has(key));
  if (!unnamed.length) return;
  const fromGbif = await gbifCommonNames(unnamed, mine?.signal);
  if (state.isCurrent(mine)) mergeInto(state.lateCommon, fromGbif);
}

/** Looks up lead photos (whose records also name species, and whose iNaturalist taxa give common names) for rows in view. */
async function lookUpPhotos(
  photos: number[],
  rows: () => readonly SpeciesRow[],
  mine: AbortController | undefined,
  state: LookupState,
) {
  const withCommonName = new Set(rows().flatMap((row) => (row.commonName ? [row.key] : [])));
  const needCommon = photos.filter((key) => !withCommonName.has(key) && !state.asked.common.has(key));
  for (const key of needCommon) state.asked.common.add(key);
  let commonNamesMerged: Promise<void> | undefined;
  const mergeCommonNames = (commonNames: ReadonlyMap<number, string>) => {
    commonNamesMerged = mergePhotoCommonNames(needCommon, commonNames, mine, state);
    if (needCommon.length) void trackNames(state, () => commonNamesMerged!);
  };
  const found = await photosForKeys(photos, mine?.signal, mergeCommonNames).catch((error: unknown) => {
    // No iNaturalist taxa, so no names from them: GBIF's names still come.
    if (!commonNamesMerged) mergeCommonNames(new Map());
    throw error;
  });
  await commonNamesMerged;
  if (!state.isCurrent(mine)) return undefined;
  mergeInto(state.latePhotos, found.images);
  state.photoDone.value = new Set([...state.photoDone.value, ...photos]);
  mergeInto(state.lateNames, found.names);
  return found.names;
}

/** Looks up scientific names the baked index and batch search missed; keys with no answer show a fallback. */
async function lookUpNames(names: number[], mine: AbortController | undefined, state: LookupState) {
  const found = await resolveNames(names, mine?.signal);
  if (!state.isCurrent(mine)) return;
  mergeInto(state.lateNames, found);
  const missed = names.filter((key) => !found.has(key));
  if (missed.length) state.noName.value = new Set([...state.noName.value, ...missed]);
}

/** Photos first (their records carry names too), then whichever names are still missing. */
async function lookUpPhotosAndNames(
  photoKeys: number[],
  nameKeys: number[],
  rows: () => readonly SpeciesRow[],
  state: LookupState,
) {
  const mine = state.sync();
  const photos = photoKeys.filter((key) => !state.asked.photo.has(key));
  let names = nameKeys.filter((key) => !state.asked.name.has(key));
  for (const key of photos) state.asked.photo.add(key);
  for (const key of names) state.asked.name.add(key);

  if (photos.length) {
    const namedByPhotos = await lookUpPhotos(photos, rows, mine, state);
    if (!namedByPhotos) return;
    // The batched record search may have named rows while photos loaded.
    const unnamed = new Set(rows().flatMap((row) => (row.unnamed ? [row.key] : [])));
    names = names.filter((key) => !namedByPhotos.has(key) && unnamed.has(key));
  }
  if (names.length) await trackNames(state, () => lookUpNames(names, mine, state));
}

/**
 * Lazy photo and name lookups for the rows in view.
 * @returns Accessors that give a row's common name, scientific name and photo, and whether each is still loading.
 */
export function useRowDetails({ rows, dataset, inView, needAllNames }: RowDetailsOptions) {
  const state = useLookupState(dataset);
  const inViewRows = computed(() => rows().filter((row) => inView.value.has(row.key)));
  const needPhotos = computed(() => inViewRows.value.filter((row) => !row.image).map((row) => row.key));
  const needNames = computed(() =>
    (needAllNames() ? rows() : inViewRows.value).filter((row) => row.unnamed).map((row) => row.key),
  );
  const needCommon = computed(() =>
    (needAllNames() ? rows() : inViewRows.value).filter((row) => !row.commonName).map((row) => row.key),
  );

  // Photos first, so a row they will name isn't asked for twice; common names for the rest run alongside.
  watch([needPhotos, needNames], ([photoKeys, nameKeys]) => lookUpPhotosAndNames(photoKeys, nameKeys, rows, state), {
    immediate: true,
  });
  watch(needCommon, (keys) => lookUpCommonNames(keys, state), { immediate: true });

  const { lateCommon, lateNames, noName, latePhotos, photoDone, namesInFlight } = state;
  return {
    /** Names or common names are being looked up. */
    isLoadingNames: computed(() => namesInFlight.value > 0),
    /** The common name, from the index or looked up once in view. */
    commonName: (row: SpeciesRow) => row.commonName ?? lateCommon.value.get(row.key),
    /** The scientific name, once known. */
    sciName: (row: SpeciesRow) => (row.unnamed ? lateNames.value.get(row.key) : undefined) ?? row.scientificName,
    /** Still looking the name up (show a skeleton). */
    pendingName: (row: SpeciesRow) => !!row.unnamed && !lateNames.value.has(row.key) && !noName.value.has(row.key),
    photoOf: (row: SpeciesRow) => row.image ?? latePhotos.value.get(row.key),
    /** Still looking the photo up. */
    pendingPhoto: (row: SpeciesRow) => !row.image && !latePhotos.value.has(row.key) && !photoDone.value.has(row.key),
  };
}
