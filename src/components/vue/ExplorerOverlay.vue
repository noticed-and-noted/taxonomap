<script setup lang="ts">
/**
 * Map-page controls (client:only): taxon chip, filter rail, basemap
 * switcher, time slider + histogram, legend, and the side panel / bottom sheet.
 * On small screens the filters move into the sheet behind a Filters button.
 * "Near me" (`?near=1`) swaps these controls for the NearExplorer panel.
 */
import { useStore } from '@nanostores/vue';
import { computed, ref, watch } from 'vue';
import { $panel, $selectedHex, clearFilters, clearHexSelection } from '~/stores/explorer';
import { $nearMode, exitNearMode } from '~/stores/near';
import BasemapSwitcher from './BasemapSwitcher.vue';
import FilterGroup from './FilterGroup.vue';
import { $activeFilterCount, FILTER_GROUPS } from './filterGroups';
import FilterRail from './FilterRail.vue';
import HexPanel from './HexPanel.vue';
import MapLegend from './MapLegend.vue';
import MapProgress from './MapProgress.vue';
import MapSettings from './MapSettings.vue';
import NearExplorer from './NearExplorer.vue';
import ResponsivePanel from './ResponsivePanel.vue';
import TaxonChip from './TaxonChip.vue';
import TimeSlider from './TimeSlider.vue';
import { useYearHistogram } from './useYearHistogram';

const panel = useStore($panel);
const hex = useStore($selectedHex);
const activeFilters = useStore($activeFilterCount);
const near = useStore($nearMode);
const { counts, loading, error, live } = useYearHistogram();

/* The year histogram starts collapsed; opening it is remembered per browser. */
const TIMELINE_KEY = 'timeline-open';
function readTimelineOpen() {
  try {
    return localStorage.getItem(TIMELINE_KEY) === 'true';
  } catch {
    return false;
  }
}
const timelineOpen = ref(readTimelineOpen());
watch(timelineOpen, (open) => {
  try {
    localStorage.setItem(TIMELINE_KEY, String(open));
  } catch {
    /* Storage unavailable (private mode, blocked): keep the in-memory choice. */
  }
});

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

const hexOpen = computed(() => panel.value === 'hex' && hex.value !== null);
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
  <div v-if="near" class="pointer-events-none absolute inset-0 z-10">
    <NearExplorer />
  </div>

  <div v-else class="explorer-overlay pointer-events-none absolute inset-0 z-10" :class="{ 'panel-open': panelOpen }">
    <div
      class="top-bar pointer-events-none absolute left-3 right-3 top-3 flex items-start justify-between gap-2 *:pointer-events-auto"
    >
      <div class="min-w-0"><TaxonChip /></div>
      <div class="ml-auto hidden shrink-0 items-start gap-2 sm:flex">
        <button type="button" class="near-btn" aria-pressed="false" @click="toggleNear">
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
      <button type="button" class="near-btn near-phone ml-auto" aria-pressed="false" @click="toggleNear">
        <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
          <path :d="pinIcon" />
        </svg>
        <span class="sr-only">Near me</span>
      </button>
      <button
        type="button"
        class="filters-btn"
        :aria-expanded="filtersOpen"
        :class="{ active: activeFilters }"
        @click="openFilters"
      >
        <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d="M4 6h16M7 12h10M10 18h4" />
        </svg>
        Filters<span v-if="activeFilters" class="tabular-nums"> ({{ activeFilters }})</span>
      </button>
      <!-- Under the right-hand pills (2rem tall) on every screen size. -->
      <MapProgress class="absolute right-0 top-10" />
    </div>

    <div
      class="bottom-dock pointer-events-auto absolute bottom-3 left-3 rounded-lg border border-border bg-surface/95 p-3 shadow-panel backdrop-blur"
      :class="{ collapsed: !timelineOpen }"
    >
      <button
        type="button"
        class="timeline-toggle"
        :aria-expanded="timelineOpen"
        aria-controls="timeline"
        :aria-label="timelineOpen ? 'Hide records per year' : 'Show records per year'"
        @click="timelineOpen = !timelineOpen"
      >
        <span v-if="!timelineOpen">Records per year</span>
        <svg viewBox="0 0 12 12" class="size-3" aria-hidden="true">
          <path
            :d="timelineOpen ? 'M3 4.5l3 3 3-3' : 'M3 7.5l3-3 3 3'"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
          />
        </svg>
      </button>
      <div v-show="timelineOpen" id="timeline">
        <TimeSlider :counts="counts" :loading="loading" :failed="error !== null" :live="live" />
      </div>
      <MapLegend class="w-full max-w-56" :class="{ 'mt-3': timelineOpen }" />
    </div>

    <div class="rail-region pointer-events-none absolute bottom-3 left-3 top-14 hidden *:pointer-events-auto sm:block">
      <FilterRail />
    </div>

    <div class="pointer-events-auto">
      <ResponsivePanel :title="panelTitle" :open="panelOpen" @close="closePanel">
        <div v-if="filtersOpen" class="space-y-6">
          <section v-for="g in FILTER_GROUPS" :key="g.id">
            <h3 class="mb-2 font-display text-base">{{ g.title }}</h3>
            <FilterGroup :group="g.id" />
          </section>
          <button v-if="activeFilters" type="button" class="clear-all" @click="clearFilters">Clear all filters</button>
          <div>
            <p class="mb-2 text-sm font-medium">Basemap</p>
            <BasemapSwitcher />
          </div>
          <MapSettings />
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

/* Expanded, the toggle sits in the chart's title row; collapsed, it leads the dock. */
.bottom-dock {
  width: min(34rem, calc(100% - 1.5rem));
}
.bottom-dock.collapsed {
  width: 15.5rem; /* the legend's 14rem plus padding */
}
.timeline-toggle {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  height: 1.5rem;
  padding: 0 0.375rem;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  font-size: 0.75rem;
  font-weight: 500;
}
.timeline-toggle:hover {
  color: var(--text);
  background: var(--surface-2);
}
.collapsed .timeline-toggle {
  position: static;
  margin: -0.25rem 0 0.375rem -0.375rem;
  color: var(--text);
}

/* Phone-only control (scoped display would otherwise beat a sm:hidden utility). */
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
  .panel-open .bottom-dock:not(.collapsed) {
    width: min(34rem, calc(100% - var(--panel-width) - 2.25rem));
  }
}

/* Mobile: the dock hides behind the bottom sheet while it is open. */
@media (max-width: 767.98px) {
  .panel-open .bottom-dock {
    visibility: hidden;
  }
}
</style>
