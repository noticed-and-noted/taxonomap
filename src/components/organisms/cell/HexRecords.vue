<script setup lang="ts">
/**
 * Individual records in the selected cell, a page at a time in GBIF's order, as a table with a short record
 * type code (FOS, SPE…; the full type on hover). A row expands to its photo (opening a lightbox of all its
 * photos) and details. No column sorts: GBIF's occurrence search has no sort parameter. A species filter
 * narrows the list. Pass `filter` to list another area's records (near me) instead of the selected cell's.
 */
import { useStore } from '@nanostores/vue';
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, useId, watch } from 'vue';
import SkeletonBlock from '~/components/atoms/SkeletonBlock.vue';
import InlineAlert from '~/components/molecules/InlineAlert.vue';
import ListSkeleton from '~/components/molecules/ListSkeleton.vue';
import PhotoLightbox from '~/components/molecules/PhotoLightbox.vue';
import { useLatestLoad } from '~/composables/useLatestLoad';
import { useScrollFade } from '~/composables/useScrollFade';
import { full } from '~/lib/format';
import { searchOccurrences, usableImages, type Occurrence, type OccurrenceFilter, type UsableImage } from '~/lib/gbif';
import { recordPlace } from '~/lib/map/recordPlace';
import { aboutKey } from '~/lib/record-fields';
import type { SpeciesRow } from '~/lib/species/groups';
import { $speciesManifest, speciesPath } from '~/lib/species/links';
import { $hexGeometry, $occurrenceFilter, $recordPlace } from '~/stores/explorer';
import HexRecordDetails from './HexRecordDetails.vue';
import HexRecordRow from './HexRecordRow.vue';
import HexRecordsSpeciesFilter from './HexRecordsSpeciesFilter.vue';
import { revealInList, startListTransition } from './recordListScroll';
import { useRecordNames } from './useRecordNames';

const PAGE_SIZE = 20;
const ROW_KEYS: Record<string, number> = { ArrowDown: 1, ArrowUp: -1 };

const props = defineProps<{ species: readonly SpeciesRow[]; filter?: OccurrenceFilter | null; fill?: boolean }>();

const geometry = useStore($hexGeometry);
const storeFilter = useStore($occurrenceFilter);
const manifest = useStore($speciesManifest);
const { loading, error, run } = useLatestLoad();
const names = useRecordNames(() => props.species);
const uniqueId = useId();
/** The listed area: the `filter` prop, else the selected cell under the map's filters. */
const area = computed(
  () => props.filter ?? (geometry.value ? { ...storeFilter.value, geometry: geometry.value.wkt } : null),
);

/** Chosen speciesKey, or '' for all species. */
const speciesKey = ref<number | ''>('');
const records = shallowRef<Occurrence[]>([]);
const total = ref<number | null>(null);
const hasMore = computed(() => total.value !== null && records.value.length < total.value);
/** Expanded row's occurrence key. */
const expanded = ref<number | null>(null);
const scroller = ref<HTMLElement>();
const { fadeBottom, update: updateFade } = useScrollFade(scroller);

const detailsId = (key: number) => `${uniqueId}-rec-${key}`;
const aboutHref = (occurrence: Occurrence) => {
  const key = aboutKey(occurrence);
  return key ? speciesPath(key, manifest.value) : undefined;
};

/** Loads the first page of records, or with `more` the next page after those listed. */
async function load(more = false) {
  const baseFilter = area.value;
  if (!more) records.value = [];
  if (!baseFilter) return;
  await run(async (signal) => {
    const pageFilter = { ...baseFilter, ...(speciesKey.value !== '' && { speciesKeys: [speciesKey.value] }) };
    const offset = more ? records.value.length : 0;
    const response = await searchOccurrences(pageFilter, { limit: PAGE_SIZE, offset }, signal);
    if (signal.aborted) return;
    records.value = more ? [...records.value, ...response.results] : response.results;
    if (!more) expanded.value = null;
    void names.nameRecords(response.results, signal);
    total.value = response.count;
  });
}

// Another cell, area or filter: the picked species may not be there any more.
watch(
  () => JSON.stringify(area.value),
  () => {
    if (speciesKey.value === '') void load();
    else speciesKey.value = ''; // the watch below reloads
  },
  { immediate: true },
);
watch(speciesKey, () => void load());
watch(records, () => void nextTick(updateFade));

// Mark the expanded record on the map, when it has coordinates.
watch(expanded, (key) => {
  const record = records.value.find((occurrence) => occurrence.key === key);
  $recordPlace.set(record ? recordPlace(record) : null);
});
onBeforeUnmount(() => $recordPlace.set(null));

/** Photo URLs that failed to load; they drop out of the row and the lightbox. */
const broken = ref(new Set<string>());
/** Photo URLs that have loaded at some size, so their skeletons can go. */
const loaded = ref(new Set<string>());
const photos = (occurrence: Occurrence) => usableImages(occurrence).filter((photo) => !broken.value.has(photo.url));
const firstPhoto = (occurrence: Occurrence): UsableImage | undefined => photos(occurrence)[0];
const isPhotoLoaded = (occurrence: Occurrence) => loaded.value.has(firstPhoto(occurrence)?.url ?? '');
const markBroken = (photo: UsableImage) => (broken.value = new Set(broken.value).add(photo.url));
const markLoaded = (photo: UsableImage) => (loaded.value = new Set(loaded.value).add(photo.url));

const lightbox = ref<InstanceType<typeof PhotoLightbox>>();
/** Record whose photos the lightbox shows. */
const lightboxRecord = shallowRef<Occurrence | null>(null);
const lightboxPhotos = computed(() => (lightboxRecord.value ? photos(lightboxRecord.value) : []));
const lightboxAbout = computed(() => (lightboxRecord.value ? aboutHref(lightboxRecord.value) : undefined));
const positionOf = (key: number | undefined) => records.value.findIndex((occurrence) => occurrence.key === key);
/** The next record's first photo, for the lightbox to preload. */
const nextRecordPhoto = computed(() => {
  const next = lightboxRecord.value && records.value[positionOf(lightboxRecord.value.key) + 1];
  return next ? firstPhoto(next) : undefined;
});

/** Opens the lightbox on a record's photos, once it has them as props. */
async function openPhotos(occurrence: Occurrence) {
  lightboxRecord.value = occurrence;
  await nextTick();
  lightbox.value?.open(0);
}

/** The record `delta` rows from `key`; stepping down past the last loaded record loads the next page first. */
async function recordFrom(key: number | undefined, delta: number) {
  const isPastEnd = delta > 0 && positionOf(key) + delta >= records.value.length;
  if (isPastEnd && hasMore.value && !loading.value) await load(true);
  const position = positionOf(key);
  return position < 0 ? undefined : records.value[position + delta];
}

/** Scrolls the list (not the panel) so a record's details are in view. */
const revealDetails = (key: number) => revealInList(scroller.value, document.getElementById(detailsId(key)));

/** Moves the lightbox to the next or previous record in the list, opening that row behind it. */
async function stepRecord(delta: number) {
  const next = await recordFrom(lightboxRecord.value?.key, delta);
  if (!next) return;
  expanded.value = next.key;
  await openPhotos(next);
  revealDetails(next.key);
}

/** Up and down arrows in the list open the previous or next record from the focused row, and focus it. */
async function onListKey(event: KeyboardEvent) {
  const delta = ROW_KEYS[event.key];
  const row = event.target instanceof HTMLElement && event.target.closest<HTMLElement>('[data-record]');
  if (!delta || !row) return;
  event.preventDefault();
  const next = await recordFrom(Number(row.dataset.record), delta);
  if (!next) return;
  expanded.value = next.key;
  await nextTick();
  document.querySelector<HTMLElement>(`[aria-controls="${detailsId(next.key)}"]`)?.focus({ preventScroll: true });
  revealDetails(next.key);
}

/**
 * Set by a click in the list and cleared by any key, so a row focused from the keyboard (arrows) and then
 * clicked loses its ring, as a clicked row would.
 */
const usedPointer = ref(false);

/** Row whose photo and name carry view-transition names while it opens or closes (one row, so others don't animate). */
const animating = ref<number | null>(null);
const transitionName = (occurrence: Occurrence, part: 'photo' | 'name') =>
  animating.value === occurrence.key ? { viewTransitionName: `rec-${part}-${occurrence.key}` } : undefined;

/** Expand or collapse a row; where supported the photo moves into the details and the name slides into its place. */
function toggle(occurrence: Occurrence) {
  const next = expanded.value === occurrence.key ? null : occurrence.key;
  if (!document.startViewTransition) {
    expanded.value = next;
    return;
  }
  animating.value = occurrence.key;
  void nextTick(async () => {
    try {
      await startListTransition(scroller.value, async () => {
        expanded.value = next;
        await nextTick();
        if (next !== null) revealDetails(next);
      });
    } finally {
      if (animating.value === occurrence.key) animating.value = null;
    }
  });
}
</script>
<template>
  <div :class="fill ? 'flex min-h-0 flex-1 flex-col gap-2' : 'space-y-2'" @keydown.capture="usedPointer = false">
    <HexRecordsSpeciesFilter v-model="speciesKey" :species="species" :area="area" :names="names" />

    <InlineAlert v-if="error" :kind="error" @retry="load()">
      {{
        error === 'unavailable'
          ? 'GBIF is busy right now, so records could not be loaded.'
          : 'Records could not be loaded.'
      }}
    </InlineAlert>

    <ListSkeleton v-else-if="loading && !records.length" label="Loading records" :fill="fill">
      <span class="w-[3.25rem] shrink-0"><SkeletonBlock width="2rem" height="1rem" rounded="sm" /></span>
      <span class="w-[5.5rem] shrink-0"><SkeletonBlock width="4.5rem" height="0.75rem" /></span>
    </ListSkeleton>
    <p v-else-if="!records.length" class="text-sm text-muted">No records to show.</p>
    <p v-else-if="total !== null" class="text-xs text-subtle" aria-live="polite">
      {{ full(records.length) }} of {{ full(total) }} record{{ total === 1 ? '' : 's' }}
    </p>

    <!-- Column headers sit above the scroll box; colgroups and a stable scrollbar gutter keep the columns aligned. -->
    <div v-if="records.length" :class="{ 'flex min-h-0 flex-1 flex-col': fill }">
      <div class="head-row -mx-4 text-xs text-subtle" aria-hidden="true">
        <table class="w-full table-fixed text-sm">
          <colgroup>
            <col class="w-14" />
            <col />
            <col class="w-[3.25rem]" />
            <col class="w-[6.5rem]" />
          </colgroup>
          <tbody>
            <tr>
              <td colspan="2" class="py-1.5 pl-4">Species</td>
              <td class="py-1.5">Type</td>
              <td class="py-1.5 pr-4">Date</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div
        ref="scroller"
        class="fade-list -mx-4 overflow-y-auto [scrollbar-gutter:stable]"
        :class="[
          fill ? 'min-h-48 flex-1' : 'max-h-[min(23rem,65dvh)]',
          { 'fade-bottom': fadeBottom, 'clips-transition': animating !== null },
        ]"
        @scroll.passive="updateFade"
      >
        <table class="w-full table-fixed text-sm" aria-label="Records">
          <colgroup>
            <col class="w-14" />
            <col />
            <col class="w-[3.25rem]" />
            <col class="w-[6.5rem]" />
          </colgroup>
          <thead class="sr-only">
            <tr>
              <th scope="col">Photo</th>
              <th scope="col">Species</th>
              <th scope="col">Type</th>
              <th scope="col">Date</th>
            </tr>
          </thead>
          <tbody :class="{ 'used-pointer': usedPointer }" @keydown="onListKey" @pointerdown="usedPointer = true">
            <template v-for="occurrence in records" :key="occurrence.key">
              <HexRecordRow
                :occurrence="occurrence"
                :is-expanded="expanded === occurrence.key"
                :details-id="detailsId(occurrence.key)"
                :photo="firstPhoto(occurrence)"
                :is-photo-loaded="isPhotoLoaded(occurrence)"
                :common-name="names.recordCommonName(occurrence)"
                :name="names.recordName(occurrence)"
                :photo-style="transitionName(occurrence, 'photo')"
                :name-style="transitionName(occurrence, 'name')"
                @toggle="toggle(occurrence)"
                @photo-loaded="markLoaded"
                @photo-broken="markBroken"
              />
              <tr
                v-if="expanded === occurrence.key"
                :id="detailsId(occurrence.key)"
                :data-record="occurrence.key"
                class="border-b border-border"
              >
                <td colspan="4" class="bg-surface-2 px-4 py-3">
                  <HexRecordDetails
                    :occurrence="occurrence"
                    :photos="photos(occurrence)"
                    :is-photo-loaded="isPhotoLoaded(occurrence)"
                    :name="names.recordName(occurrence)"
                    :about-href="aboutHref(occurrence)"
                    :photo-style="transitionName(occurrence, 'photo')"
                    @photo-loaded="markLoaded"
                    @photo-broken="markBroken"
                    @enlarge="openPhotos(occurrence)"
                  />
                </td>
              </tr>
            </template>
          </tbody>
        </table>

        <ListSkeleton v-if="loading" label="Loading more records" :rows="3">
          <span class="w-[3.25rem] shrink-0"><SkeletonBlock width="2rem" height="1rem" rounded="sm" /></span>
          <span class="w-[5.5rem] shrink-0"><SkeletonBlock width="4.5rem" height="0.75rem" /></span>
        </ListSkeleton>
        <button
          v-else-if="total !== null && records.length < total"
          type="button"
          class="mx-4 mt-2 w-[calc(100%-2rem)] rounded-md border border-border py-1 text-sm hover:bg-surface-2"
          @click="load(true)"
        >
          Show more ({{ full(records.length) }} of {{ full(total) }})
        </button>
      </div>
    </div>
    <PhotoLightbox
      ref="lightbox"
      :images="lightboxPhotos"
      :name="lightboxRecord ? names.recordName(lightboxRecord) : ''"
      :href="lightboxAbout"
      :next-row-image="nextRecordPhoto"
      :loading="loading"
      @step-row="stepRecord"
    />
  </div>
</template>

<style scoped>
/* A row clicked after arrowing through the list loses its focus ring, as any clicked row would. */
.used-pointer :deep(button:focus-visible) {
  outline: none;
}
/* While a row opens or closes, only the list and that row's photo and name animate, and the overlay is clipped to the
   list (startListTransition). The page stays out, live underneath, or the clip would hide it. Global: these hang
   off <html>, which a scoped selector would never match. */
.clips-transition {
  view-transition-name: rec-list;
}
:global(html.records-transition) {
  view-transition-name: none;
}
:global(html.records-transition::view-transition) {
  clip-path: var(--records-clip);
}
.head-row {
  overflow-y: hidden;
  scrollbar-gutter: stable;
  box-shadow: inset 0 -1px 0 var(--border-strong);
}
</style>
