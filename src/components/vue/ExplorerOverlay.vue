<script setup lang="ts">
/**
 * Map-page controls (client:only): filter chips, basemap switcher, time
 * slider + histogram, legend, and the side panel / bottom sheet.
 * On small screens the filters move into the sheet behind a Filters button.
 */
import { useStore } from '@nanostores/vue';
import { computed } from 'vue';
import {
  $basisOfRecord,
  $compareMode,
  $country,
  $hasPhoto,
  $panel,
  $selectedHex,
  $selectedRecord,
  clearHexSelection,
} from '~/stores/explorer';
import BasemapSwitcher from './BasemapSwitcher.vue';
import CompareControls from './CompareControls.vue';
import FilterChips from './FilterChips.vue';
import HexPanel from './HexPanel.vue';
import MapLegend from './MapLegend.vue';
import ResponsivePanel from './ResponsivePanel.vue';
import TimeSlider from './TimeSlider.vue';
import { useYearHistogram } from './useYearHistogram';

const panel = useStore($panel);
const hex = useStore($selectedHex);
const record = useStore($selectedRecord);
const basis = useStore($basisOfRecord);
const photo = useStore($hasPhoto);
const country = useStore($country);
const compare = useStore($compareMode);
const { counts, loading, error, live } = useYearHistogram();

const compareOpen = computed(() => panel.value === 'compare' || compare.value !== 'off');
function openCompare() {
  if (compareOpen.value) {
    $compareMode.set('off');
    if (panel.value === 'compare') $panel.set('none');
  } else {
    $compareMode.set('species');
  }
}

const hexOpen = computed(() => panel.value === 'hex' && hex.value !== null);
const filtersOpen = computed(() => panel.value === 'filters');
const panelOpen = computed(() => hexOpen.value || filtersOpen.value);
const panelTitle = computed(() => (filtersOpen.value ? 'Filters' : record.value !== null ? 'Record' : 'Selected cell'));
const activeFilters = computed(() => (basis.value.length ? 1 : 0) + (photo.value ? 1 : 0) + (country.value ? 1 : 0));

function openFilters() {
  $panel.set(filtersOpen.value ? (hex.value ? 'hex' : 'none') : 'filters');
}

function closePanel() {
  if (filtersOpen.value) $panel.set(hex.value ? 'hex' : 'none');
  else clearHexSelection();
}
</script>

<template>
  <div class="explorer-overlay pointer-events-none absolute inset-0 z-10" :class="{ 'panel-open': panelOpen }">
    <div
      class="top-bar pointer-events-none absolute left-3 right-3 top-3 flex items-start justify-between gap-2 *:pointer-events-auto"
    >
      <!-- Desktop/tablet: chips inline. -->
      <div class="hidden min-w-0 sm:block"><FilterChips /></div>
      <div class="ml-auto hidden items-start gap-2 sm:flex">
        <button type="button" class="compare-btn" :aria-pressed="compareOpen" @click="openCompare">Compare</button>
        <BasemapSwitcher />
      </div>
      <!-- Phone: selected taxon + Filters button. -->
      <div class="min-w-0 sm:hidden"><FilterChips parts="taxon" /></div>
      <button
        type="button"
        class="filters-btn ml-auto"
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

    <div v-if="compareOpen" class="compare-wrap pointer-events-auto absolute left-3 top-14">
      <CompareControls />
    </div>

    <div
      class="bottom-dock pointer-events-auto absolute bottom-3 left-3 w-[min(34rem,calc(100%-1.5rem))] rounded-lg border border-border bg-surface/95 p-3 shadow-panel backdrop-blur"
    >
      <TimeSlider :counts="counts" :loading="loading" :failed="error !== null" :live="live" />
      <MapLegend v-if="compare !== 'species'" class="mt-3 w-full max-w-56" />
    </div>

    <div class="pointer-events-auto">
      <ResponsivePanel :title="panelTitle" :open="panelOpen" @close="closePanel">
        <div v-if="filtersOpen" class="space-y-5">
          <FilterChips parts="filters" stacked />
          <button type="button" class="compare-btn" :aria-pressed="compareOpen" @click="openCompare">Compare</button>
          <div>
            <p class="mb-2 text-sm font-medium">Basemap</p>
            <BasemapSwitcher />
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

.compare-btn {
  height: 2rem;
  padding: 0 0.75rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-muted);
  font-size: 0.8125rem;
  box-shadow: var(--shadow);
}

.compare-btn[aria-pressed='true'] {
  color: var(--text);
  border-color: var(--accent);
}

.filters-btn.active {
  color: var(--text);
  border-color: var(--accent);
}

/* Phone-only control (scoped display would otherwise beat a sm:hidden utility). */
@media (min-width: 640px) {
  .filters-btn {
    display: none;
  }
}

/* Keep the dock clear of the desktop side panel. */
@media (min-width: 768px) {
  .panel-open .top-bar {
    right: calc(var(--panel-width) + 1.5rem);
  }
  .panel-open .bottom-dock {
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
