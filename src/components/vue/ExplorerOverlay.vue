<script setup lang="ts">
/**
 * Map-page controls (client:only): taxon chip, filter rail, basemap
 * switcher, legend, and the side panel / bottom sheet.
 * On small screens the filters move into the sheet behind a Filters button.
 * "Near me" (`?near=1`) swaps these controls for the NearExplorer panel.
 */
import { useStore } from '@nanostores/vue';
import { computed, ref } from 'vue';
import { $panel, $selectedHex, clearFilters, clearHexSelection } from '~/stores/explorer';
import { $nearMode, exitNearMode } from '~/stores/near';
import BasemapSwitcher from './BasemapSwitcher.vue';
import FilterGroup from './FilterGroup.vue';
import { $activeFilterCount, $groupCounts, FILTER_GROUPS, SETTINGS, type FilterGroupId } from './filterGroups';
import FilterRail from './FilterRail.vue';
import HexPanel from './HexPanel.vue';
import MapLegend from './MapLegend.vue';
import MapProgress from './MapProgress.vue';
import MapSettings from './MapSettings.vue';
import NearExplorer from './NearExplorer.vue';
import ResponsivePanel from './ResponsivePanel.vue';
import TaxonChip from './TaxonChip.vue';

const panel = useStore($panel);
const hex = useStore($selectedHex);
const activeFilters = useStore($activeFilterCount);
const groupCounts = useStore($groupCounts);
/* Phone Filters sheet: one tab per group (as the desktop rail), plus map settings. */
const filterTab = ref<FilterGroupId | 'settings'>('what');
const near = useStore($nearMode);

/* Phone only: slide the dock off to the left to see the map behind it. */
const dockStashed = ref(false);
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
</script>

<template>
  <div class="explorer-overlay pointer-events-none absolute inset-0 z-10" :class="{ 'panel-open': panelOpen && !near }">
    <NearExplorer v-if="near" />
    <div
      class="top-bar pointer-events-none absolute left-3 right-3 top-3 flex items-start justify-between gap-2 *:pointer-events-auto"
    >
      <div v-if="!near" class="min-w-0 sm:flex-1"><TaxonChip /></div>
      <!-- In the row's free space so it never sits under the pills; below the row on phones, where the taxon chip can fill it. -->
      <MapProgress
        v-if="!near"
        class="absolute left-1/2 top-9 -translate-x-1/2 sm:static sm:shrink-0 sm:translate-x-0"
      />
      <div v-if="!near" class="ml-auto hidden shrink-0 items-start justify-end gap-2 whitespace-nowrap sm:flex sm:flex-1">
        <button type="button" class="near-btn" @click="toggleNear">
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
      <button v-if="!near" type="button" class="near-btn near-phone ml-auto" @click="toggleNear">
        <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
          <path :d="pinIcon" />
        </svg>
        <span class="sr-only">Near me</span>
      </button>
      <button
        type="button"
        class="filters-btn"
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

    <div
      v-if="!near"
      class="bottom-dock pointer-events-auto absolute bottom-3 left-3 rounded-lg border border-border bg-surface/95 p-3 shadow-panel backdrop-blur"
      :class="{ stashed: dockStashed }"
    >
      <button
        type="button"
        class="stash-toggle"
        :aria-label="dockStashed ? 'Show legend' : 'Slide legend away'"
        :aria-expanded="!dockStashed"
        @click="dockStashed = !dockStashed"
      >
        <svg viewBox="0 0 12 12" class="size-3" aria-hidden="true">
          <path
            :d="dockStashed ? 'M4.5 3l3 3-3 3' : 'M7.5 3l-3 3 3 3'"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
          />
        </svg>
      </button>
      <MapLegend class="w-full max-w-56" />
    </div>

    <div class="rail-region pointer-events-none absolute bottom-3 left-3 top-14 hidden *:pointer-events-auto sm:block">
      <FilterRail />
    </div>

    <div class="pointer-events-auto">
      <ResponsivePanel :title="panelTitle" :open="panelOpen" @close="closePanel">
        <template v-if="filtersOpen" #top>
          <div role="tablist" aria-label="Filter groups" class="flex border-b border-border">
            <button
              v-for="t in [...FILTER_GROUPS, { ...SETTINGS, label: 'Map' }]"
              :key="t.id"
              role="tab"
              type="button"
              :aria-selected="filterTab === t.id"
              class="-mb-px flex flex-1 flex-col items-center gap-0.5 border-b-2 px-1 py-1.5 text-xs"
              :class="filterTab === t.id ? 'border-accent text-text' : 'border-transparent text-muted hover:text-text'"
              @click="filterTab = t.id"
            >
              <svg
                viewBox="0 0 24 24"
                class="size-5"
                fill="none"
                stroke="currentColor"
                stroke-width="1.7"
                aria-hidden="true"
              >
                <path :d="t.icon" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
              <span>
                {{ t.label
                }}<span v-if="t.id !== 'settings' && groupCounts[t.id]" class="tabular-nums">
                  ({{ groupCounts[t.id] }})</span
                >
              </span>
            </button>
          </div>
        </template>
        <div v-if="filtersOpen" class="space-y-4 pt-4">
          <div v-if="filterTab === 'settings'" role="tabpanel" class="space-y-6">
            <div>
              <p class="mb-2 text-sm font-medium">Basemap</p>
              <BasemapSwitcher />
            </div>
            <MapSettings inline />
          </div>
          <div v-else role="tabpanel">
            <FilterGroup :group="filterTab" />
          </div>
          <button v-if="activeFilters" type="button" class="clear-all" @click="clearFilters">Clear all filters</button>
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
.near-phone {
  width: 2rem;
  justify-content: center;
  padding: 0;
}

.filters-btn.active {
  color: var(--text);
  border-color: var(--accent);
}

.bottom-dock {
  width: 15.5rem; /* the legend's 14rem plus padding */
}

/* Phone: a tab on the dock's right edge slides it off-screen, leaving the tab visible. */
.bottom-dock {
  transition: transform 200ms ease;
}
.bottom-dock.stashed {
  transform: translateX(calc(-100% - 0.75rem));
}
.stash-toggle {
  position: absolute;
  left: 100%;
  top: 50%;
  translate: 0 -50%;
  display: grid;
  place-items: center;
  width: 1.5rem;
  height: 2.5rem;
  border: 1px solid var(--border);
  border-left: 0;
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  background: inherit; /* match the dock so the tab reads as part of it */
  color: var(--text-muted);
}
@media (prefers-reduced-motion: reduce) {
  .bottom-dock {
    transition: none;
  }
}

/* Phone-only control (scoped display would otherwise beat a sm:hidden utility). */
@media (min-width: 640px) {
  .stash-toggle {
    display: none;
  }
  .bottom-dock.stashed {
    transform: none;
  }
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

.clear-all {
  height: 2rem;
  padding: 0 0.75rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  color: var(--text-muted);
  font-size: 0.8125rem;
}
.clear-all:hover {
  color: var(--text);
  border-color: var(--border-strong);
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

/* Mobile: the dock hides behind the bottom sheet while it is open. */
@media (max-width: 767.98px) {
  .panel-open .bottom-dock {
    visibility: hidden;
  }
}
</style>
