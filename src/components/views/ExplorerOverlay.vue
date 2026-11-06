<script setup lang="ts">
/**
 * Map-page controls (client:only): taxon chip, filter rail, basemap
 * switcher, legend, and the side panel / bottom sheet.
 * On small screens the filters move into the sheet behind a Filters button.
 * "Near me" (`?near=1`) swaps these controls for the NearExplorer panel.
 */
import { useStore } from '@nanostores/vue';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import BasemapSwitcher from '~/components/molecules/BasemapSwitcher.vue';
import ResponsivePanel from '~/components/molecules/ResponsivePanel.vue';
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
import { $activeFilterCount, PHONE_QUERY, type FilterGroupId } from '~/lib/filter-groups';
import {
  $mapUnsupported,
  $panel,
  $railOpen,
  $selectedHex,
  $viewCheck,
  clearFilters,
  clearHexSelection,
} from '~/stores/explorer';
import { $nearLeaving, $nearMode, exitNearMode } from '~/stores/near';
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

/** Enters or leaves Near me; entering drops the selected cell, in the same history step. */
function toggleNear() {
  if (near.value) {
    exitNearMode();
    return;
  }
  clearHexSelection();
  $panel.set('none');
  $nearMode.set(true);
}

const pinIcon = 'M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z';

const hexOpen = computed(() => !near.value && panel.value === 'hex' && hex.value !== null);
const filtersOpen = computed(() => panel.value === 'filters');
const panelOpen = computed(() => hexOpen.value || filtersOpen.value);
const panelTitle = computed(() => (filtersOpen.value ? 'Filters' : 'Selected cell'));

/** Below this width panels are bottom sheets (ResponsivePanel), which cover the dock. */
const SHEET_QUERY = '(max-width: 767.98px)';
const hasSheets = ref(false);
/** An open sheet slides the dock away; closing it brings the dock back as the viewer left it. */
const sheetCoversDock = ref(false);
watch(
  () => hasSheets.value && (panelOpen.value || (near.value && !nearLeaving.value)),
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
  $panel.set(filtersOpen.value ? (hex.value ? 'hex' : 'none') : 'filters');
}

/** Closes the open panel: the filters back to the cell, or the cell's selection. */
function closePanel() {
  if (filtersOpen.value) $panel.set(hex.value ? 'hex' : 'none');
  else clearHexSelection();
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
    closePanel();
  }
}

let phoneQuery: MediaQueryList | undefined;
let sheetQuery: MediaQueryList | undefined;
onMounted(() => {
  phoneQuery = window.matchMedia(PHONE_QUERY);
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
    :class="{ 'panel-open': panelOpen && !near, near }"
  >
    <NearExplorer v-if="near" />
    <OnboardingTour v-if="!tourSeen && !near && !mapUnsupported" />
    <ChecklistHint v-if="hintId && !near" :id="hintId" :key="hintId" />
    <div
      class="top-bar pointer-events-none absolute left-3 right-3 top-3 flex items-start justify-between gap-2 *:pointer-events-auto max-rail:gap-0"
    >
      <div class="min-w-0 rail:flex-auto" :class="{ 'max-rail:mr-2': near }"><TaxonChip /></div>
      <!-- Below the row, centred on the page, so the chips can fill the row. -->
      <MapProgress v-if="!near" class="absolute left-1/2 top-9 -translate-x-1/2 rail:top-11" />
      <div
        v-if="!near"
        class="ml-auto hidden shrink-0 items-start justify-end gap-2 whitespace-nowrap rail:flex rail:flex-1"
      >
        <button type="button" class="near-btn" data-tour="near" @click="toggleNear">
          <svg
            viewBox="0 0 24 24"
            class="size-4"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            aria-hidden="true"
          >
            <path :d="pinIcon" />
          </svg>
          Near me
        </button>
      </div>
      <!-- Phone: Near me + Filters button (the rail is hidden). Grouped at the right, so Filters stays put while
           Near me fades. -->
      <div class="ml-auto flex shrink-0 rail:hidden">
        <Transition name="fade">
          <button
            v-if="!near || nearLeaving"
            type="button"
            class="near-btn near-phone"
            data-tour="near"
            @click="toggleNear"
          >
            <svg
              viewBox="0 0 24 24"
              class="size-4"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              aria-hidden="true"
            >
              <path :d="pinIcon" />
            </svg>
            <span class="sr-only">Near me</span>
          </button>
        </Transition>
        <button
          type="button"
          class="filters-btn"
          data-tour="filters"
          :aria-expanded="filtersOpen"
          :class="{ active: activeFilters }"
          @click="openFilters"
        >
          <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path d="M4 6h16M7 12h10M10 18h4" />
          </svg>
          Filters<span v-if="activeFilters" class="tabular-nums"> ({{ activeFilters }})</span>
        </button>
      </div>
      <!-- From tablet width up; Near me draws its own beside its panel. -->
      <div v-if="!near" class="hidden shrink-0 max-rail:ml-2 sm:block"><BasemapSwitcher /></div>
    </div>

    <!-- Stays in Near me too, on wider screens; on phones an open sheet slides it away (sheetCoversDock). -->
    <div
      ref="dock"
      class="bottom-dock pointer-events-auto absolute bottom-3 left-3 rounded-lg p-3"
      :class="{ stashed: dockHidden }"
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
      <ResponsivePanel :title="panelTitle" :open="panelOpen" @close="closePanel">
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
        <div v-if="filtersOpen" class="sm:space-y-4 md:pt-0 pt-4">
          <FilterSheetSettings v-if="filterTab === 'settings'" role="tabpanel" />
          <div v-else role="tabpanel">
            <FilterGroup :group="filterTab" />
          </div>
        </div>
        <HexPanel v-else />
      </ResponsivePanel>
    </div>
  </div>
</template>

<style scoped>
.filters-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  height: 2rem;
  padding: 0 0.75rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-muted);
  font-size: 0.8125rem;
  box-shadow: var(--shadow);
}

.near-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  height: 2rem;
  padding: 0 0.75rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-muted);
  font-size: 0.8125rem;
  box-shadow: var(--shadow);
  cursor: pointer;
}
.near-btn:hover {
  color: var(--text);
}
.near-phone,
.filters-btn {
  flex-shrink: 0;
}
.near-phone {
  width: 2rem;
  margin-right: 0.5rem; /* the phone row has no gap, so the chips' scroll box can meet this button */
  justify-content: center;
  padding: 0;
}

.filters-btn.active {
  color: var(--text);
  border-color: var(--accent);
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
  transition: transform 200ms ease;
}
.bottom-dock.stashed {
  transform: translateX(calc(-100% - 0.75rem));
}
@media (prefers-reduced-motion: reduce) {
  .bottom-dock {
    transition: none;
  }
}

/* Phone-only controls (scoped display would otherwise beat a rail:hidden utility). */
@media (min-width: 1000px) {
  .filters-btn,
  .near-phone {
    display: none;
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
  .panel-open .top-bar {
    right: calc(var(--panel-width) + 1.5rem);
    /* MapProgress centres in this narrowed bar; this keeps a long note from running under the panel or rail. */
    --map-status-max-width: calc(100vw - var(--panel-width) - 8rem);
  }
  .panel-open .rail-region {
    --flyout-max: calc(100vw - var(--panel-width) - 7.5rem);
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
  /* Follows NearExplorer's basemap switcher when the list is tucked to a strip (its .near-bar.tucked). */
  .near:has(.near-bar.tucked) .top-bar {
    right: 4.75rem;
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
