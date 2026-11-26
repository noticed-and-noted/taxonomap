<script setup lang="ts">
/**
 * Map-page controls (client:only): taxon chip, filter rail, basemap
 * switcher, legend, and the results and filters panels (side panel / bottom sheet).
 * On small screens the filters move into the sheet behind a Filters button, and
 * the chips give way to a count and a clear button on it.
 * The mode switch picks Explore (these controls), Near me (`?near=1`, the NearExplorer panel)
 * or Analyse (`?analyse=1`, the AnalysePanel).
 */
import { useStore } from '@nanostores/vue';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import SegmentedControl from '~/components/atoms/SegmentedControl.vue';
import UiIcon from '~/components/atoms/UiIcon.vue';
import BasemapSwitcher from '~/components/organisms/settings/BasemapSwitcher.vue';
import ResponsivePanel from '~/components/molecules/ResponsivePanel.vue';
import AnalysePanel from '~/components/organisms/analyse/AnalysePanel.vue';
import HexPanel from '~/components/organisms/cell/HexPanel.vue';
import FilterGroup from '~/components/organisms/filters/FilterGroup.vue';
import FilterRail from '~/components/organisms/filters/FilterRail.vue';
import FilterSheetSettings from '~/components/organisms/filters/FilterSheetSettings.vue';
import FilterSheetTabs from '~/components/organisms/filters/FilterSheetTabs.vue';
import TaxonChip from '~/components/organisms/filters/TaxonChip.vue';
import MapLegend from '~/components/organisms/map/MapLegend.vue';
import MapProgress from '~/components/organisms/map/MapProgress.vue';
import NearExplorer from '~/components/organisms/near/NearExplorer.vue';
import ChecklistHint from '~/components/organisms/onboarding/ChecklistHint.vue';
import OnboardingTour from '~/components/organisms/onboarding/OnboardingTour.vue';
import TryThis from '~/components/organisms/onboarding/TryThis.vue';
import ModeMenu from '~/components/organisms/site/ModeMenu.vue';
import { NO_RAIL_QUERY, SHEET_QUERY } from '~/lib/breakpoints';
import { $activeFilterCount, type FilterGroupId } from '~/lib/filter-groups';
import { MODE_OPTIONS } from '~/lib/map-modes';
import { clearHexSelection, $panel, $selectedHex } from '~/stores/explorer';
import { clearFilters } from '~/stores/filters';
import { $mapUnsupported, $railOpen, $viewCheck } from '~/stores/map-messages';
import { $mapMode, setMapMode } from '~/stores/mode';
import { $nearLeaving, $nearMode } from '~/stores/near';
import { $checklistHint, $tourSeen } from '~/stores/onboarding';

const panel = useStore($panel);
const tourSeen = useStore($tourSeen);
const hintId = useStore($checklistHint);
const hex = useStore($selectedHex);
const activeFilters = useStore($activeFilterCount);
/** Phone Filters sheet: one tab per group (as the desktop rail), plus map settings. */
const filterTab = ref<FilterGroupId | 'settings'>('what');
const near = useStore($nearMode);
const nearLeaving = useStore($nearLeaving);
const mapUnsupported = useStore($mapUnsupported);

/** Slide the dock off to the left to see the map behind it. */
const dockStashed = ref(false);

/** The rail's flyout stops above the dock, whose height follows its content (the legend's notice, Try this). */
const dock = ref<HTMLElement>();
const dockHeight = ref(0);
const dockClear = computed(() => (dockHidden.value ? '0px' : `calc(${dockHeight.value}px + 0.5rem)`));
let dockObserver: ResizeObserver | undefined;
// An empty map's notice lives in the legend: bring it back if it was slid away, and slide it away again once records return.
const viewCheck = useStore($viewCheck);
const restashOnRecords = ref(false);
watch(
  () => viewCheck.value.isEmpty,
  (isEmpty) => {
    if (isEmpty) {
      restashOnRecords.value = dockStashed.value;
      dockStashed.value = false;
      return;
    }
    if (restashOnRecords.value) dockStashed.value = true;
    restashOnRecords.value = false;
  },
);

const mode = useStore($mapMode);
const isExplore = computed(() => mode.value === 'explore');
const isAnalyse = computed(() => mode.value === 'analyse');
/** The desktop switch's two-way binding onto the mode store. */
const modeModel = computed({ get: () => mode.value, set: setMapMode });

const listIcon = 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01';

const allResultsOpen = computed(() => panel.value === 'results');
const resultsOpen = computed(
  () => isExplore.value && (allResultsOpen.value || (panel.value === 'hex' && hex.value !== null)),
);
const filtersOpen = computed(() => panel.value === 'filters');
const panelOpen = computed(() => resultsOpen.value || filtersOpen.value);
const resultsTitle = computed(() => (hex.value ? 'Selected cell' : 'All results'));

/** Shows the results panel: the selected cell's, or all results when none is selected. */
function showResults() {
  $panel.set(hex.value ? 'hex' : 'results');
}

/** Tucks the results panel away, keeping the selected cell. */
function hideResults() {
  $panel.set('none');
}

/** The phone List button: lists everything the filters match (dropping the selected cell), or hides that list. */
function toggleAllResults() {
  if (allResultsOpen.value) {
    $panel.set('none');
    return;
  }
  clearHexSelection();
  $panel.set('results');
}

const hasSheets = ref(false);
/** An open sheet slides the dock away; closing it brings the dock back as the viewer left it. */
const sheetCoversDock = ref(false);
watch(
  () => hasSheets.value && (panelOpen.value || isAnalyse.value || (near.value && !nearLeaving.value)),
  (covers) => (sheetCoversDock.value = covers),
);
const dockHidden = computed(() => dockStashed.value || sheetCoversDock.value);

/** Slides the dock away or back, as the viewer asks. */
function toggleDock() {
  dockStashed.value = !dockHidden.value;
  sheetCoversDock.value = false;
  // The viewer chose for themself: don't undo it when records return.
  restashOnRecords.value = false;
}
const onSheetQuery = (event: MediaQueryListEvent) => (hasSheets.value = event.matches);

/** The phone Filters button: opens the sheet, or closes it back to the cell panel if one is selected. */
function openFilters() {
  if (filtersOpen.value) closeFilters();
  else $panel.set('filters');
}

/** Closes the filters, back to the cell panel if one is selected. */
function closeFilters() {
  $panel.set(hex.value ? 'hex' : 'none');
}

/** Crossing the phone width with filters open: move them between the rail's flyout and the sheet, on the same group. */
function swapFilterLayout(event: MediaQueryListEvent) {
  if (event.matches) {
    const group = $railOpen.get();
    if (!group) return;
    $railOpen.set(null);
    filterTab.value = group;
    $panel.set('filters');
  } else if (filtersOpen.value) {
    $railOpen.set(filterTab.value);
    closeFilters();
  }
}

let phoneQuery: MediaQueryList | undefined;
let sheetQuery: MediaQueryList | undefined;
onMounted(() => {
  phoneQuery = window.matchMedia(NO_RAIL_QUERY);
  phoneQuery.addEventListener('change', swapFilterLayout);
  sheetQuery = window.matchMedia(SHEET_QUERY);
  hasSheets.value = sheetQuery.matches;
  sheetQuery.addEventListener('change', onSheetQuery);
  dockObserver = new ResizeObserver(() => (dockHeight.value = dock.value?.offsetHeight ?? 0));
  if (dock.value) dockObserver.observe(dock.value);
});
onBeforeUnmount(() => {
  phoneQuery?.removeEventListener('change', swapFilterLayout);
  sheetQuery?.removeEventListener('change', onSheetQuery);
  dockObserver?.disconnect();
});
</script>

<template>
  <div
    class="explorer-overlay pointer-events-none absolute inset-0 z-10"
    :class="{ 'panel-open': panelOpen && isExplore, near, analyse: isAnalyse }"
  >
    <NearExplorer v-if="near" />
    <AnalysePanel v-if="isAnalyse" />
    <OnboardingTour v-if="!tourSeen && isExplore && !mapUnsupported" />
    <ChecklistHint v-if="hintId && isExplore" :id="hintId" :key="hintId" />
    <div
      class="top-bar pointer-events-none absolute left-3 right-3 top-3 flex items-start justify-between gap-2 *:pointer-events-auto"
    >
      <div v-if="!isAnalyse" class="hidden min-w-0 rail:block rail:flex-auto"><TaxonChip /></div>
      <!-- Below the row, centred on the page, so the chips can fill the row. -->
      <MapProgress v-if="!near" class="absolute left-1/2 top-9 -translate-x-1/2 rail:top-11" />
      <div class="ml-auto hidden shrink-0 items-start justify-end gap-2 whitespace-nowrap rail:flex rail:flex-1">
        <SegmentedControl
          v-model="modeModel"
          legend="Map mode"
          :options="MODE_OPTIONS"
          class="mode-switch"
          data-tour="near"
        />
      </div>
      <!-- Phone: the mode menu (the rail is hidden), and in Near me the Filters pill. In Explore, List and Filters sit in
           the bottom row instead. -->
      <div class="phone-row ml-auto flex shrink-0 rail:hidden">
        <!-- One pill: Filters with its count, and once any are set, a × that clears them all. -->
        <span v-if="near" class="filters-pill" :class="{ active: activeFilters }">
          <button
            type="button"
            class="filters-btn"
            data-tour="filters"
            :aria-expanded="filtersOpen"
            @click="openFilters"
          >
            <svg
              viewBox="0 0 24 24"
              class="size-4"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              aria-hidden="true"
            >
              <path d="M4 6h16M7 12h10M10 18h4" />
            </svg>
            Filters
            <span v-if="activeFilters" class="count-badge tabular-nums"
              >{{ activeFilters }}<span class="sr-only"> active</span></span
            >
          </button>
          <button
            v-if="activeFilters"
            type="button"
            class="filters-clear"
            aria-label="Clear filters"
            @click="clearFilters"
          >
            <UiIcon name="close" size="0.875rem" />
          </button>
        </span>
        <ModeMenu class="phone-btn" />
      </div>
      <!-- From tablet width up; Near me draws its own beside its panel. -->
      <div v-if="!near" class="hidden shrink-0 max-rail:ml-2 sm:block"><BasemapSwitcher /></div>
    </div>

    <!-- Phones and tablets in Explore: List and Filters along the bottom, within a thumb's reach. List opens all results;
         from tablet width the results panel's own List tab does that, so the row keeps just Filters. -->
    <div
      v-if="isExplore"
      class="phone-bottom-row pointer-events-auto absolute bottom-3 left-3 right-3 flex gap-2 rail:hidden"
    >
      <button
        type="button"
        class="bottom-btn list-btn explore-btn"
        :aria-expanded="allResultsOpen"
        @click="toggleAllResults"
      >
        <svg
          viewBox="0 0 24 24"
          class="size-[1.125rem]"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          aria-hidden="true"
        >
          <path :d="listIcon" />
        </svg>
        List
        <svg
          viewBox="0 0 24 24"
          class="ml-auto size-4 text-subtle"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="m6 15 6-6 6 6" />
        </svg>
      </button>
      <button
        type="button"
        class="bottom-btn filters-square"
        data-tour="filters"
        :aria-label="activeFilters ? `Filters, ${activeFilters} active` : 'Filters'"
        :aria-expanded="filtersOpen"
        @click="openFilters"
      >
        <svg viewBox="0 0 24 24" class="size-5" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d="M4 6h16M7 12h10M10 18h4" />
        </svg>
        <span v-if="activeFilters" class="count-badge corner-badge tabular-nums" aria-hidden="true">{{
          activeFilters
        }}</span>
      </button>
    </div>

    <!-- Stays in Near me too, on wider screens; on phones an open sheet slides it away (sheetCoversDock). -->
    <div
      ref="dock"
      class="bottom-dock pointer-events-auto absolute bottom-3 left-3 rounded-lg p-3"
      :class="{ stashed: dockHidden, covered: sheetCoversDock }"
    >
      <!-- Same edge tab as SidePanel's: tucked under the dock so its shadow falls across the join. -->
      <button
        type="button"
        class="stash-toggle absolute -z-10 left-full [clip-path:inset(-30px_-30px_-30px_0)] top-1/2 grid h-10 w-6 -translate-y-1/2 place-items-center rounded-r-md border border-l-0 border-border bg-surface text-muted shadow-panel hover:text-text"
        :aria-label="dockHidden ? 'Show legend' : 'Slide legend away'"
        :aria-expanded="!dockHidden"
        @click="toggleDock"
      >
        <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path :d="dockHidden ? 'm9 6 6 6-6 6' : 'm15 6-6 6 6 6'" />
        </svg>
      </button>
      <TryThis />
      <MapLegend class="w-full max-w-60" data-tour="legend" />
    </div>

    <div
      v-if="!isAnalyse"
      class="rail-region pointer-events-none absolute bottom-3 left-3 top-14 hidden *:pointer-events-auto rail:block"
      :style="{ '--dock-clear': dockClear }"
    >
      <FilterRail />
    </div>

    <div class="pointer-events-auto">
      <!-- Only fills while open, so a tucked panel makes no requests. -->
      <ResponsivePanel
        v-if="isExplore"
        :title="resultsTitle"
        :open="resultsOpen"
        collapsible
        tab-label="List"
        :dismissible="hex ? 'Unselect cell' : undefined"
        @close="hideResults"
        @open="showResults"
        @dismiss="clearHexSelection"
      >
        <HexPanel v-if="resultsOpen" />
      </ResponsivePanel>
      <ResponsivePanel title="Filters" :open="filtersOpen" @close="closeFilters">
        <template v-if="filtersOpen" #top>
          <FilterSheetTabs v-model="filterTab" />
        </template>
        <template v-if="filtersOpen && activeFilters" #actions>
          <!-- pointerdown.stop: the sheet header is a drag handle. -->
          <button
            type="button"
            class="clear-all"
            aria-label="Clear all filters"
            @pointerdown.stop
            @click="clearFilters"
          >
            Clear all
          </button>
        </template>
        <div class="sm:space-y-4 md:pt-0 pt-4">
          <FilterSheetSettings v-if="filterTab === 'settings'" role="tabpanel" />
          <div v-else role="tabpanel">
            <FilterGroup :group="filterTab" />
          </div>
        </div>
      </ResponsivePanel>
    </div>
  </div>
</template>

<style scoped>
/* Floats over the map like the other pills; the selected mode takes the accent fill (SegmentedControl). */
.mode-switch {
  box-shadow: var(--shadow);
  font-size: 0.8125rem;
}
.phone-btn {
  flex-shrink: 0;
}

/* Near me on phones: Filters as a pill, split in two; the × only shows while filters are set. */
.filters-pill {
  display: inline-flex;
  flex-shrink: 0;
  height: 2rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface);
  box-shadow: var(--shadow);
}
.filters-pill.active {
  border-color: var(--accent);
}
.filters-btn,
.filters-clear {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0 0.75rem;
  border-radius: inherit;
  color: var(--text-muted);
  font-size: 0.8125rem;
  white-space: nowrap;
}
.filters-pill.active .filters-btn,
.filters-btn:hover,
.filters-clear:hover {
  color: var(--text);
}
/* Squared at the join, so the divider is a straight line. */
.filters-btn:has(+ .filters-clear) {
  border-radius: 999px 0 0 999px;
}
.filters-clear {
  padding: 0 0.625rem;
  border-left: 1px solid var(--accent);
  border-radius: 0 999px 999px 0;
}
.count-badge {
  display: inline-grid;
  place-items: center;
  min-width: 1.125rem;
  height: 1.125rem;
  padding: 0 0.25rem;
  border-radius: 999px;
  background: var(--accent);
  color: var(--accent-contrast);
  font-size: 0.6875rem;
}

/* The Filters pill and the mode menu share a 360px phone's row, so they sit closer there. */
.phone-row {
  gap: 0.5rem;
}
@media (max-width: 399.98px) {
  .top-bar,
  .phone-row {
    gap: 0.25rem;
  }
  .filters-btn {
    gap: 0.25rem;
    padding: 0 0.4375rem;
  }
}

/* Phones and tablets in Explore: List and Filters, 44px tall for thumbs, squared like the design's buttons. */
.bottom-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  height: 2.75rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text);
  font-size: 0.875rem;
  box-shadow: var(--shadow);
}
.list-btn {
  flex: 1;
  justify-content: flex-start;
  padding: 0 0.875rem;
}
.filters-square {
  position: relative;
  width: 2.75rem;
  flex-shrink: 0;
}
.filters-square[aria-expanded='true'] {
  border-color: var(--accent);
}
.corner-badge {
  position: absolute;
  top: -0.375rem;
  right: -0.375rem;
}

.bottom-dock {
  width: 16.5rem; /* the legend's 15rem (its longest line, "Closest are about 10,000 km north-west.") plus padding */
  isolation: isolate;
  /* Above the rail and its flyout where a short window makes them meet; below the panels (z-20). */
  z-index: 1;
}
/* An open flyout is what you're working in, so it goes above the dock; a tall dock would otherwise hide its last rows. */
.rail-region:has(.flyout) {
  z-index: 2;
}
/* The dock's surface sits on its own layer, above the stash tab (z -10) but below the legend. */
.bottom-dock::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  border: 1px solid var(--border);
  border-radius: inherit;
  background: color-mix(in srgb, var(--surface) 95%, transparent);
  /* No backdrop blur: under a 95% fill it barely shows, yet it is redrawn every map frame. */
  box-shadow: var(--shadow);
}

/* A tab on the dock's right edge slides it off-screen, leaving the tab visible. */
.bottom-dock {
  transition: transform var(--dur-fast) var(--ease);
}
.bottom-dock.stashed {
  transform: translateX(calc(-100% - 0.75rem));
}
/* Under an open sheet the stash tab has nothing to show, and iOS Safari can paint the slid dock's layer over the
   sheet despite its z-index; so once the slide ends, the dock and its tab are hidden outright. */
.bottom-dock.covered {
  visibility: hidden;
  transition:
    transform var(--dur-fast) var(--ease),
    visibility 0s var(--dur-fast);
}
@media (prefers-reduced-motion: reduce) {
  .bottom-dock,
  .bottom-dock.covered {
    transition: none;
  }
}

/* Where the results panel is a side panel, its own Explore tab opens it. */
@media (min-width: 768px) {
  .explore-btn {
    display: none;
  }
}

/* Phone-only controls (scoped display would otherwise beat a rail:hidden utility). */
@media (min-width: 1000px) {
  .filters-pill,
  .phone-btn {
    display: none;
  }
}

/* The legend dock sits above the List and Filters row (0.75rem margin + 2.75rem row + 0.5rem gap). */
@media (max-width: 999.98px) {
  .explorer-overlay:has(.phone-bottom-row) .bottom-dock {
    bottom: 4rem;
  }
}

/* The rail's region spans the map's height; only the rail and flyout take clicks. */
.rail-region {
  /* Rail (3.75rem + borders) plus gaps, so the flyout never reaches the right edge. */
  --flyout-max: calc(100vw - 6.5rem);
}

/* In the panel header, pushed right beside the close button. */
.clear-all {
  margin-left: auto;
  height: 2.75rem;
  padding: 0 0.75rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-muted);
  font-size: 0.8125rem;
  white-space: nowrap;
}
.clear-all:hover {
  color: var(--text);
  border-color: var(--border-strong);
  background: var(--surface-2);
}
@media (min-width: 640px) {
  .clear-all {
    height: 2rem;
  }
}

/* Keep the dock, flyout and map notes clear of the desktop side panel. */
@media (min-width: 768px) {
  .top-bar {
    transition: right var(--dur-slow) var(--ease);
  }
  .panel-open .top-bar,
  .analyse .top-bar {
    right: calc(var(--panel-width) + 1.5rem);
    /* MapProgress centres in this narrowed bar; this keeps a long note from running under the panel or rail. */
    --map-status-max-width: calc(100vw - var(--panel-width) - 8rem);
  }
  .panel-open .rail-region {
    --flyout-max: calc(100vw - var(--panel-width) - 7.5rem);
  }
}

/* Analyse's panel tucked aside: the mode switch goes back to the screen edge. */
@media (min-width: 768px) {
  .analyse:has(.side-panel.collapsed) .top-bar {
    right: 0.75rem;
  }
}

/* Near me: the chips stop short of NearExplorer's basemap switcher (about 7.6rem wide) and side panel. */
@media (min-width: 640px) {
  .near .top-bar {
    padding-right: 8.25rem;
  }
}
@media (min-width: 768px) {
  .near .top-bar {
    right: calc(var(--panel-width) + 1.5rem);
    transition: right var(--dur-slow) var(--ease);
  }
  /* Follows NearExplorer's basemap switcher to the screen edge when the list is tucked away (its .near-bar.tucked). */
  .near:has(.near-bar.tucked) .top-bar {
    right: 0.75rem;
  }
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity var(--dur-slow) var(--ease);
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
