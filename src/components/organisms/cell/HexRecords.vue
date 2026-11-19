<script setup lang="ts">
/**
 * Individual records in the selected cell (or all results), a page at a time by date (newest first, or oldest), as a table with a
 * short record type code (FOS, SPE…; the full type on hover). A row expands to its photo (opening a lightbox of all
 * its photos) and details. Only the date sorts: GBIF's GraphQL search sorts, REST's doesn't. A species filter
 * narrows the list. Pass `filter` to list another area's records (near me) instead of the selected cell's.
 */
import { useStore } from '@nanostores/vue';
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, useId, watch } from 'vue';
import SkeletonBlock from '~/components/atoms/SkeletonBlock.vue';
import UiIcon from '~/components/atoms/UiIcon.vue';
import InlineAlert from '~/components/molecules/InlineAlert.vue';
import ListSkeleton from '~/components/molecules/ListSkeleton.vue';
import PhotoLightbox from '~/components/molecules/PhotoLightbox.vue';
import { useLatestLoad } from '~/composables/useLatestLoad';
import { useScrollFade } from '~/composables/useScrollFade';
import { full } from '~/lib/format';
import {
  MAX_DATED_RECORDS,
  searchOccurrencesByDate,
  usableImages,
  type DateOrder,
  type Occurrence,
  type OccurrenceFilter,
  type UsableImage,
} from '~/lib/gbif';
import { recordPlace } from '~/lib/map/recordPlace';
import { aboutKey } from '~/lib/record-fields';
import type { SpeciesRow } from '~/lib/species/groups';
import { $speciesManifest, speciesPath } from '~/lib/species/links';
import { $recordPlace, $resultsFilter } from '~/stores/explorer';
import HexRecordDetails from './HexRecordDetails.vue';
import HexRecordRow from './HexRecordRow.vue';
import HexRecordsSpeciesFilter from './HexRecordsSpeciesFilter.vue';
import { revealInList, startListTransition } from './recordListScroll';
import { useOpenRecord } from './useOpenRecord';
import { useRecordNames, type ApplyNames } from './useRecordNames';

const PAGE_SIZE = 20;
/** Skeleton rows while a new order loads: about the list's height. */
const RESORT_SKELETON_ROWS = 8;
const ROW_KEYS: Record<string, number> = { ArrowDown: 1, ArrowUp: -1 };

const props = defineProps<{ species: readonly SpeciesRow[]; filter?: OccurrenceFilter | null; fill?: boolean }>();

const resultsFilter = useStore($resultsFilter);
const manifest = useStore($speciesManifest);
const { loading, error, run } = useLatestLoad();
const names = useRecordNames(() => props.species, applyNames);
const uniqueId = useId();
/** The listed area: the `filter` prop, else the results panel's (the selected cell, or all results). */
const area = computed(() => props.filter ?? resultsFilter.value);

/** Chosen speciesKey, or '' for all species. */
const speciesKey = ref<number | ''>('');
const dateOrder = ref<DateOrder>('DESC');
const records = shallowRef<Occurrence[]>([]);
/** How many of the listed records came from the search: a record opened from the URL can sit first as well. */
const searchedCount = ref(0);
const total = ref<number | null>(null);
// GraphQL pages no deeper than MAX_DATED_RECORDS, however many match.
const hasMore = computed(() => total.value !== null && searchedCount.value < Math.min(total.value, MAX_DATED_RECORDS));
/** True while the list reloads in the other order: the rows wait, the header and count stay. */
const isResorting = ref(false);
/** Expanded row's occurrence key, kept in the URL. */
const { expanded, withOpenRecord } = useOpenRecord();
const scroller = ref<HTMLElement>();
const { fadeBottom, update: updateFade } = useScrollFade(scroller);

const detailsId = (key: number) => `${uniqueId}-rec-${key}`;
const aboutHref = (occurrence: Occurrence) => {
  const key = aboutKey(occurrence);
  return key ? speciesPath(key, manifest.value) : undefined;
};

/** What a load fetches: a fresh first page, the first page in the other order (the rows stay until it's back), or the next page. */
type LoadKind = 'first' | 'resort' | 'more';

/** Loads a page of records (see LoadKind). */
async function load(kind: LoadKind = 'first') {
  const baseFilter = area.value;
  const more = kind === 'more';
  isResorting.value = kind === 'resort';
  if (kind === 'first') records.value = [];
  if (!baseFilter) return;
  await run(async (signal) => {
    const pageFilter = { ...baseFilter, ...(speciesKey.value !== '' && { speciesKeys: [speciesKey.value] }) };
    const page = { order: dateOrder.value, limit: PAGE_SIZE, offset: more ? searchedCount.value : 0 };
    const response = await searchOccurrencesByDate(pageFilter, page, signal);
    if (signal.aborted) return;
    const nextRecords = more ? withNextPage(response.results) : await withOpenRecord(response.results, signal);
    if (signal.aborted) return;
    records.value = nextRecords;
    searchedCount.value = (more ? searchedCount.value : 0) + response.results.length;
    isResorting.value = false;
    void names.nameRecords(nextRecords, signal);
    total.value = response.count;
  });
}

/** The listed records and the next page after them, less the record opened from the URL, already listed first. */
function withNextPage(page: readonly Occurrence[]): Occurrence[] {
  const listed = new Set(records.value.map((occurrence) => occurrence.key));
  return [...records.value, ...page.filter((occurrence) => !listed.has(occurrence.key))];
}

/** Taxa whose scientific name is moving up into the place of a common name that never came. */
const growingTaxa = shallowRef(new Set<number>());

/** The scientific name's view-transition name while it grows into the name's place. */
function scientificNameStyle(occurrence: Occurrence) {
  const key = aboutKey(occurrence);
  return key !== undefined && growingTaxa.value.has(key)
    ? { viewTransitionName: `rec-sci-${occurrence.key}` }
    : undefined;
}

/** Shows a batch of names; where the scientific name takes a missing name's place, it moves up as a view transition. */
async function applyNames(...[nameless, update]: Parameters<ApplyNames>) {
  // An opening or closing row's transition is running: start no other, or it would cut that one short.
  const canAnimate = nameless.length > 0 && !!document.startViewTransition && animating.value === null;
  if (!canAnimate) return update();
  growingTaxa.value = new Set(nameless);
  await nextTick();
  try {
    await startListTransition(scroller.value, async () => {
      update();
      await nextTick();
    });
  } finally {
    growingTaxa.value = new Set();
  }
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
watch(dateOrder, () => void load('resort'));
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
  if (isPastEnd && hasMore.value && !loading.value) await load('more');
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
      <span class="flex w-[3.25rem] shrink-0 justify-center">
        <SkeletonBlock width="2rem" height="1rem" rounded="sm" />
      </span>
      <span class="flex w-[5.4rem] shrink-0 justify-end"><SkeletonBlock width="4rem" height="0.75rem" /></span>
    </ListSkeleton>
    <p v-else-if="!records.length" class="text-sm text-muted">No records to show.</p>
    <p v-else-if="total !== null" class="text-xs text-subtle" aria-live="polite">
      {{ full(records.length) }} of {{ full(total) }} record{{ total === 1 ? '' : 's' }}
    </p>

    <!-- Column headers sit above the scroll box; colgroups and a stable scrollbar gutter keep the columns aligned. -->
    <div v-if="records.length" :class="{ 'flex min-h-0 flex-1 flex-col': fill }">
      <div class="head-row -mx-4 text-xs text-subtle">
        <table class="w-full table-fixed text-sm" role="presentation">
          <colgroup>
            <col class="w-14" />
            <col />
            <col class="w-[3.25rem]" />
            <col class="w-[5.4rem]" />
          </colgroup>
          <tbody>
            <tr>
              <td colspan="2" class="py-1.5 pl-4" aria-hidden="true">Species</td>
              <td class="py-1.5 text-center" aria-hidden="true">Type</td>
              <td class="py-1.5 pr-4 text-right">
                <button
                  type="button"
                  class="sort"
                  :aria-label="dateOrder === 'DESC' ? 'Date, newest first' : 'Date, oldest first'"
                  @click="dateOrder = dateOrder === 'DESC' ? 'ASC' : 'DESC'"
                >
                  Date<UiIcon :name="dateOrder === 'DESC' ? 'sort-desc' : 'sort-asc'" class="ml-0.5" />
                </button>
              </td>
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
        <table v-if="!isResorting" class="w-full table-fixed text-sm" aria-label="Records">
          <colgroup>
            <col class="w-14" />
            <col />
            <col class="w-[3.25rem]" />
            <col class="w-[5.4rem]" />
          </colgroup>
          <thead class="sr-only">
            <tr>
              <th scope="col">Photo</th>
              <th scope="col">Species</th>
              <th scope="col">Type</th>
              <th scope="col" :aria-sort="dateOrder === 'DESC' ? 'descending' : 'ascending'">Date</th>
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
                :is-name-pending="names.isNamePending(occurrence)"
                :scientific-name-style="scientificNameStyle(occurrence)"
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

        <ListSkeleton
          v-if="loading"
          :label="isResorting ? 'Loading records' : 'Loading more records'"
          :rows="isResorting ? RESORT_SKELETON_ROWS : 3"
        >
          <span class="flex w-[3.25rem] shrink-0 justify-center">
            <SkeletonBlock width="2rem" height="1rem" rounded="sm" />
          </span>
          <span class="flex w-[5.4rem] shrink-0 justify-end"><SkeletonBlock width="4rem" height="0.75rem" /></span>
        </ListSkeleton>
        <button
          v-else-if="total !== null && hasMore"
          type="button"
          class="mx-4 mt-2 w-[calc(100%-2rem)] rounded-md border border-border py-1 text-sm hover:bg-surface-2"
          @click="load('more')"
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
.sort {
  color: inherit;
}
.sort:hover {
  color: var(--text);
}
.head-row {
  overflow-y: hidden;
  scrollbar-gutter: stable;
  box-shadow: inset 0 -1px 0 var(--border-strong);
}
</style>
