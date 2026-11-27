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
import { useLatestLoad } from '~/composables/useLatestLoad';
import { NO_RAIL_QUERY, SHEET_QUERY } from '~/lib/breakpoints';
import { $activeFilterCount, type FilterGroupId } from '~/lib/filter-groups';
import { full } from '~/lib/format';
import { occurrenceCount } from '~/lib/gbif';
import { MODE_OPTIONS } from '~/lib/map-modes';
import { clearHexSelection, $panel, $selectedHex } from '~/stores/explorer';
import { $occurrenceFilter, clearFilters } from '~/stores/filters';
import { $mapUnsupported, $railOpen, $viewCheck } from '~/stores/map-messages';
import { $analysePanelOpen, $mode, ANALYSE_FILTER_GROUPS, setMapMode } from '~/stores/mode';
import { $nearMode, $nearPanelOpen, $nearTotal } from '~/stores/near';
import { $checklistHint, $tourSeen } from '~/stores/onboarding';

const panel = useStore($panel);
const tourSeen = useStore($tourSeen);
const hintId = useStore($checklistHint);
const hex = useStore($selectedHex);
const activeFilters = useStore($activeFilterCount);
/** Phone Filters sheet: one tab per group (as the desktop rail), plus map settings. */
const filterTab = ref<FilterGroupId | 'settings'>('what');
const near = useStore($nearMode);
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

const mode = useStore($mode);
const isExplore = computed(() => mode.value === 'explore');
const isAnalyse = computed(() => mode.value === 'analyse');
/** The desktop switch's two-way binding onto the mode store. */
const modeModel = computed({ get: () => mode.value, set: setMapMode });

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

/** The phone Explore button: lists everything the filters match (dropping the selected cell), or hides that list. */
function toggleAllResults() {
  if (allResultsOpen.value) {
    $panel.set('none');
    return;
  }
  clearHexSelection();
  $panel.set('results');
}

const hasSheets = ref(false);

const nearPanelOpen = useStore($nearPanelOpen);
const nearTotal = useStore($nearTotal);
const analysePanelOpen = useStore($analysePanelOpen);
const filter = useStore($occurrenceFilter);
const currentMode = computed(() => MODE_OPTIONS.find((option) => option.value === mode.value)!);

/** Records matching the filters, for the phone's Explore button; fetched only while that button shows. */
const exploreTotal = ref<number | null>(null);
const { run: runExploreTotal, cancel: cancelExploreTotal } = useLatestLoad();
watch(
  [filter, isExplore, hasSheets],
  ([currentFilter, isExploring, isSheetLayout]) => {
    exploreTotal.value = null;
    if (!isExploring || !isSheetLayout) return cancelExploreTotal();
    void runExploreTotal(async (signal) => {
      const total = await occurrenceCount(currentFilter, signal);
      if (!signal.aborted) exploreTotal.value = total;
    });
  },
  { immediate: true },
);

/** Explore and Near me show their record count on the phone's mode button; Analyse has none yet. */
const modeTotal = computed(() => {
  if (isExplore.value) return exploreTotal.value;
  return near.value ? nearTotal.value : null;
});
const modeListOpen = computed(() => {
  if (isExplore.value) return allResultsOpen.value;
  return near.value ? nearPanelOpen.value : analysePanelOpen.value;
});

/** The phone's mode button: Explore toggles all results; Near me and Analyse bring their panel back. */
function openModeList() {
  if (isExplore.value) return toggleAllResults();
  if (near.value) return $nearPanelOpen.set(true);
  $analysePanelOpen.set(true);
}
/** An open sheet slides the dock away; closing it brings the dock back as the viewer left it. */
const sheetCoversDock = ref(false);
watch(
  () =>
    hasSheets.value &&
    (panelOpen.value || (isAnalyse.value && analysePanelOpen.value) || (near.value && nearPanelOpen.value)),
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
  if (filtersOpen.value) return closeFilters();
  // Analyse offers only some groups; open on one it has.
  const isTabOffered =
    filterTab.value === 'settings' || !isAnalyse.value || ANALYSE_FILTER_GROUPS.includes(filterTab.value);
  if (!isTabOffered) filterTab.value = 'where';
  $panel.set('filters');
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
      <div v-if="!isAnalyse" class="chip-area hidden min-w-0 rail:block rail:flex-auto"><TaxonChip /></div>
      <!-- Below the row, centred on the page, so the chips can fill the row. -->
      <MapProgress v-if="!near" class="bar-status absolute left-1/2 top-9 -translate-x-1/2 rail:top-11" />
      <div
        class="bar-end ml-auto hidden shrink-0 items-start justify-end gap-2 whitespace-nowrap rail:flex rail:flex-1"
      >
        <SegmentedControl
          v-model="modeModel"
          legend="Map mode"
          :options="MODE_OPTIONS"
          class="mode-switch"
          data-tour="near"
        />
      </div>
      <!-- Phone: the mode menu (the rail is hidden); Filters sits in the bottom row. -->
      <div class="bar-end phone-row ml-auto flex shrink-0 rail:hidden">
        <ModeMenu class="phone-btn" />
      </div>
      <!-- From tablet width up, in every mode, so changing mode never redraws it. -->
      <div class="bar-end hidden shrink-0 max-rail:ml-2 sm:block"><BasemapSwitcher /></div>
    </div>

    <!-- Phones and tablets: the mode's own list and Filters along the bottom, within a thumb's reach. The first button
         opens Explore's results, Near me's list or Analyse's panel, with a record count where the mode has one; from
         tablet width the side panel's own tab does that, so the row keeps just Filters. -->
    <div class="phone-bottom-row pointer-events-auto absolute bottom-3 left-3 right-3 flex gap-2 rail:hidden">
      <button type="button" class="bottom-btn list-btn explore-btn" :aria-expanded="modeListOpen" @click="openModeList">
        <svg
          viewBox="0 0 24 24"
          class="size-[1.125rem]"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path :d="currentMode.icon" />
        </svg>
        {{ currentMode.label }}
        <span class="ml-auto flex items-center gap-1.5 text-subtle">
          <span v-if="modeTotal !== null" class="text-[0.8125rem] tabular-nums"
            >{{ full(modeTotal) }}<span class="sr-only"> records</span></span
          >
          <svg
            viewBox="0 0 24 24"
            class="size-4"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="m6 15 6-6 6 6" />
          </svg>
        </span>
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
        tab-label="Explore"
        @close="hideResults"
        @open="showResults"
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
/* Floats over the map like the other pills, as tall as the basemap switch beside it (2rem); the selected mode takes
   the accent fill (SegmentedControl). */
.mode-switch {
  height: 2rem;
  box-shadow: var(--shadow);
  font-size: 0.8125rem;
}
.mode-switch :deep(label) {
  display: flex;
  align-items: center;
  padding-block: 0;
}
.phone-btn {
  flex-shrink: 0;
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

/* A 360px phone's top row is tight, so its pieces sit closer there. */
@media (max-width: 399.98px) {
  .top-bar {
    gap: 0.25rem;
  }
}

/* Phones and tablets: the mode's list button and Filters, 44px tall for thumbs, squared like the design's buttons. */
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

/* Desktop: the switches sit left of an open side panel and slide with it when it's tucked aside, the same distance
   and timing as SidePanel's .collapsed, so they move as one. The chips stay at the left and stop short of the panel;
   the status note stays centred on the map beside it. A panel that appears or goes (a mode change) moves nothing. */
@media (min-width: 768px) {
  .bar-end {
    transition: transform var(--dur-slow) var(--ease);
  }
  .bar-status {
    transition: margin-left var(--dur-slow) var(--ease);
  }
  .explorer-overlay:has(.side-panel:not(.collapsed)) .bar-end {
    transform: translateX(calc(-1 * (var(--panel-width) + 0.75rem)));
  }
  .explorer-overlay:has(.side-panel:not(.collapsed)) .chip-area {
    margin-right: calc(var(--panel-width) + 0.75rem);
  }
  .explorer-overlay:has(.side-panel:not(.collapsed)) .bar-status {
    margin-left: calc(-1 * (var(--panel-width) + 0.75rem) / 2);
    /* Keeps a long note from running under the panel or rail. */
    --map-status-max-width: calc(100vw - var(--panel-width) - 8rem);
  }
  .panel-open .rail-region {
    --flyout-max: calc(100vw - var(--panel-width) - 7.5rem);
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
