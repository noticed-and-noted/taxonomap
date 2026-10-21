<script setup lang="ts">
/**
 * Header search (client:idle). What a species or group pick does depends on
 * the page (`mode`): on the map it adds it to the What filter's taxa (records
 * of any are shown); on the tree it moves the tree there (the filter is left
 * alone); on other pages it opens that result's About page. Species: see
 * useNameSearch. Places: geocoder on submit only (Nominatim policy).
 * The first result is highlighted until you arrow, so Enter picks it. The
 * highlighted species result is previewed beside the list, with a link to its
 * About page; Cmd/Ctrl-Enter opens that page, and Cmd/Ctrl-Shift-Enter
 * searches places (or, from places, goes back to species and groups). ARIA 1.2 combobox with a listbox popup.
 */
import { navigate } from 'astro:transitions/client';
import { useStore } from '@nanostores/vue';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { loadNameIndex } from '~/lib/data/name-index';
import { compact, RANK_LABELS } from '~/lib/format';
import { searchPlaces, type Place } from '~/lib/geocode';
import { mapCapabilities, sortByRank, type NameHit } from '~/lib/gbif';
import { $speciesManifest, loadSpeciesManifest, speciesPath } from '~/lib/species/links';
import { $flyTo, MAX_TAXA, viewParam } from '~/stores/explorer';
import { addTaxon, taxonFromHit } from '~/stores/taxon';
import { $treeFocus } from '~/stores/tree';
import { hrefWith } from '~/stores/url-sync';
import SkeletonBlock from './SkeletonBlock.vue';
import TaxonPreview from './TaxonPreview.vue';
import { useNameSearch } from './useNameSearch';

/** What picking a species or group does: add it to the map, move the tree there, or open its About page. */
export type SearchMode = 'map' | 'tree' | 'about';
const props = defineProps<{ mode: SearchMode }>();

type Option =
  | { kind: 'taxon'; id: string; hit: NameHit }
  | { kind: 'place-search'; id: string }
  | { kind: 'place'; id: string; place: Place };

/** Species and group results shown at once. */
const MAX_RESULTS = 20;
// The omnibox hydrates on idle, and hydrating v-model empties the input, so
// read anything typed before then from the server-rendered box first.
const query = ref(
  import.meta.env.SSR ? '' : ((document.getElementById('omnibox-input') as HTMLInputElement | null)?.value ?? ''),
);
const open = ref(false);
/** Highlighted row; the first result by default, so Enter picks it. */
const active = ref(0);
const {
  hits: taxa,
  loading: liveLoading,
  failed: liveFailed,
  search,
  reset: resetSearch,
} = useNameSearch({
  max: MAX_RESULTS,
});
const places = ref<Place[] | null>(null);
const placeLoading = ref(false);
const placeFailed = ref(false);
const input = ref<HTMLInputElement>();

/* Short note shown under the box when a pick could not be applied (the What list is full). */
const notice = ref('');
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
function announce(text: string) {
  notice.value = text;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => (notice.value = ''), 5000);
}

/** What is loading, if anything: shown in the place row's spot. */
const searching = computed(() =>
  placeLoading.value ? 'places' : liveLoading.value && !places.value ? 'species' : null,
);

/** Placeholder rows to show while results load: enough to make three rows with what's in. */
const placeholderRows = computed(() => (searching.value ? Math.max(0, 3 - listOptions.value.length) : 0));

const options = computed<Option[]>(() => {
  if (places.value) return places.value.map((place, index) => ({ kind: 'place', id: `omni-place-${index}`, place }));
  const suggestions: Option[] = sortByRank(taxa.value).map((hit) => ({
    kind: 'taxon',
    id: `omni-taxon-${hit.key}`,
    hit,
  }));
  if (query.value.trim().length >= 2) suggestions.push({ kind: 'place-search', id: 'omni-place-search' });
  return suggestions;
});

/* "Search places" is always last, so the scrolling rows keep their indexes into `options`. */
const listOptions = computed(() => options.value.filter((option) => option.kind !== 'place-search'));

/** Whether the scrolling list has anything in it; an empty one would leave stray padding above the place row. */
const hasRows = computed(() => listOptions.value.length > 0 || placeholderRows.value > 0);

const placeSearchOption = computed(() => options.value.find((option) => option.kind === 'place-search'));

const activeId = computed(() => options.value[active.value]?.id);

/** The result to preview: the highlighted species/group (the first, if the highlight's row has gone). */
const previewHit = computed<NameHit | null>(() => {
  if (places.value) return null;
  const option = options.value[active.value] ?? options.value[0];
  return option?.kind === 'taxon' ? option.hit : null;
});

const manifest = useStore($speciesManifest);
/**
 * Every rank has an About page (pre-rendered, or /species/view); that page
 * falls back to the tree if it cannot load the taxon.
 */
const aboutHref = (hit: NameHit) => speciesPath(hit.key, manifest.value);

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const modKey = isMac ? '⌘' : 'Ctrl';
/** What Enter does right now, for the hint bar. */
const enterLabel = computed(() => {
  const option = options.value[active.value];
  if (option?.kind === 'taxon') return selectLabel() ?? 'About';
  if (option?.kind === 'place') return 'Go to place';
  return 'Search places';
});

/** Empty the box and put the list away once a result is picked. */
function finishPick() {
  query.value = '';
  places.value = null;
  resetSearch();
  close();
  input.value?.blur();
}

function openAbout(hit: NameHit) {
  const href = aboutHref(hit);
  finishPick();
  void navigate(href);
}

function onInput() {
  places.value = null;
  placeFailed.value = false;
  open.value = true;
  active.value = 0;
  search(query.value);
}

function onFocus() {
  void loadNameIndex(); // warm the index on first focus
  void loadSpeciesManifest(); // so About links go to pre-rendered pages
  if (query.value) open.value = true;
}

function close() {
  open.value = false;
  active.value = 0;
}

async function runPlaceSearch() {
  const trimmed = query.value.trim();
  if (!trimmed) return;
  placeLoading.value = true;
  placeFailed.value = false;
  // Switch to the (empty) places list now, so its placeholder rows show while the geocoder answers.
  places.value = [];
  active.value = 0;
  try {
    const found = await searchPlaces(trimmed);
    // Gone back to species, or typed, while the geocoder answered.
    if (!places.value) return;
    places.value = found;
    open.value = true;
    active.value = 0;
  } catch {
    if (!places.value) return;
    placeFailed.value = true;
    places.value = [];
  } finally {
    placeLoading.value = false;
  }
}

/** Leave the places list for the species and group results still behind it. */
function showSpecies() {
  places.value = null;
  placeLoading.value = false;
  placeFailed.value = false;
  open.value = true;
  active.value = 0;
}

/** Label for picking a result in place; undefined where a pick opens its About page. */
function selectLabel(): string | undefined {
  if (props.mode === 'map') return 'Add to map';
  if (props.mode === 'tree') return 'Show in tree';
  return undefined;
}

async function pickTaxon(hit: NameHit) {
  if (props.mode === 'about') {
    openAbout(hit);
    return;
  }
  finishPick();
  // The tree browses on its own; only "View on map" there touches the filter.
  if (props.mode === 'tree') {
    $treeFocus.set(hit.key);
    return;
  }
  const result = addTaxon(taxonFromHit(hit));
  if (result === 'full') {
    announce(`You can show up to ${MAX_TAXA} species or groups. Remove one in the What filter first.`);
    return;
  }
  try {
    const capabilities = await mapCapabilities({ taxonKey: hit.key });
    if (capabilities.total > 0) {
      $flyTo.set({
        kind: 'bounds',
        bbox: [capabilities.minLng, capabilities.minLat, capabilities.maxLng, capabilities.maxLat],
        maxZoom: 6,
      });
    }
  } catch {
    /* stay where we are */
  }
}

function pickPlace(place: Place) {
  finishPick();
  if (props.mode !== 'map') {
    void navigate(hrefWith('/', { view: viewParam({ lng: place.lng, lat: place.lat, zoom: place.bbox ? 8 : 10 }) }));
    return;
  }
  $flyTo.set(
    place.bbox
      ? { kind: 'bounds', bbox: place.bbox, maxZoom: 12 }
      : { kind: 'point', lng: place.lng, lat: place.lat, zoom: 10 },
  );
}

function choose(option: Option | undefined) {
  if (!option) return;
  if (option.kind === 'taxon') void pickTaxon(option.hit);
  else if (option.kind === 'place') pickPlace(option.place);
  else void runPlaceSearch();
}

function onKeydown(event: KeyboardEvent) {
  const count = options.value.length;
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    open.value = true;
    active.value = count ? (active.value + 1) % count : 0;
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    active.value = count ? (active.value - 1 + count) % count : 0;
  } else if (event.key === 'Enter') {
    event.preventDefault();
    if ((event.metaKey || event.ctrlKey) && event.shiftKey) {
      if (places.value) showSpecies();
      else void runPlaceSearch();
    } else if ((event.metaKey || event.ctrlKey) && previewHit.value) openAbout(previewHit.value);
    else if (options.value[active.value]) choose(options.value[active.value]);
    // Nothing to pick yet (still loading, or no matches): look for a place.
    else void runPlaceSearch();
  } else if (event.key === 'Escape') {
    if (open.value) close();
    else query.value = '';
  }
}

function onBlur(event: FocusEvent) {
  const next = event.relatedTarget as Node | null;
  if (!next || !(event.currentTarget as HTMLElement).parentElement?.contains(next)) close();
}

/* Keep the dropdown inside the visible area: on-screen keyboards shrink the
   visual viewport (not the layout one) on iOS and Android, hiding its foot. */
const dropdown = ref<HTMLDivElement>();
const fitHeight = ref<number | null>(null);
function fit() {
  if (!open.value || !dropdown.value) return;
  const viewport = window.visualViewport;
  const bottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
  fitHeight.value = Math.max(160, Math.floor(bottom - dropdown.value.getBoundingClientRect().top - 8));
}
watch(open, (isOpen) => (isOpen ? void nextTick(fit) : undefined));

// Search for anything typed before hydration (see query).
onMounted(() => {
  window.visualViewport?.addEventListener('resize', fit);
  window.visualViewport?.addEventListener('scroll', fit);
  window.addEventListener('resize', fit);
  if (!query.value) return;
  if (document.activeElement === input.value) onFocus();
  onInput();
});

onBeforeUnmount(() => {
  clearTimeout(noticeTimer);
  window.visualViewport?.removeEventListener('resize', fit);
  window.visualViewport?.removeEventListener('scroll', fit);
  window.removeEventListener('resize', fit);
});
</script>

<template>
  <div class="omnibox relative w-full max-w-xl" @focusout="onBlur">
    <label for="omnibox-input" class="sr-only">Search species or places</label>
    <div
      class="flex items-center gap-2 rounded-[var(--radius)] border border-border bg-surface px-3 shadow-panel transition-colors duration-200 focus-within:border-accent focus-within:outline focus-within:outline-2 focus-within:outline-[var(--focus)]"
    >
      <svg
        viewBox="0 0 24 24"
        class="size-4 shrink-0 text-subtle"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <!-- A span, not the placeholder attribute: Chrome drops the placeholder's ellipsis while the input has focus. -->
      <div class="relative min-w-0 flex-1">
        <span
          v-if="!query"
          class="pointer-events-none absolute inset-0 truncate text-sm leading-[calc(var(--header-height)-2px)] text-subtle"
          aria-hidden="true"
          >Search species or places…</span
        >
        <input
          id="omnibox-input"
          ref="input"
          v-model="query"
          type="search"
          role="combobox"
          autocomplete="off"
          spellcheck="false"
          class="h-[calc(var(--header-height)-2px)] w-full min-w-0 bg-transparent text-sm text-ellipsis text-text focus:outline-none"
          aria-autocomplete="list"
          aria-controls="omnibox-listbox"
          :aria-expanded="open && options.length > 0"
          :aria-activedescendant="activeId"
          @input="onInput"
          @focus="onFocus"
          @keydown="onKeydown"
        />
      </div>
    </div>

    <div
      v-show="open && (options.length > 0 || searching || placeFailed || (places && !places.length))"
      ref="dropdown"
      class="dropdown absolute left-0 right-0 top-full z-40 mt-1 flex flex-col overflow-hidden rounded-md border border-border bg-surface shadow-panel"
      :class="{ 'with-preview': previewHit }"
      :style="fitHeight ? { maxHeight: `${fitHeight}px` } : undefined"
    >
      <!-- Only the list shrinks when space is short, so the preview stays in view. -->
      <div :class="{ 'with-preview': previewHit }" class="results flex min-h-0 flex-col">
        <!-- "Search places" sits below the scrolling rows, so it never moves as they scroll. -->
        <div
          id="omnibox-listbox"
          role="listbox"
          :aria-label="places ? 'Places' : 'Species and places'"
          class="flex min-h-0 min-w-0 flex-col"
        >
          <ul v-if="hasRows" role="presentation" class="max-h-[60vh] min-h-0 overflow-auto overscroll-contain py-1">
            <!-- Hover highlights for mice only: iOS treats a tap whose mousemove changes the page as a hover, and holds back the click. -->
            <li
              v-for="(option, index) in listOptions"
              :id="option.id"
              :key="option.id"
              role="option"
              :aria-selected="index === active"
              class="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm aria-selected:bg-accent-soft"
              @mousedown.prevent
              @click="choose(option)"
              @pointermove="$event.pointerType === 'mouse' && (active = index)"
            >
              <template v-if="option.kind === 'taxon'">
                <span class="min-w-0 flex-1">
                  <span v-if="option.hit.commonName" class="block truncate font-medium text-text">{{
                    option.hit.commonName
                  }}</span>
                  <span
                    class="sci-name block truncate"
                    :class="option.hit.commonName ? 'text-xs text-muted' : 'text-text'"
                    >{{ option.hit.scientificName }}</span
                  >
                </span>
                <span class="shrink-0 text-right text-[11px] leading-tight text-subtle">
                  <span class="block">{{ RANK_LABELS[option.hit.rank] ?? option.hit.rank }}</span>
                  <span v-if="option.hit.count" class="block">{{ compact(option.hit.count) }}</span>
                </span>
              </template>
              <template v-else-if="option.kind === 'place'">
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-text">{{ option.place.name }}</span>
                  <span v-if="option.place.detail" class="block truncate text-xs text-muted">{{
                    option.place.detail
                  }}</span>
                </span>
              </template>
            </li>
            <!-- Placeholder rows where results will land, so nothing jumps when they arrive. -->
            <template v-if="searching">
              <li
                v-for="row in placeholderRows"
                :key="`skel-${row}`"
                role="none"
                class="flex items-center gap-3 px-3 py-2"
                aria-hidden="true"
              >
                <span class="min-w-0 flex-1 space-y-1.5">
                  <SkeletonBlock :width="`${[55, 70, 45][row % 3]}%`" height="0.8rem" />
                  <SkeletonBlock :width="`${[32, 40, 36][row % 3]}%`" height="0.6rem" />
                </span>
                <SkeletonBlock width="2.25rem" height="0.7rem" />
              </li>
            </template>
          </ul>
          <div
            v-if="placeSearchOption"
            :id="placeSearchOption.id"
            role="option"
            :aria-selected="active === options.length - 1"
            :class="{ 'border-t': hasRows }"
            class="mt-auto flex shrink-0 cursor-pointer items-center gap-3 border-border px-3 py-2.5 text-sm aria-selected:bg-accent-soft"
            @mousedown.prevent
            @click="choose(placeSearchOption)"
            @pointermove="$event.pointerType === 'mouse' && (active = options.length - 1)"
          >
            <svg
              viewBox="0 0 24 24"
              class="size-4 text-subtle"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              aria-hidden="true"
            >
              <path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11Z" />
              <circle cx="12" cy="10" r="2.5" />
            </svg>
            <span class="text-muted">Search places for “{{ query.trim() }}”</span>
          </div>
          <span v-if="searching" role="none" class="sr-only">Searching {{ searching }}…</span>
        </div>
        <TaxonPreview
          v-if="previewHit"
          :hit="previewHit"
          :href="aboutHref(previewHit)"
          :about-label="'About'"
          :select-label="selectLabel()"
          @select="pickTaxon(previewHit)"
          @about="close"
        />
      </div>
      <p v-if="places && !places.length && !placeFailed && !placeLoading" class="px-3 py-2 text-sm text-muted">
        No places found.
      </p>
      <p v-if="placeFailed" class="px-3 py-2 text-sm text-muted">Place search is unavailable right now.</p>
      <p v-if="liveFailed && !places" class="border-t border-border px-3 py-1.5 text-xs text-subtle">
        Live species search is busy; showing saved names only.
      </p>
      <p v-if="options.length" class="hint-bar" aria-hidden="true">
        <span><kbd>↵</kbd> {{ enterLabel }}</span>
        <span v-if="previewHit && selectLabel()"
          ><kbd>{{ modKey }}</kbd> <kbd>↵</kbd> About</span
        >
        <span v-if="places || enterLabel !== 'Search places'"
          ><kbd>{{ modKey }}</kbd> <kbd>⇧</kbd> <kbd>↵</kbd> {{ places ? 'Species' : 'Places' }}</span
        >
        <span><kbd>↑</kbd> <kbd>↓</kbd> Move</span>
      </p>
    </div>
    <p
      v-if="notice && !open"
      class="notice absolute left-0 right-0 top-full z-40 mt-1 rounded-md border border-border bg-surface px-3 py-2 text-xs text-muted shadow-panel"
    >
      {{ notice }}
    </p>
    <p class="sr-only" aria-live="polite">
      {{ open ? `${taxa.length} species result${taxa.length === 1 ? '' : 's'}` : notice }}
    </p>
  </div>
</template>

<style scoped>
/* Phones: the box is narrow between the header pills, so the dropdown anchors
   to the (positioned) header instead and spans its full width. */
@media (max-width: 639.98px) {
  .omnibox {
    position: static;
  }
}

@media (min-width: 640px) {
  .results.with-preview {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 13rem;
  }
}

/* Wide screens: the preview extends past the bar's right edge (over the nav
   pills), so the results keep the bar's full width. */
@media (min-width: 1024px) {
  .dropdown.with-preview {
    right: auto;
    width: calc(100% + 14rem);
  }
  .results.with-preview {
    grid-template-columns: minmax(0, 1fr) 14rem;
  }
}

/* Keyboard hints: only where there is likely a keyboard. */
.hint-bar {
  display: none;
  gap: 1rem;
  padding: 0.375rem 0.75rem;
  border-top: 1px solid var(--border);
  font-size: 0.6875rem;
  color: var(--text-subtle);
}
@media (min-width: 640px) and (hover: hover) {
  .hint-bar {
    display: flex;
  }
}
kbd {
  display: inline-grid;
  place-items: center;
  min-width: 1.125rem;
  height: 1.125rem;
  padding: 0 0.25rem;
  border-radius: 4px;
  border: 1px solid var(--border-strong);
  font-family: inherit;
  font-size: 0.625rem;
  color: var(--text-muted);
}

/* Matches the box's px-3, so the clear button has equal space either side. */
input[type='search']::-webkit-search-cancel-button {
  flex-shrink: 0;
  margin-left: 0.75rem;
  cursor: pointer;
  filter: grayscale(1);
}
</style>
