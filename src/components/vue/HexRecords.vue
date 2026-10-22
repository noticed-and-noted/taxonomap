<script setup lang="ts">
/**
 * Individual records in the selected cell, a page at a time in GBIF's order,
 * as a table with a short record type code (FOS, SPE…; the full type on hover).
 * A row expands to its photo (opening a lightbox of all its photos) and details. No column sorts: GBIF's occurrence
 * search has no sort parameter. A species search (ARIA 1.2 combobox over the cell's species table) narrows the list.
 * Pass `filter` to list another area's records (near me) instead of the selected cell's.
 */
import { useStore } from '@nanostores/vue';
import { computed, nextTick, ref, shallowRef, useId, watch } from 'vue';
import { BASIS_LABELS, full } from '~/lib/format';
import { normalise } from '~/lib/data/name-index';
import { searchOccurrences, usableImages, type Occurrence, type OccurrenceFilter, type UsableImage } from '~/lib/gbif';
import LicenceBadge from './LicenceBadge.vue';
import PhotoLightbox from './PhotoLightbox.vue';
import { commonNames as lookupCommonNames, resolveNames, type SpeciesRow } from '~/lib/species/groups';
import { $speciesManifest, speciesPath } from '~/lib/species/links';
import { $hexGeometry, $occurrenceFilter } from '~/stores/explorer';
import ListSkeleton from './ListSkeleton.vue';
import SearchSpinner from './SearchSpinner.vue';
import SkeletonBlock from './SkeletonBlock.vue';
import ThumbImage from './ThumbImage.vue';
import UiIcon from './UiIcon.vue';
import { useCellNameSearch } from './useCellNameSearch';
import { useLatestLoad } from './useLatestLoad';
import { useScrollFade } from './useScrollFade';
import { useSettledQuery } from './useSettledQuery';

const PAGE = 20;
const MAX_OPTIONS = 8;
/** Common names looked up per request batch, so they appear as they arrive. */
const NAME_BATCH = 20;

const TYPE_CODES: Record<string, string> = {
  HUMAN_OBSERVATION: 'OBS',
  MACHINE_OBSERVATION: 'MAC',
  PRESERVED_SPECIMEN: 'SPE',
  LIVING_SPECIMEN: 'LIV',
  FOSSIL_SPECIMEN: 'FOS',
  MATERIAL_SAMPLE: 'SAM',
  MATERIAL_CITATION: 'CIT',
  OCCURRENCE: 'OCC',
  OBSERVATION: 'OBS',
};

const props = defineProps<{ species: readonly SpeciesRow[]; filter?: OccurrenceFilter | null; fill?: boolean }>();

const geometry = useStore($hexGeometry);
const storeFilter = useStore($occurrenceFilter);
const manifest = useStore($speciesManifest);
const { loading, error, run } = useLatestLoad();
const base = computed(
  () => props.filter ?? (geometry.value ? { ...storeFilter.value, geometry: geometry.value.wkt } : null),
);

/** Chosen speciesKey, or '' for all species. */
const speciesKey = ref<number | ''>('');
const records = shallowRef<Occurrence[]>([]);
/** Expanded row's occurrence key. */
const expanded = ref<number | null>(null);
const total = ref<number | null>(null);
const scroller = ref<HTMLElement>();
const { fadeBottom, update: updateFade } = useScrollFade(scroller);
watch(records, () => void nextTick(updateFade));

// The species' name, as everywhere else: the cell's species table's, else looked up (see nameSpecies). The
// name a recorder typed on the record is only a fallback, so one species doesn't show under several names.
const commonNames = computed(
  () =>
    new Map(props.species.filter((species) => species.commonName).map((species) => [species.key, species.commonName!])),
);
const lateNames = shallowRef(new Map<number, string>());
/** Scientific names looked up for species the index didn't name ("Species 123"). */
const lateScientificNames = shallowRef(new Map<number, string>());

const uniqueId = useId();
const query = ref('');
const open = ref(false);
const active = ref(-1);
const speciesCommonName = (species: SpeciesRow) => species.commonName ?? lateNames.value.get(species.key);
const speciesScientificName = (species: SpeciesRow) =>
  lateScientificNames.value.get(species.key) ?? species.scientificName;
const label = (species: SpeciesRow) => speciesCommonName(species) ?? speciesScientificName(species);
// Names already known match as you type; the name search adds species named nowhere here yet.
const nameSearch = useCellNameSearch({ query, species: () => props.species, area: () => base.value });
const cellOptions = computed(() => {
  const needle = normalise(query.value);
  return [...props.species]
    .filter((species) => {
      if (!needle || nameSearch.matchedKeys.value.has(species.key)) return true;
      // Not the "Species 123" placeholder, which would match "sp".
      const hasScientificName = !species.unnamed || lateScientificNames.value.has(species.key);
      return [speciesCommonName(species), hasScientificName ? speciesScientificName(species) : undefined].some(
        (name) => name !== undefined && normalise(name).includes(needle),
      );
    })
    .sort((left, right) => right.records - left.records)
    .slice(0, MAX_OPTIONS);
});

const options = computed(() => [...cellOptions.value, ...nameSearch.outside.value].slice(0, MAX_OPTIONS));
const activeId = computed(() => (active.value >= 0 ? `${uniqueId}-opt-${active.value}` : undefined));

function pick(species: SpeciesRow | undefined) {
  speciesKey.value = species?.key ?? '';
  query.value = species ? label(species) : '';
  open.value = false;
  active.value = -1;
}

function onInput() {
  open.value = true;
  active.value = -1;
  // Emptying the box goes back to all species.
  if (!query.value.trim() && speciesKey.value !== '') speciesKey.value = '';
}

function onKey(event: KeyboardEvent) {
  const count = options.value.length;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    open.value = true;
    if (count) active.value = (active.value + (event.key === 'ArrowDown' ? 1 : -1) + count) % count;
  } else if (event.key === 'Enter' && open.value) {
    const option = options.value[active.value] ?? (count === 1 ? options.value[0] : undefined);
    if (option) {
      event.preventDefault();
      pick(option);
    }
  } else if (event.key === 'Escape' && open.value) {
    event.stopPropagation();
    open.value = false;
  }
}

/** Taxon for the about page: the species, else whatever the record was named to (a genus or family). */
const aboutKey = (occurrence: Occurrence) =>
  occurrence.speciesKey ?? occurrence.acceptedTaxonKey ?? occurrence.taxonKey;

const common = (occurrence: Occurrence) => {
  const key = aboutKey(occurrence);
  return (key ? (commonNames.value.get(key) ?? lateNames.value.get(key)) : undefined) ?? occurrence.vernacularName;
};
// The accepted name, so the row matches the about page it links to (a synonym's record shows its accepted taxon).
const scientificName = (occurrence: Occurrence) =>
  occurrence.species ?? occurrence.acceptedScientificName ?? occurrence.scientificName;
const name = (occurrence: Occurrence) => common(occurrence) ?? scientificName(occurrence) ?? 'Unnamed record';

/** Names for species the table hasn't named (cached, as on species pages), a batch at a time; rows show meanwhile. */
async function nameSpecies(keys: Iterable<number | undefined>, signal?: AbortSignal) {
  const missing = [...new Set(keys)].filter(
    (key): key is number => key !== undefined && !commonNames.value.has(key) && !lateNames.value.has(key),
  );
  for (let start = 0; start < missing.length; start += NAME_BATCH) {
    const found = await lookupCommonNames(missing.slice(start, start + NAME_BATCH), signal);
    if (signal?.aborted) return;
    if (found.size) lateNames.value = new Map([...lateNames.value, ...found]);
  }
}

// The index has common names for few species, so the options on show look up the rest. Matching
// doesn't need them: the name search (see useCellNameSearch) finds species by names not known here.
const askedNames = new Set<number>();
/** Keys whose names are being looked up for the options. */
const pendingNames = shallowRef(new Set<number>());

/** Names for unnamed species ("Species 123"), so their options show a real name. */
async function nameUnnamed(keys: readonly number[]) {
  const unnamed = new Set(props.species.flatMap((species) => (species.unnamed ? [species.key] : [])));
  const found = await resolveNames(keys.filter((key) => unnamed.has(key)));
  if (found.size) lateScientificNames.value = new Map([...lateScientificNames.value, ...found]);
}

/** Looks up names for the options a batch at a time, marking each batch pending until it's back. */
async function nameOptions(keys: readonly number[]) {
  const fresh = keys.filter((key) => !askedNames.has(key));
  for (const key of fresh) askedNames.add(key);
  pendingNames.value = new Set([...pendingNames.value, ...fresh]);
  for (let start = 0; start < fresh.length; start += NAME_BATCH) {
    const batch = new Set(fresh.slice(start, start + NAME_BATCH));
    try {
      await Promise.all([nameSpecies(batch), nameUnnamed([...batch])]);
    } finally {
      pendingNames.value = new Set([...pendingNames.value].filter((key) => !batch.has(key)));
    }
  }
}

// A request each, so typing names the options once it pauses.
const { settled: settledQuery, isSettling } = useSettledQuery(query);
watch([() => props.species, settledQuery, open], async ([, text, isOpen]) => {
  if (!isOpen && !text.trim()) return;
  await nameOptions(cellOptions.value.map((option) => option.key));
});
const isNaming = computed(
  () => pendingNames.value.size > 0 || nameSearch.loading.value || (!!query.value.trim() && isSettling.value),
);
const hasNoResults = computed(() => !!query.value.trim() && !options.value.length && !isNaming.value);
const showOptions = computed(() => open.value && (options.value.length > 0 || hasNoResults.value));

async function load(more = false) {
  const baseFilter = base.value;
  if (!more) records.value = [];
  if (!baseFilter) return;
  await run(async (signal) => {
    const pageFilter = { ...baseFilter, ...(speciesKey.value !== '' && { speciesKeys: [speciesKey.value] }) };
    const response = await searchOccurrences(
      pageFilter,
      { limit: PAGE, offset: more ? records.value.length : 0 },
      signal,
    );
    if (signal.aborted) return;
    records.value = more ? [...records.value, ...response.results] : response.results;
    if (!more) expanded.value = null;
    void nameSpecies(response.results.map(aboutKey), signal);
    total.value = response.count;
  });
}

// Another cell, area or filter: the picked species may not be there any more.
watch(
  () => JSON.stringify(base.value),
  () => {
    query.value = '';
    if (speciesKey.value === '') void load();
    else speciesKey.value = ''; // the watch below reloads
  },
  { immediate: true },
);
watch(speciesKey, () => void load());

const date = (occurrence: Occurrence) =>
  occurrence.eventDate?.slice(0, 10) ?? (occurrence.year ? String(occurrence.year) : undefined);
const typeLabel = (occurrence: Occurrence) =>
  (occurrence.basisOfRecord && (BASIS_LABELS[occurrence.basisOfRecord] ?? occurrence.basisOfRecord)) || 'Unknown';
/** Photo URLs that failed to load; they drop out of the row and the lightbox. */
const broken = ref(new Set<string>());
const photos = (occurrence: Occurrence) => usableImages(occurrence).filter((photo) => !broken.value.has(photo.url));
const image = (occurrence: Occurrence) => photos(occurrence)[0];
const markBroken = (photo: UsableImage) => (broken.value = new Set(broken.value).add(photo.url));

const lightbox = ref<InstanceType<typeof PhotoLightbox>>();
/** Record whose photos the lightbox shows. */
const lightboxRecord = shallowRef<Occurrence | null>(null);
const lightboxPhotos = computed(() => (lightboxRecord.value ? photos(lightboxRecord.value) : []));

/** Opens the lightbox on a record's photos, once it has them as props. */
async function openPhotos(occurrence: Occurrence) {
  lightboxRecord.value = occurrence;
  await nextTick();
  lightbox.value?.open(0);
}
const initials = (occurrence: Occurrence) =>
  name(occurrence)
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join('');

/**
 * Scroll only the list (not the panel) so `el` is in view: the animation draws above the
 * list, unclipped, so its end point must be inside the list for it to stay inside.
 */
function revealInList(element: HTMLElement | null) {
  const box = scroller.value;
  if (!element || !box) return;
  const boxRect = box.getBoundingClientRect();
  // The panel body may hide the list's lower edge; use whichever bottom is higher.
  const panel = box.parentElement?.closest<HTMLElement>('.overflow-y-auto');
  const bottom = Math.min(boxRect.bottom, panel?.getBoundingClientRect().bottom ?? Infinity);
  const rowRect = element.getBoundingClientRect();
  if (rowRect.bottom > bottom) box.scrollTop += Math.min(rowRect.bottom - bottom, rowRect.top - boxRect.top);
}

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
  void nextTick(() => {
    const transition = document.startViewTransition(async () => {
      expanded.value = next;
      await nextTick();
      if (next !== null) revealInList(document.getElementById(`${uniqueId}-rec-${next}`));
    });
    void transition.finished.finally(() => {
      if (animating.value === occurrence.key) animating.value = null;
    });
  });
}

const institution = (occurrence: Occurrence) =>
  [occurrence.institutionCode, occurrence.catalogNumber].filter(Boolean).join(' ');
</script>

<template>
  <div :class="fill ? 'flex min-h-0 flex-1 flex-col gap-2' : 'space-y-2'">
    <div class="relative text-sm">
      <label :for="`${uniqueId}-input`" class="sr-only">Filter records by species</label>
      <svg
        class="pointer-events-none absolute left-2.5 top-[1.0625rem] size-3.5 -translate-y-1/2 text-subtle"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input
        :id="`${uniqueId}-input`"
        v-model="query"
        type="search"
        class="w-full rounded-md border border-border-strong bg-surface-2 py-1.5 pl-8 text-sm placeholder:text-subtle focus:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus)] disabled:opacity-60"
        :class="isNaming && !query ? 'pr-8' : ['pr-2', { 'search-spinner-room': isNaming }]"
        role="combobox"
        autocomplete="off"
        placeholder="Filter by species"
        :disabled="!species.length"
        :aria-expanded="showOptions"
        :aria-controls="`${uniqueId}-list`"
        aria-autocomplete="list"
        :aria-activedescendant="activeId"
        @focus="open = true"
        @blur="open = false"
        @input="onInput"
        @keydown="onKey"
      />
      <SearchSpinner :active="isNaming" class="top-[1.0625rem]" :class="query ? 'search-spinner-gap' : 'right-2.5'" />
      <ul
        v-show="showOptions"
        :id="`${uniqueId}-list`"
        role="listbox"
        class="options absolute inset-x-0 z-10 shadow"
        aria-label="Species in this cell"
      >
        <li
          v-for="(option, index) in options"
          :id="`${uniqueId}-opt-${index}`"
          :key="option.key"
          role="option"
          class="option"
          :class="{ active: index === active }"
          :aria-selected="option.key === speciesKey"
          @mousedown.prevent="pick(option)"
        >
          <span class="min-w-0 truncate" :class="{ 'sci-name': !speciesCommonName(option) }">{{ label(option) }}</span>
          <span class="shrink-0 text-[11px] text-subtle tabular-nums">{{ full(option.records) }}</span>
        </li>
        <li v-if="hasNoResults" role="option" aria-disabled="true" class="option text-muted">No results found</li>
      </ul>
    </div>

    <div v-if="error" class="rounded-md bg-surface-2 p-3 text-sm text-muted" role="alert">
      Records could not be loaded.
      <button type="button" class="ml-1 text-text underline" @click="load()">Try again</button>
    </div>

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
        :class="[fill ? 'min-h-48 flex-1' : 'max-h-[min(23rem,65dvh)]', { 'fade-bottom': fadeBottom }]"
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
          <tbody>
            <template v-for="occurrence in records" :key="occurrence.key">
              <tr
                class="record cursor-pointer border-b border-border hover:bg-surface-2"
                :data-type="occurrence.basisOfRecord"
                @click="toggle(occurrence)"
              >
                <td v-if="expanded !== occurrence.key" class="py-1.5 pl-4 pr-2">
                  <span
                    class="block size-8 overflow-hidden rounded bg-photo"
                    :style="transitionName(occurrence, 'photo')"
                  >
                    <ThumbImage
                      v-if="image(occurrence)"
                      :image="image(occurrence)!"
                      size="200x"
                      class="size-full object-cover"
                      @broken="markBroken(image(occurrence)!)"
                    />
                    <span v-else class="grid size-full place-items-center font-display text-xs text-subtle">
                      {{ initials(occurrence) }}
                    </span>
                  </span>
                </td>
                <!-- Expanded, the photo is in the details below and the name takes its column. -->
                <td
                  :colspan="expanded === occurrence.key ? 2 : 1"
                  class="py-1.5 pr-2"
                  :class="{ 'pl-4': expanded === occurrence.key }"
                >
                  <!-- Two lines' height (h-9) so the row doesn't grow when a common name arrives. -->
                  <button
                    type="button"
                    class="flex h-9 w-full min-w-0 cursor-pointer items-center text-left"
                    :aria-expanded="expanded === occurrence.key"
                    :aria-controls="`${uniqueId}-rec-${occurrence.key}`"
                    @click.stop="toggle(occurrence)"
                  >
                    <span class="inline-block max-w-full align-top" :style="transitionName(occurrence, 'name')">
                      <span class="block truncate" :class="{ 'sci-name': !common(occurrence) }">{{
                        name(occurrence)
                      }}</span>
                      <span
                        v-if="common(occurrence) && scientificName(occurrence)"
                        class="sci-name block truncate text-xs text-muted"
                        >{{ scientificName(occurrence) }}</span
                      >
                    </span>
                  </button>
                </td>
                <td class="py-1.5">
                  <span
                    class="type-code"
                    tabindex="0"
                    :data-tip="typeLabel(occurrence)"
                    :aria-label="typeLabel(occurrence)"
                    >{{ TYPE_CODES[occurrence.basisOfRecord ?? ''] ?? '—' }}</span
                  >
                </td>
                <td class="truncate py-1.5 pr-4 text-xs tabular-nums">{{ date(occurrence) ?? '—' }}</td>
              </tr>
              <tr
                v-if="expanded === occurrence.key"
                :id="`${uniqueId}-rec-${occurrence.key}`"
                class="border-b border-border"
              >
                <td colspan="4" class="bg-surface-2 px-4 py-3">
                  <div class="grid grid-cols-2 items-start gap-3">
                    <div
                      class="relative aspect-square overflow-hidden rounded bg-photo"
                      :style="transitionName(occurrence, 'photo')"
                    >
                      <template v-if="image(occurrence)">
                        <!-- The row's 200x thumbnail is already cached: show it at once, and fade the sharper 400x in over it. -->
                        <ThumbImage
                          :image="image(occurrence)!"
                          size="200x"
                          class="absolute inset-0 size-full object-cover"
                        />
                        <ThumbImage
                          :image="image(occurrence)!"
                          size="400x"
                          class="absolute inset-0 size-full object-cover"
                          @broken="markBroken(image(occurrence)!)"
                        />
                        <!-- A sibling of the badge, not its parent: the badge holds a link. -->
                        <button
                          type="button"
                          class="enlarge absolute inset-0 cursor-zoom-in"
                          :aria-label="`Enlarge photo, 1 of ${photos(occurrence).length}`"
                          @click="openPhotos(occurrence)"
                        >
                          <span
                            class="absolute right-1 top-1 flex items-center gap-1 rounded-sm bg-black/55 px-1.5 backdrop-blur-sm py-0.5 text-[11px] text-white tabular-nums"
                            aria-hidden="true"
                          >
                            <UiIcon name="photo" size="13" />{{ photos(occurrence).length }}
                          </span>
                        </button>
                        <LicenceBadge
                          class="absolute bottom-1 left-1 max-w-[calc(100%-0.5rem)]"
                          :licence="image(occurrence)!.licence"
                          :creator="image(occurrence)!.creator"
                          :rights-holder="image(occurrence)!.rightsHolder"
                        />
                      </template>
                      <span v-else class="grid size-full place-items-center font-display text-xl text-subtle">
                        {{ initials(occurrence) }}
                      </span>
                    </div>
                    <!-- Stretched to the photo's height so the buttons line up with its bottom edge. -->
                    <dl class="flex min-w-0 flex-col gap-1 self-stretch text-xs [overflow-wrap:anywhere]">
                      <div v-if="occurrence.recordedBy">
                        <dt class="text-subtle">Recorded by</dt>
                        <dd>{{ occurrence.recordedBy }}</dd>
                      </div>
                      <div v-if="institution(occurrence)">
                        <dt class="text-subtle">Institution</dt>
                        <dd>{{ institution(occurrence) }}</dd>
                      </div>
                      <div v-if="occurrence.datasetName ?? occurrence.publisher">
                        <dt class="text-subtle">Source</dt>
                        <dd>{{ occurrence.datasetName ?? occurrence.publisher }}</dd>
                      </div>
                      <dd class="mt-auto flex gap-1.5">
                        <a
                          v-if="aboutKey(occurrence)"
                          :href="speciesPath(aboutKey(occurrence)!, manifest)"
                          class="record-action record-action-icon"
                          :aria-label="`About ${name(occurrence)}`"
                          :title="`About ${name(occurrence)}`"
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <circle cx="12" cy="12" r="9" />
                            <path d="M12 11v5M12 8h.01" />
                          </svg>
                        </a>
                        <a
                          :href="`https://www.gbif.org/occurrence/${occurrence.key}`"
                          target="_blank"
                          rel="noopener"
                          class="record-action"
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
                          </svg>
                          GBIF<span class="sr-only"> record (opens in a new tab)</span>
                        </a>
                      </dd>
                    </dl>
                  </div>
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
    <PhotoLightbox ref="lightbox" :images="lightboxPhotos" :name="lightboxRecord ? name(lightboxRecord) : ''" />
  </div>
</template>

<style scoped>
/* Type colours: ≥4.5:1 on the code's tint in each theme. */
.record {
  --type: var(--text-muted);
}
.record[data-type='HUMAN_OBSERVATION'] {
  --type: #5dcaa5;
}
.record[data-type='FOSSIL_SPECIMEN'] {
  --type: #f0997b;
}
.record[data-type='PRESERVED_SPECIMEN'],
.record[data-type='LIVING_SPECIMEN'] {
  --type: #afa9ec;
}
.record[data-type='MACHINE_OBSERVATION'] {
  --type: #b4b2a9;
}
.record[data-type='MATERIAL_SAMPLE'],
.record[data-type='MATERIAL_CITATION'] {
  --type: #85b7eb;
}
:root[data-theme='light'] .record[data-type='HUMAN_OBSERVATION'] {
  --type: #0f6e56;
}
:root[data-theme='light'] .record[data-type='FOSSIL_SPECIMEN'] {
  --type: #993c1d;
}
:root[data-theme='light'] .record[data-type='PRESERVED_SPECIMEN'],
:root[data-theme='light'] .record[data-type='LIVING_SPECIMEN'] {
  --type: #534ab7;
}
:root[data-theme='light'] .record[data-type='MACHINE_OBSERVATION'] {
  --type: #5f5e5a;
}
:root[data-theme='light'] .record[data-type='MATERIAL_SAMPLE'],
:root[data-theme='light'] .record[data-type='MATERIAL_CITATION'] {
  --type: #185fa5;
}
.type-code {
  position: relative;
  display: inline-block;
  padding: 0.0625rem 0.25rem;
  border-radius: var(--radius-sm);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.02em;
  color: var(--type);
  background: color-mix(in srgb, var(--type) 16%, transparent);
}
/* Tooltip to the left, so the scroll box never clips it above or below. */
.type-code::after {
  content: attr(data-tip);
  position: absolute;
  right: calc(100% + 0.375rem);
  top: 50%;
  translate: 0 -50%;
  z-index: 2;
  padding: 0.125rem 0.375rem;
  border-radius: var(--radius-sm);
  background: var(--text);
  color: var(--bg);
  font-weight: 400;
  letter-spacing: 0;
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  transition: opacity 120ms;
}
.type-code:hover::after,
.type-code:focus-visible::after {
  opacity: 1;
}
.record-action {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  min-height: 2rem;
  padding: 0 0.625rem;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  color: var(--text);
  transition: background-color var(--dur-fast) var(--ease);
}
.record-action-icon {
  justify-content: center;
  min-width: 2rem;
  padding: 0;
}
.record-action:hover {
  background: var(--surface-3);
}
.record-action:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}
.record-action svg {
  width: 0.875rem;
  height: 0.875rem;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.record-action-icon svg {
  width: 1.125rem;
  height: 1.125rem;
}
@media (max-width: 767px) {
  .record-action {
    min-height: 2.5rem;
  }
  .record-action-icon {
    min-width: 2.5rem;
  }
}
.enlarge:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: -2px;
}
.head-row {
  overflow-y: hidden;
  scrollbar-gutter: stable;
  box-shadow: inset 0 -1px 0 var(--border-strong);
}

.options {
  margin-top: 0.25rem;
  padding: 0.25rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--surface);
}
.option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.375rem 0.5rem;
  border-radius: var(--radius-sm);
  cursor: pointer;
}
.option.active,
.option:hover {
  background: var(--surface-2);
}
</style>
