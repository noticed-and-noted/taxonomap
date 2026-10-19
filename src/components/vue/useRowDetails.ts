/**
 * Lazy details for species-table rows: each row's lead photo, its name when
 * the baked index lacked it, and its common name when the index had none.
 * Photos and common names are fetched for rows in view; names for rows in
 * view, or for every row when `needAllNames` (sorting by name, searching).
 * Photos go first because their records carry names too. Each
 * key is asked for once per data set; a new data set (`dataset` changes)
 * forgets the last one's lookups and aborts them.
 */
import { computed, onScopeDispose, ref, watch, type Ref } from 'vue';
import type { UsableImage } from '~/lib/gbif';
import { commonNames, photosForKeys, resolveNames, type SpeciesRow } from '~/lib/species/groups';

export interface RowDetailsOptions {
  rows: () => readonly SpeciesRow[];
  /** Identity of the data set (a new value means new rows). */
  dataset: () => unknown;
  /** Keys of rows currently scrolled into view. */
  inView: Ref<Set<number>>;
  needAllNames: () => boolean;
}

export function useRowDetails({ rows, dataset, inView, needAllNames }: RowDetailsOptions) {
  /** Names looked up after load, for rows the index and batch search missed. */
  const lateNames = ref(new Map<number, string>());
  /** Lookups that came back empty: show the "Species N" fallback, not a skeleton. */
  const noName = ref(new Set<number>());
  /** Photos found after load; `photoDone` marks keys searched (found or not). */
  const latePhotos = ref(new Map<number, UsableImage>());
  const photoDone = ref(new Set<number>());
  /** Common names looked up after load, for rows in view the index had none for. */
  const lateCommon = ref(new Map<number, string>());

  let photoAsked = new Set<number>();
  let nameAsked = new Set<number>();
  let commonAsked = new Set<number>();
  let ctrl: AbortController | undefined;
  let current: unknown;

  function forget() {
    ctrl?.abort();
    ctrl = new AbortController();
    photoAsked = new Set();
    nameAsked = new Set();
    lateNames.value = new Map();
    noName.value = new Set();
    latePhotos.value = new Map();
    photoDone.value = new Set();
    commonAsked = new Set();
    lateCommon.value = new Map();
  }

  /** Start over when the data set changes; returns this data set's controller. */
  function sync() {
    if (current !== dataset()) {
      current = dataset();
      forget();
    }
    return ctrl;
  }

  const inViewRows = computed(() => rows().filter((r) => inView.value.has(r.key)));
  const needPhotos = computed(() => inViewRows.value.filter((r) => !r.image).map((r) => r.key));
  const needNames = computed(() =>
    (needAllNames() ? rows() : inViewRows.value).filter((r) => r.unnamed).map((r) => r.key),
  );
  const needCommon = computed(() => inViewRows.value.filter((r) => !r.commonName).map((r) => r.key));

  // Common names run alongside photos: neither needs the other.
  watch(
    needCommon,
    async (keys) => {
      const mine = sync();
      const ask = keys.filter((k) => !commonAsked.has(k));
      if (!ask.length) return;
      for (const k of ask) commonAsked.add(k);
      const found = await commonNames(ask, mine?.signal);
      if (mine === ctrl && found.size) lateCommon.value = new Map([...lateCommon.value, ...found]);
    },
    { immediate: true },
  );

  watch(
    [needPhotos, needNames],
    async ([photoKeys, nameKeys]) => {
      const mine = sync();
      const photos = photoKeys.filter((k) => !photoAsked.has(k));
      let names = nameKeys.filter((k) => !nameAsked.has(k));
      for (const k of photos) photoAsked.add(k);
      for (const k of names) nameAsked.add(k);

      if (photos.length) {
        const named = new Map(rows().flatMap((r) => (r.unnamed ? [] : [[r.key, r.scientificName] as const])));
        const found = await photosForKeys(photos, mine?.signal, named);
        if (mine !== ctrl) return;
        if (found.images.size) latePhotos.value = new Map([...latePhotos.value, ...found.images]);
        photoDone.value = new Set([...photoDone.value, ...photos]);
        if (found.names.size) lateNames.value = new Map([...lateNames.value, ...found.names]);
        // The batched record search may have named rows while photos loaded.
        const unnamed = new Set(rows().flatMap((r) => (r.unnamed ? [r.key] : [])));
        names = names.filter((k) => !found.names.has(k) && unnamed.has(k));
      }
      if (names.length) {
        const found = await resolveNames(names, mine?.signal);
        if (mine !== ctrl) return;
        if (found.size) lateNames.value = new Map([...lateNames.value, ...found]);
        const missed = names.filter((k) => !found.has(k));
        if (missed.length) noName.value = new Set([...noName.value, ...missed]);
      }
    },
    { immediate: true },
  );

  onScopeDispose(() => ctrl?.abort());

  return {
    /** The common name, from the index or looked up once in view. */
    commonName: (r: SpeciesRow) => r.commonName ?? lateCommon.value.get(r.key),
    /** The scientific name, once known. */
    sciName: (r: SpeciesRow) => (r.unnamed ? lateNames.value.get(r.key) : undefined) ?? r.scientificName,
    /** Still looking the name up (show a skeleton). */
    pendingName: (r: SpeciesRow) => !!r.unnamed && !lateNames.value.has(r.key) && !noName.value.has(r.key),
    photoOf: (r: SpeciesRow) => r.image ?? latePhotos.value.get(r.key),
    /** Still looking the photo up. */
    pendingPhoto: (r: SpeciesRow) => !r.image && !latePhotos.value.has(r.key) && !photoDone.value.has(r.key),
  };
}
