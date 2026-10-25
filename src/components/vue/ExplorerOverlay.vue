<script setup lang="ts">
/**
 * Map-page controls (client:only): taxon chip, filter rail, basemap
 * switcher, legend, and the side panel / bottom sheet.
 * On small screens the filters move into the sheet behind a Filters button.
 * "Near me" (`?near=1`) swaps these controls for the NearExplorer panel.
 */
import { useStore } from '@nanostores/vue';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  $mapUnsupported,
  $panel,
  $railOpen,
  $selectedHex,
  $viewCheck,
  clearFilters,
  clearHexSelection,
} from '~/stores/explorer';
import { $nearMode, exitNearMode } from '~/stores/near';
import { $checklistHint, $tourSeen } from '~/stores/onboarding';
import BasemapSwitcher from './BasemapSwitcher.vue';
import ChecklistHint from './ChecklistHint.vue';
import FilterGroup from './FilterGroup.vue';
import {
  $activeFilterCount,
  $groupCounts,
  FILTER_GROUPS,
  PHONE_QUERY,
  SETTINGS,
  type FilterGroupId,
} from './filterGroups';
import FilterRail from './FilterRail.vue';
import HexPanel from './HexPanel.vue';
import LegalLinks from './LegalLinks.vue';
import MapLegend from './MapLegend.vue';
import MapProgress from './MapProgress.vue';
import MapSettings from './MapSettings.vue';
import NearExplorer from './NearExplorer.vue';
import OnboardingTour from './OnboardingTour.vue';
import ResponsivePanel from './ResponsivePanel.vue';
import OnboardingSettings from './OnboardingSettings.vue';
import ReadingSettings from './ReadingSettings.vue';
import SearchFitSetting from './SearchFitSetting.vue';
import TaxonChip from './TaxonChip.vue';
import ThemePicker from './ThemePicker.vue';
import TryThis from './TryThis.vue';

const panel = useStore($panel);
const tourSeen = useStore($tourSeen);
const hintId = useStore($checklistHint);
const hex = useStore($selectedHex);
const activeFilters = useStore($activeFilterCount);
const groupCounts = useStore($groupCounts);
/* Phone Filters sheet: one tab per group (as the desktop rail), plus map settings. */
const filterTab = ref<FilterGroupId | 'settings'>('what');
const near = useStore($nearMode);
const mapUnsupported = useStore($mapUnsupported);

/* Slide the dock off to the left to see the map behind it. */
const dockStashed = ref(false);

/* The rail's flyout stops above the dock, whose height follows its content (the legend's notice, Try this). */
const dock = ref<HTMLElement>();
const dockHeight = ref(0);
const dockClear = computed(() => (dockStashed.value ? '0px' : `calc(${dockHeight.value}px + 0.5rem)`));
let dockObserver: ResizeObserver | undefined;
// An empty map's notice lives in the legend: bring it back if it was slid away.
const viewCheck = useStore($viewCheck);
watch(
  () => viewCheck.value.isEmpty,
  (isEmpty) => {
    if (isEmpty) dockStashed.value = false;
  },
);
function toggleNear() {
  if (near.value) {
    exitNearMode();
    return;
  }
  // Pin mode replaces hex selection; one history step.
  clearHexSelection();
  $panel.set('none');
  $nearMode.set(true);
}

const pinIcon = 'M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z';

const hexOpen = computed(() => !near.value && panel.value === 'hex' && hex.value !== null);
const filtersOpen = computed(() => panel.value === 'filters');
const panelOpen = computed(() => hexOpen.value || filtersOpen.value);
const panelTitle = computed(() => (filtersOpen.value ? 'Filters' : 'Selected cell'));

function openFilters() {
  $panel.set(filtersOpen.value ? (hex.value ? 'hex' : 'none') : 'filters');
}

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
onMounted(() => {
  phoneQuery = window.matchMedia(PHONE_QUERY);
  phoneQuery.addEventListener('change', swapFilterLayout);
  dockObserver = new ResizeObserver(() => (dockHeight.value = dock.value?.offsetHeight ?? 0));
  if (dock.value) dockObserver.observe(dock.value);
});
onBeforeUnmount(() => {
  phoneQuery?.removeEventListener('change', swapFilterLayout);
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
      class="top-bar pointer-events-none absolute left-3 right-3 top-3 flex items-start justify-between gap-2 *:pointer-events-auto max-sm:gap-0"
    >
      <!-- flex-auto: the chips shrink only once the row is full; spare room still splits around the progress pill. -->
      <div class="min-w-0 sm:flex-auto" :class="{ 'max-sm:mr-2': near }"><TaxonChip /></div>
      <!-- In the row's free space so it never sits under the pills; below the row on phones, where the taxon chip can fill it. -->
      <MapProgress
        v-if="!near"
        class="absolute left-1/2 top-9 -translate-x-1/2 sm:static sm:shrink-0 sm:translate-x-0"
      />
      <div
        v-if="!near"
        class="ml-auto hidden shrink-0 items-start justify-end gap-2 whitespace-nowrap sm:flex sm:flex-1"
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
        <BasemapSwitcher />
      </div>
      <!-- Phone: Near me + Filters button (the rail is hidden). -->
      <button v-if="!near" type="button" class="near-btn near-phone ml-auto" data-tour="near" @click="toggleNear">
        <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
          <path :d="pinIcon" />
        </svg>
        <span class="sr-only">Near me</span>
      </button>
      <button
        type="button"
        class="filters-btn"
        data-tour="filters"
        :aria-expanded="filtersOpen"
        :class="{ active: activeFilters, 'ml-auto': near }"
        @click="openFilters"
      >
        <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d="M4 6h16M7 12h10M10 18h4" />
        </svg>
        Filters<span v-if="activeFilters" class="tabular-nums"> ({{ activeFilters }})</span>
      </button>
    </div>

    <!-- Stays in Near me too, on wider screens; phones hide it under Near me's sheet (see the styles). -->
    <div
      ref="dock"
      class="bottom-dock pointer-events-auto absolute bottom-3 left-3 rounded-lg p-3"
      :class="{ stashed: dockStashed }"
    >
      <!-- Same edge tab as SidePanel's: tucked under the dock so its shadow falls across the join. -->
      <button
        v-if="!near"
        type="button"
        class="stash-toggle absolute -z-10 left-full [clip-path:inset(-30px_-30px_-30px_0)] top-1/2 grid h-10 w-6 -translate-y-1/2 place-items-center rounded-r-md border border-l-0 border-border bg-surface text-muted shadow-panel hover:text-text"
        :aria-label="dockStashed ? 'Show legend' : 'Slide legend away'"
        :aria-expanded="!dockStashed"
        @click="dockStashed = !dockStashed"
      >
        <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path :d="dockStashed ? 'm9 6 6 6-6 6' : 'm15 6-6 6 6 6'" />
        </svg>
      </button>
      <TryThis />
      <MapLegend class="w-full max-w-60" data-tour="legend" />
    </div>

    <div
      class="rail-region pointer-events-none absolute bottom-3 left-3 top-14 hidden *:pointer-events-auto sm:block"
      :style="{ '--dock-clear': dockClear }"
    >
      <FilterRail />
    </div>

    <div class="pointer-events-auto">
      <ResponsivePanel :title="panelTitle" :open="panelOpen" @close="closePanel">
        <template v-if="filtersOpen" #top>
          <div role="tablist" aria-label="Filter groups" class="flex border-b border-border">
            <button
              v-for="tab in [...FILTER_GROUPS, { ...SETTINGS, label: 'Map' }]"
              :key="tab.id"
              role="tab"
              type="button"
              :aria-selected="filterTab === tab.id"
              class="-mb-px flex flex-1 flex-col items-center gap-0.5 border-b-2 px-1 py-1.5 text-xs"
              :class="
                filterTab === tab.id ? 'border-accent text-text' : 'border-transparent text-muted hover:text-text'
              "
              @click="filterTab = tab.id"
            >
              <svg
                viewBox="0 0 24 24"
                class="size-5"
                fill="none"
                stroke="currentColor"
                stroke-width="1.7"
                aria-hidden="true"
              >
                <path :d="tab.icon" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
              <span>
                {{ tab.label
                }}<span v-if="tab.id !== 'settings' && groupCounts[tab.id]" class="tabular-nums">
                  ({{ groupCounts[tab.id] }})</span
                >
              </span>
            </button>
          </div>
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
          <div v-if="filterTab === 'settings'" role="tabpanel" class="space-y-6">
            <div>
              <p class="mb-2 text-sm font-medium">Basemap</p>
              <BasemapSwitcher class="w-fit" />
            </div>
            <div>
              <p class="mb-2 text-sm font-medium">Theme</p>
              <ThemePicker />
            </div>
            <MapSettings />
            <section aria-labelledby="reading-settings-sheet-title">
              <h3 id="reading-settings-sheet-title" class="mb-2 font-sans text-sm font-medium">Reading and display</h3>
              <ReadingSettings in-settings />
            </section>
            <SearchFitSetting />
            <OnboardingSettings />
            <LegalLinks />
          </div>
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
/* The dock's surface sits on its own layer, above the stash tab (z -10) but below the legend. */
.bottom-dock::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  border: 1px solid var(--border);
  border-radius: inherit;
  background: color-mix(in srgb, var(--surface) 95%, transparent);
  box-shadow: var(--shadow);
  backdrop-filter: blur(8px);
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

/* Phone-only controls (scoped display would otherwise beat a sm:hidden utility). */
@media (min-width: 640px) {
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

/* Keep the dock and flyout clear of the desktop side panel. */
@media (min-width: 768px) {
  .panel-open .top-bar {
    right: calc(var(--panel-width) + 1.5rem);
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
  }
}

/* Mobile: the dock hides behind the bottom sheet while it is open (Near me's sheet always is). */
@media (max-width: 767.98px) {
  .panel-open .bottom-dock,
  .near .bottom-dock {
    visibility: hidden;
  }
}
</style>
