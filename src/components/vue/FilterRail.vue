<script setup lang="ts">
/**
 * Desktop/tablet filters: a vertical icon rail on the map's left edge. Each
 * icon opens its group in a flyout beside the rail, which stays open while
 * you use the map (and alongside the cell panel on the right). Escape, the
 * close button or the same icon hides it. Phones use the Filters sheet.
 * Settings (map colours) sits at the foot of the rail, apart from the filters.
 */
import { useStore } from '@nanostores/vue';
import { computed, nextTick, ref } from 'vue';
import { clearFilters } from '~/stores/explorer';
import { $activeFilterCount, $groupCounts, FILTER_GROUPS, type FilterGroupId } from './filterGroups';
import FilterGroup from './FilterGroup.vue';
import MapSettings from './MapSettings.vue';

type PanelId = FilterGroupId | 'settings';

const SETTINGS = {
  id: 'settings',
  label: 'Settings',
  title: 'Settings',
  icon: 'M4 6h8M16 6h4M4 12h2M10 12h10M4 18h10M18 18h2M14 4v4M8 10v4M16 16v4',
} as const;

const counts = useStore($groupCounts);
const total = useStore($activeFilterCount);
const open = ref<PanelId | null>(null);
const current = computed(() =>
  open.value === 'settings' ? SETTINGS : (FILTER_GROUPS.find((g) => g.id === open.value) ?? null),
);
const buttons = ref<Record<string, HTMLButtonElement>>({});

function toggle(id: PanelId) {
  open.value = open.value === id ? null : id;
}

async function close() {
  const id = open.value;
  open.value = null;
  await nextTick();
  if (id) buttons.value[id]?.focus();
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && open.value) {
    e.stopPropagation();
    void close();
  }
}

function label(name: string, n: number) {
  return n ? `${name}, ${n} active` : name;
}
</script>

<template>
  <div class="filter-rail-wrap" @keydown="onKey">
    <nav class="rail" aria-label="Filters">
      <button
        v-for="g in FILTER_GROUPS"
        :key="g.id"
        :ref="(el) => el && (buttons[g.id] = el as HTMLButtonElement)"
        type="button"
        class="rail-btn"
        :class="{ active: counts[g.id] }"
        :aria-expanded="open === g.id"
        aria-controls="filter-flyout"
        :aria-label="label(g.title, counts[g.id])"
        @click="toggle(g.id)"
      >
        <svg viewBox="0 0 24 24" class="size-5" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">
          <path :d="g.icon" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <span class="rail-label" aria-hidden="true">{{ g.label }}</span>
        <span v-if="counts[g.id]" class="badge tabular-nums" aria-hidden="true">{{ counts[g.id] }}</span>
      </button>
      <button v-if="total" type="button" class="rail-btn rail-clear" @click="clearFilters">
        <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
        <span class="rail-label">Clear</span>
        <span class="sr-only"> all filters</span>
      </button>
      <button
        :ref="(el) => el && (buttons.settings = el as HTMLButtonElement)"
        type="button"
        class="rail-btn rail-settings"
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
      <section v-if="current" id="filter-flyout" class="flyout" :aria-labelledby="'filter-flyout-title'">
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
        <!-- Settings scrolls its own option list, so its body doesn't scroll. -->
        <div v-if="current.id === 'settings'" class="flex min-h-0 flex-1 flex-col px-4 pt-3">
          <MapSettings />
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

.flyout {
  display: flex;
  flex-direction: column;
  width: 18rem;
  max-width: var(--flyout-max, 18rem);
  max-height: 100%;
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
