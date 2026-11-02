<script setup lang="ts">
/**
 * Header search (client:idle). What a species or group pick does depends on
 * the page (`mode`): on the map it adds it to the What filter's taxa (records
 * of any are shown); on the tree it moves the tree there (the filter is left
 * alone); on other pages it opens that result's About page. Species: see
 * useNameSearch. Places: once you switch to them, typing stays on places,
 * searched as you type (usePlaceSearch), until you switch back to species.
 * The first result is highlighted until you arrow, so Enter picks it. The
 * highlighted species result is previewed beside the list, with a link to its
 * About page; Cmd/Ctrl-Enter opens that page, and Cmd/Ctrl-Shift-Enter
 * searches places (or, from places, goes back to species and groups). ARIA 1.2 combobox with a listbox popup.
 */
import { useStore } from '@nanostores/vue';
import { navigate } from 'astro:transitions/client';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue';
import SearchInput from '~/components/molecules/SearchInput.vue';
import { useNameSearch } from '~/composables/useNameSearch';
import { usePlaceSearch } from '~/composables/usePlaceSearch';
import { loadNameIndex } from '~/lib/data/name-index';
import { sortByRank, type NameHit } from '~/lib/gbif';
import type { Place } from '~/lib/geocode';
import { boundsAround, recordsView } from '~/lib/map/taxonView';
import { $speciesManifest, loadSpeciesManifest, speciesPath } from '~/lib/species/links';
import { $flyTo, $occurrenceFilter, MAX_TAXA, viewParam } from '~/stores/explorer';
import { $fitOnSearch } from '~/stores/fit-search';
import { $nearMode } from '~/stores/near';
import { markDone } from '~/stores/onboarding';
import { addTaxon, taxonFromHit } from '~/stores/taxon';
import { $treeFocus } from '~/stores/tree';
import { hrefWith } from '~/stores/url-sync';
import OmniboxHintBar from './OmniboxHintBar.vue';
import type { OmniboxOption as Option } from './omniboxOptions';
import OmniboxPlaceholderRow from './OmniboxPlaceholderRow.vue';
import OmniboxResult from './OmniboxResult.vue';
import TaxonPreview from './TaxonPreview.vue';

/** What picking a species or group does: add it to the map, move the tree there, or open its About page. */
export type SearchMode = 'map' | 'tree' | 'about';
const props = defineProps<{ mode: SearchMode }>();

/** Species and group results shown at once. */
const MAX_RESULTS = 20;
/** How long a notice under the box stays. */
const NOTICE_MS = 5000;
/** Rows the list fills to with placeholders while results load. */
const MIN_ROWS = 3;
/** Typed characters before the switch to places (or species) is offered. */
const MIN_SWITCH_QUERY = 2;
/** The dropdown's least height when an on-screen keyboard squeezes it. */
const MIN_DROPDOWN_HEIGHT = 160;
/** Room kept between the dropdown's foot and the visible area's. */
const DROPDOWN_MARGIN = 8;
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
  settle,
  reset: resetSearch,
} = useNameSearch({
  max: MAX_RESULTS,
  order: sortByRank,
});
/** Showing place results rather than species and groups; typing keeps it. */
const inPlaces = ref(false);
const {
  places,
  loading: placeLoading,
  failed: placeFailed,
  answered: placesAnswered,
  search: searchPlaces,
  flush: flushPlaces,
  reset: resetPlaces,
} = usePlaceSearch();
const searchBox = useTemplateRef('searchBox');
const input = computed(() => searchBox.value?.input);

/** Short note shown under the box when a pick could not be applied (the What list is full). */
const notice = ref('');
let noticeTimer: ReturnType<typeof setTimeout> | undefined;

/** Shows a notice under the box for a few seconds. */
function announce(text: string) {
  notice.value = text;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => (notice.value = ''), NOTICE_MS);
}

/** What is loading, if anything: shown in the place row's spot. */
const searching = computed(() =>
  placeLoading.value ? 'places' : liveLoading.value && !inPlaces.value ? 'species' : null,
);

/** Placeholder rows to show while results load: enough to make three rows with what's in. */
const placeholderRows = computed(() => (searching.value ? Math.max(0, MIN_ROWS - listOptions.value.length) : 0));

const options = computed<Option[]>(() => {
  const rows: Option[] = inPlaces.value
    ? places.value.map((place, index) => ({ kind: 'place', id: `omni-place-${index}`, place }))
    : taxa.value.map((hit) => ({ kind: 'taxon', id: `omni-taxon-${hit.key}`, hit }));
  if (query.value.trim().length >= MIN_SWITCH_QUERY) {
    rows.push(
      inPlaces.value
        ? { kind: 'species-search', id: 'omni-species-search' }
        : { kind: 'place-search', id: 'omni-place-search' },
    );
  }
  return rows;
});

const isSwitchOption = (option: Option) => option.kind === 'place-search' || option.kind === 'species-search';

/** The switch to places (or back to species) is always last, so the scrolling rows keep their indexes into `options`. */
const listOptions = computed(() => options.value.filter((option) => !isSwitchOption(option)));

/** Whether the scrolling list has anything in it; an empty one would leave stray padding above the place row. */
const hasRows = computed(() => listOptions.value.length > 0 || placeholderRows.value > 0);

const switchOption = computed(() => options.value.find(isSwitchOption));

const activeId = computed(() => options.value[active.value]?.id);

// Arrowing past the list's edge would otherwise highlight a row nobody can see; hovered and tapped rows are already in view, so "nearest" leaves them be.
watch(activeId, (id) => {
  if (id) void nextTick(() => document.getElementById(id)?.scrollIntoView({ block: 'nearest' }));
});

/** The result to preview: the highlighted species/group (the first, if the highlight's row has gone). */
const previewHit = computed<NameHit | null>(() => {
  if (inPlaces.value) return null;
  const option = options.value[active.value] ?? options.value[0];
  return option?.kind === 'taxon' ? option.hit : null;
});

const manifest = useStore($speciesManifest);
/**
 * Every rank has an About page (pre-rendered, or /species/view); that page
 * falls back to the tree if it cannot load the taxon.
 */
const aboutHref = (hit: NameHit) => speciesPath(hit.key, manifest.value);

/** What Enter does right now, for the hint bar. */
const enterLabel = computed(() => {
  const option = options.value[active.value];
  if (option?.kind === 'taxon') return selectLabel() ?? 'About';
  if (option?.kind === 'place') return 'Go to place';
  if (option?.kind === 'species-search') return 'Search species';
  return 'Search places';
});
/** Whether the highlighted row is the switch itself, whose shortcut would then repeat Enter. */
const isSwitchHighlighted = computed(() => {
  const option = options.value[active.value];
  return !option || isSwitchOption(option);
});

/** Empty the box and put the list away once a result is picked. */
function finishPick() {
  query.value = '';
  inPlaces.value = false;
  resetPlaces();
  resetSearch();
  close();
  input.value?.blur();
}

/** Opens a result's About page. */
function openAbout(hit: NameHit) {
  const href = aboutHref(hit);
  finishPick();
  void navigate(href);
}

/** Typing searches species, or places once switched to them. */
function onInput() {
  open.value = true;
  active.value = 0;
  if (inPlaces.value) searchPlaces(query.value);
  else search(query.value);
}

/** Warms the data a search needs, and reopens the list over what's typed. */
function onFocus() {
  void loadNameIndex(); // warm the index on first focus
  void loadSpeciesManifest(); // so About links go to pre-rendered pages
  if (query.value) open.value = true;
}

/** Puts the list away, keeping what's typed. */
function close() {
  open.value = false;
  active.value = 0;
}

/** Switch to places for what's typed, searching now rather than after the debounce. */
function showPlaces() {
  if (!query.value.trim()) return;
  inPlaces.value = true;
  open.value = true;
  active.value = 0;
  searchPlaces(query.value);
  flushPlaces();
}

/** Switch back to species and groups for what's typed. */
function showSpecies() {
  inPlaces.value = false;
  resetPlaces();
  open.value = true;
  active.value = 0;
  search(query.value);
}

/** Picking a result in place, per page; none where a pick opens its About page. */
const SELECT_ACTIONS: Partial<Record<SearchMode, { label: string; caption: string; icon: 'filter' | 'tree' }>> = {
  map: { label: 'Filter on map', caption: 'Filter', icon: 'filter' },
  tree: { label: 'Show in tree', caption: 'Tree', icon: 'tree' },
};

/** Label for picking a result in place; undefined where a pick opens its About page. */
function selectLabel(): string | undefined {
  return SELECT_ACTIONS[props.mode]?.label;
}

/** Applies a species or group pick as the page's mode says (see SearchMode). */
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
  markDone('search');
  // Near me keeps the map on its pin.
  if ($fitOnSearch.get() && !$nearMode.get()) void flyToTaxon(hit.key);
}

/** Closest the map zooms in on a picked taxon, so a species known from one spot still shows its surroundings. */
const TAXON_MAX_ZOOM = 6;

/** Zoom out to all of a taxon's records under the other filters, centred on the place with the most. */
async function flyToTaxon(taxonKey: number) {
  try {
    const view = await recordsView({ ...$occurrenceFilter.get(), taxonKeys: [taxonKey] });
    if (!view) return;
    $flyTo.set({
      kind: 'bounds',
      bbox: boundsAround(view.busiest, view.extent),
      centre: view.busiest,
      maxZoom: TAXON_MAX_ZOOM,
    });
  } catch {
    /* stay where we are */
  }
}

/** Shows a place on the map, going to the map first from other pages. */
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

/** Acts on a row: pick a result, or switch between species and places. */
function choose(option: Option | undefined) {
  if (!option) return;
  if (option.kind === 'taxon') void pickTaxon(option.hit);
  else if (option.kind === 'place') pickPlace(option.place);
  else if (option.kind === 'place-search') showPlaces();
  else showSpecies();
}

/** Set on pointerdown: Safari's click events don't say whether a finger or a mouse made them. */
let lastPointerType = '';

/** Phones have no hover, so a tap on another species row previews it first; tapping it again (or the preview's buttons) picks it. */
function onRowClick(option: Option, index: number) {
  if (lastPointerType === 'touch' && option.kind === 'taxon' && index !== active.value) active.value = index;
  else choose(option);
}

/** Enter picks the highlighted row; with Cmd/Ctrl it opens the About page, and with Shift too it switches search. */
async function onEnter(event: KeyboardEvent) {
  event.preventDefault();
  const isModified = event.metaKey || event.ctrlKey;
  if (isModified && event.shiftKey) {
    if (inPlaces.value) showSpecies();
    else showPlaces();
    return;
  }
  const typed = query.value;
  // The list may still hold the previous text's results, so answer what's typed before picking.
  if (!inPlaces.value) await settle();
  if (query.value !== typed) return;
  const option = options.value[active.value];
  if (isModified && previewHit.value) openAbout(previewHit.value);
  else if (option) choose(option);
  // Nothing to pick yet (still loading, or no matches): look for a place now.
  else if (inPlaces.value) flushPlaces();
  else showPlaces();
}

/** Moves the highlight by `delta` rows, wrapping at either end. */
function stepActive(delta: number) {
  const count = options.value.length;
  active.value = count ? (active.value + delta + count) % count : 0;
}

/** Combobox keys: arrows move, Enter picks, Escape closes the list and then clears the box. */
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    open.value = true;
    stepActive(1);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    stepActive(-1);
  } else if (event.key === 'Enter') {
    void onEnter(event);
  } else if (event.key === 'Escape') {
    if (open.value) close();
    else query.value = '';
  }
}

/** Closes the list when focus leaves the search and its dropdown. */
function onBlur(event: FocusEvent) {
  const next = event.relatedTarget as Node | null;
  if (!next || !(event.currentTarget as HTMLElement).parentElement?.contains(next)) close();
}

/** Keep the dropdown inside the visible area: on-screen keyboards shrink the
   visual viewport (not the layout one) on iOS and Android, hiding its foot. */
const dropdown = ref<HTMLDivElement>();
const fitHeight = ref<number | null>(null);
const isShown = computed(
  () =>
    open.value &&
    (options.value.length > 0 || !!searching.value || (inPlaces.value && (placeFailed.value || placesAnswered.value))),
);
/** Sizes the dropdown to end above an on-screen keyboard. */
function fit() {
  // Hidden (v-show) it measures at top 0, which would size it past the keyboard.
  if (!isShown.value || !dropdown.value) return;
  const viewport = window.visualViewport;
  const bottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
  fitHeight.value = Math.max(
    MIN_DROPDOWN_HEIGHT,
    Math.floor(bottom - dropdown.value.getBoundingClientRect().top - DROPDOWN_MARGIN),
  );
}
// On first use results arrive after `open`, so fit when it actually shows.
watch(isShown, (shown) => (shown ? void nextTick(fit) : undefined));

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
  <div class="omnibox relative w-full max-w-xl" data-tour="search" @focusout="onBlur">
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
        <SearchInput
          id="omnibox-input"
          ref="searchBox"
          v-model="query"
          icon="none"
          bare
          role="combobox"
          autocomplete="off"
          spellcheck="false"
          class="h-[calc(var(--header-height)-2px)] text-ellipsis text-text focus:outline-none"
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
      v-show="isShown"
      ref="dropdown"
      class="dropdown absolute left-0 right-0 top-full z-40 mt-1 flex flex-col overflow-hidden rounded-md border border-border bg-surface shadow-panel"
      :class="{ 'with-preview': previewHit }"
      :style="fitHeight ? { maxHeight: `${fitHeight}px` } : undefined"
    >
      <!-- Only the list shrinks when space is short, so the preview stays in view. -->
      <div :class="{ 'with-preview': previewHit }" class="results flex min-h-0 flex-col">
        <!-- The switch to places (or species) sits below the scrolling rows, so it never moves as they scroll. -->
        <div
          id="omnibox-listbox"
          role="listbox"
          :aria-label="inPlaces ? 'Places' : 'Species and places'"
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
              @pointerdown="lastPointerType = $event.pointerType"
              @click="onRowClick(option, index)"
              @pointermove="$event.pointerType === 'mouse' && (active = index)"
            >
              <OmniboxResult :option="option" />
            </li>
            <!-- Placeholder rows where results will land, so nothing jumps when they arrive. -->
            <OmniboxPlaceholderRow v-for="row in placeholderRows" :key="`skel-${row}`" :row="row" />
          </ul>
          <div
            v-if="switchOption"
            :id="switchOption.id"
            role="option"
            :aria-selected="active === options.length - 1"
            :class="{ 'border-t': hasRows }"
            class="mt-auto flex shrink-0 cursor-pointer items-center gap-3 border-border px-3 py-2.5 text-sm aria-selected:bg-accent-soft"
            @mousedown.prevent
            @click="choose(switchOption)"
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
              <template v-if="switchOption.kind === 'place-search'">
                <path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11Z" />
                <circle cx="12" cy="10" r="2.5" />
              </template>
              <template v-else>
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </template>
            </svg>
            <span class="text-muted"
              >Search {{ switchOption.kind === 'place-search' ? 'places' : 'species' }} for “{{ query.trim() }}”</span
            >
          </div>
          <span v-if="searching" role="none" class="sr-only">Searching {{ searching }}…</span>
        </div>
        <TaxonPreview
          v-if="previewHit"
          :hit="previewHit"
          :href="aboutHref(previewHit)"
          :about-label="'About'"
          :select="SELECT_ACTIONS[mode]"
          @select="pickTaxon(previewHit)"
          @about="close"
        />
      </div>
      <p
        v-if="inPlaces && placesAnswered && !places.length && !placeFailed && !placeLoading"
        class="px-3 py-2 text-sm text-muted"
      >
        No places found.
      </p>
      <p v-if="inPlaces && placeFailed" class="px-3 py-2 text-sm text-muted">Place search is unavailable right now.</p>
      <p v-if="liveFailed && !inPlaces" class="border-t border-border px-3 py-1.5 text-xs text-subtle">
        Live species search is busy; showing saved names only.
      </p>
      <OmniboxHintBar
        v-if="options.length"
        :enter-label="enterLabel"
        :can-open-about="!!previewHit && !!selectLabel()"
        :switch-label="isSwitchHighlighted ? undefined : inPlaces ? 'Species' : 'Places'"
      />
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
</style>
