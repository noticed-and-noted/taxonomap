<script setup lang="ts">
/**
 * Desktop/tablet filters: a vertical icon rail on the map's left edge. Each
 * icon opens its group in a flyout beside the rail, which stays open while
 * you use the map (and alongside the cell panel on the right). Escape, the
 * close button or the same icon hides it. Phones use the Filters sheet.
 * Settings (map colours) sits at the foot of the rail, apart from the filters.
 */
import { useStore } from '@nanostores/vue';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import LegalLinks from '~/components/atoms/LegalLinks.vue';
import CubesSetting from '~/components/molecules/CubesSetting.vue';
import MapSettings from '~/components/molecules/MapSettings.vue';
import OnboardingSettings from '~/components/molecules/OnboardingSettings.vue';
import ReadingSettings from '~/components/molecules/ReadingSettings.vue';
import SearchFitSetting from '~/components/molecules/SearchFitSetting.vue';
import { $activeFilterCount, $groupCounts, FILTER_GROUPS, SETTINGS, type FilterGroupId } from '~/lib/filter-groups';
import { $railOpen, clearFilters } from '~/stores/explorer';
import { $tourOpen } from '~/stores/onboarding';
import FilterGroup from './FilterGroup.vue';

type PanelId = FilterGroupId | 'settings';

const counts = useStore($groupCounts);
const total = useStore($activeFilterCount);
// Shared, so the legend can open a group and a resize can hand it to the phone sheet.
const open = useStore($railOpen);
const current = computed(() =>
  open.value === 'settings' ? SETTINGS : (FILTER_GROUPS.find((group) => group.id === open.value) ?? null),
);
const buttons = ref<Record<string, HTMLButtonElement>>({});

/* The flyout may stop short of the dock below it, but never shorter than the rail beside it. */
const rail = ref<HTMLElement>();
const railHeight = ref(0);
let railObserver: ResizeObserver | undefined;
onMounted(() => {
  railObserver = new ResizeObserver(() => (railHeight.value = rail.value?.offsetHeight ?? 0));
  if (rail.value) railObserver.observe(rail.value);
});
onBeforeUnmount(() => railObserver?.disconnect());
const tourOpen = useStore($tourOpen);

// The tour (restarted from Settings) spotlights the rail itself, so the flyout makes way.
watch(tourOpen, (isOpen) => {
  if (isOpen) $railOpen.set(null);
});

function toggle(id: PanelId) {
  $railOpen.set(open.value === id ? null : id);
}

async function close() {
  const id = open.value;
  $railOpen.set(null);
  await nextTick();
  if (id) buttons.value[id]?.focus();
}

function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape' && open.value) {
    event.stopPropagation();
    void close();
  }
}

function label(name: string, count: number) {
  return count ? `${name}, ${count} active` : name;
}
</script>

<template>
  <div class="filter-rail-wrap" :style="{ '--rail-height': `${railHeight}px` }" @keydown="onKey">
    <nav ref="rail" class="rail" aria-label="Filters" data-tour="filters">
      <button
        v-for="group in FILTER_GROUPS"
        :key="group.id"
        :ref="(element) => element && (buttons[group.id] = element as HTMLButtonElement)"
        :data-tour="`rail-${group.id}`"
        type="button"
        class="rail-btn"
        :class="{ active: counts[group.id] }"
        :aria-expanded="open === group.id"
        aria-controls="filter-flyout"
        :aria-label="label(group.title, counts[group.id])"
        @click="toggle(group.id)"
      >
        <svg viewBox="0 0 24 24" class="size-5" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">
          <path :d="group.icon" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <span class="rail-label" aria-hidden="true">{{ group.label }}</span>
        <span v-if="counts[group.id]" class="badge tabular-nums" aria-hidden="true">{{ counts[group.id] }}</span>
      </button>
      <button v-if="total" type="button" class="rail-btn rail-clear" @click="clearFilters">
        <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
        <span class="rail-label">Clear</span>
        <span class="sr-only"> all filters</span>
      </button>
      <button
        :ref="(element) => element && (buttons.settings = element as HTMLButtonElement)"
        type="button"
        class="rail-btn rail-settings"
        data-tour="rail-settings"
        :aria-expanded="open === 'settings'"
        aria-controls="filter-flyout"
        @click="toggle('settings')"
      >
        <svg viewBox="0 0 24 24" class="size-5" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">
          <path :d="SETTINGS.icon" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <span class="rail-label">{{ SETTINGS.label }}</span>
      </button>
    </nav>

    <Transition name="flyout">
      <section
        v-if="current"
        id="filter-flyout"
        class="flyout"
        :class="{ when: current.id === 'when' }"
        :aria-labelledby="'filter-flyout-title'"
      >
        <header class="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
          <h2 id="filter-flyout-title" class="font-display text-base">{{ current.title }}</h2>
          <button
            type="button"
            class="grid size-7 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-text"
            :aria-label="current.id === 'settings' ? 'Hide settings' : `Hide ${current.title} filters`"
            @click="close"
          >
            <svg
              viewBox="0 0 24 24"
              class="size-4"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              aria-hidden="true"
            >
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </header>
        <div v-if="current.id === 'settings'" class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-3">
          <MapSettings />
          <section class="-mx-4 border-t border-border px-4 py-3" aria-labelledby="reading-settings-title">
            <h3 id="reading-settings-title" class="mb-2 font-sans text-sm font-medium">Reading and display</h3>
            <ReadingSettings in-settings />
          </section>
          <SearchFitSetting class="-mx-4 border-t border-border px-4 py-3" />
          <CubesSetting class="-mx-4 border-t border-border px-4 py-3" />
          <OnboardingSettings class="-mx-4 border-t border-border px-4 py-3" />
          <LegalLinks class="-mx-4 border-t border-border px-4 py-2" />
        </div>
        <div v-else class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
          <FilterGroup :group="current.id" />
        </div>
      </section>
    </Transition>
  </div>
</template>

<style scoped>
/*
 * Full height of the rail region, so the flyout's max-height resolves and a
 * long panel (settings) scrolls inside it. The empty space lets clicks
 * through to the map.
 */
.filter-rail-wrap {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  height: 100%;
  pointer-events: none;
}
.rail,
.flyout {
  pointer-events: auto;
}

.rail {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  padding: 0.25rem;
  border-radius: var(--radius-lg);
  border: 1px solid var(--border);
  background: var(--surface);
  box-shadow: var(--shadow);
}

.rail-btn {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.125rem;
  width: 3.25rem;
  padding: 0.4375rem 0 0.3125rem;
  border-radius: var(--radius);
  color: var(--text-muted);
  transition:
    color var(--dur-fast) var(--ease),
    background var(--dur-fast) var(--ease);
}
.rail-btn:hover {
  color: var(--text);
  background: var(--surface-2);
}
.rail-btn.active {
  color: var(--text);
}
.rail-btn[aria-expanded='true'] {
  color: var(--text);
  background: var(--accent-soft);
}

.rail-label {
  font-size: 0.6875rem;
  line-height: 1;
}

.badge {
  position: absolute;
  top: 0.1875rem;
  right: 0.3125rem;
  display: grid;
  place-items: center;
  min-width: 1rem;
  height: 1rem;
  padding: 0 0.25rem;
  border-radius: 999px;
  background: var(--accent);
  color: var(--accent-contrast);
  font-size: 0.6875rem;
  font-weight: 600;
  line-height: 1;
}

.rail-settings {
  margin-top: 0.25rem;
  border-top: 1px solid var(--border);
  border-radius: 0 0 var(--radius) var(--radius);
  padding-top: 0.5rem;
}

.rail-clear {
  margin-top: 0.25rem;
  border-top: 1px solid var(--border);
  border-radius: 0 0 var(--radius) var(--radius);
  padding-top: 0.5rem;
}

/* The date pill and record count need the extra room to share a line. */
.flyout.when {
  width: 20rem;
}
.flyout {
  display: flex;
  flex-direction: column;
  width: 18rem;
  max-width: var(--flyout-max, 18rem);
  /* --dock-clear: the legend dock's height plus a gap, set by ExplorerOverlay. */
  max-height: max(var(--rail-height, 0px), 100% - var(--dock-clear, 0px));
  overflow: hidden;
  border-radius: var(--radius-lg);
  border: 1px solid var(--border);
  background: var(--surface);
  box-shadow: var(--shadow);
}

.flyout-enter-active,
.flyout-leave-active {
  transition:
    transform var(--dur-slow) var(--ease),
    opacity var(--dur-slow) var(--ease);
}
.flyout-enter-from,
.flyout-leave-to {
  transform: translateX(-12px);
  opacity: 0;
}
</style>
