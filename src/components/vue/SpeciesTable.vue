<script setup lang="ts">
/**
 * Sortable species table for the cell and Near me panels. Sorting (column
 * headers), name search and the filter popover all work on the rows already
 * loaded. The only requests are lazy, for rows scrolled into view: photos,
 * and names the baked index lacked (every row's name once you sort by name
 * or search).
 */
import { useStore } from '@nanostores/vue';
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue';
import { compact } from '~/lib/format';
import { normalise } from '~/lib/data/name-index';
import { debounce } from '~/lib/util/debounce';
import type { ClassGroup, SpeciesRow } from '~/lib/species/groups';
import { $speciesManifest, speciesPath } from '~/lib/species/links';
import ListSkeleton from './ListSkeleton.vue';
import SkeletonBlock from './SkeletonBlock.vue';
import ThumbImage from './ThumbImage.vue';
import { useRowDetails } from './useRowDetails';
import { useScrollFade } from './useScrollFade';

const props = defineProps<{
  rows: readonly SpeciesRow[];
  groups: readonly ClassGroup[];
  loading?: boolean;
  /** Keys to highlight (taxa selected on the map). */
  selected?: readonly number[];
  /** How the list was cut, e.g. "Top 25 species in each group". */
  note?: string;
  /** Fill the space left in a flex column instead of a fixed-height scroll box. */
  fill?: boolean;
}>();

type SortKey = 'name' | 'group' | 'records';
const PAGE = 50;

const manifest = useStore($speciesManifest);
const id = useId();

const query = ref('');
const sortKey = ref<SortKey>('records');
const sortDesc = ref(true);
const groupsOn = ref<number[]>([]);
const limit = ref(PAGE);
const filterOpen = ref(false);
const filterBtn = ref<HTMLButtonElement>();
const popover = ref<HTMLElement>();
const scroller = ref<HTMLElement>();
const broken = ref(new Set<number>());

const groupBy = computed(() => new Map(props.groups.map((g) => [g.key, g])));
const groupLabel = (key: number) => {
  const g = groupBy.value.get(key);
  return g ? (g.common ?? g.name) : '';
};
// Rows currently scrolled into the results box (or just below it); see observeRows.
const inView = ref(new Set<number>());
// Photos, and names the index lacked, looked up as rows come into view.
const { commonName, sciName, pendingName, photoOf, pendingPhoto } = useRowDetails({
  rows: () => props.rows,
  dataset: () => props.groups,
  inView,
  needAllNames: () => sortKey.value === 'name' || !!query.value.trim(),
});
const displayName = (r: SpeciesRow) => commonName(r) ?? sciName(r);
const initials = (r: SpeciesRow) =>
  displayName(r)
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');

/** Groups that have rows, with their share of the largest group's records. */
const groupOptions = computed(() => {
  const present = new Set(props.rows.map((r) => r.classKey));
  const gs = props.groups.filter((g) => present.has(g.key));
  const max = Math.max(1, ...gs.map((g) => g.records));
  return gs.map((g) => ({ ...g, bar: g.records / max }));
});
const canFilter = computed(() => groupOptions.value.length > 1);
/** First load: nothing to search or filter yet. */
const pending = computed(() => props.loading && !props.rows.length);

const activeFilters = computed(() => (groupsOn.value.length ? 1 : 0));

const filtered = computed(() => {
  const q = normalise(query.value);
  const on = new Set(groupsOn.value);
  return props.rows.filter(
    (r) => (!on.size || on.has(r.classKey)) && (!q || normalise(`${commonName(r) ?? ''} ${sciName(r)}`).includes(q)),
  );
});

const sorted = computed(() => {
  const dir = sortDesc.value ? -1 : 1;
  const byName = (a: SpeciesRow, b: SpeciesRow) => displayName(a).localeCompare(displayName(b));
  const cmp: Record<SortKey, (a: SpeciesRow, b: SpeciesRow) => number> = {
    name: (a, b) => dir * byName(a, b),
    records: (a, b) => dir * (a.records - b.records) || byName(a, b),
    // Within a group, most-recorded first whichever way the groups run.
    group: (a, b) => dir * groupLabel(a.classKey).localeCompare(groupLabel(b.classKey)) || b.records - a.records,
  };
  return [...filtered.value].sort(cmp[sortKey.value]);
});

const visible = computed(() => sorted.value.slice(0, limit.value));

// Soft fade at the bottom of the results while there's more to scroll to.
const { fadeBottom: resultsFade, update: updateResultsFade } = useScrollFade(scroller);
watch([visible, scroller], () => void nextTick(updateResultsFade), { immediate: true });

// Settles after scrolling pauses, so rows flicked past aren't looked up.
let io: IntersectionObserver | undefined;
let intersecting = new Set<number>();
const settle = debounce((keys: Set<number>) => (inView.value = keys), 150);
function observeRows() {
  io?.disconnect();
  intersecting = new Set();
  const root = scroller.value;
  if (!root) return;
  io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const key = Number((e.target as HTMLElement).dataset['key']);
        if (e.isIntersecting) intersecting.add(key);
        else intersecting.delete(key);
      }
      settle(new Set(intersecting));
    },
    { root, rootMargin: '0px 0px 120px 0px' },
  );
  for (const tr of root.querySelectorAll<HTMLElement>('tr[data-key]')) io.observe(tr);
}
watch([visible, scroller], () => void nextTick(observeRows), { immediate: true });

const maxRecords = computed(() => Math.max(1, ...props.rows.map((r) => r.records)));

/** A click anywhere on a row follows its species link (the link itself stays for keyboard and middle-click). */
function openRow(e: MouseEvent) {
  if ((e.target as HTMLElement).closest('a')) return;
  (e.currentTarget as HTMLElement).querySelector('a')?.click();
}

function sortBy(key: SortKey) {
  if (sortKey.value === key) sortDesc.value = !sortDesc.value;
  else {
    sortKey.value = key;
    sortDesc.value = key === 'records';
  }
}
const ariaSort = (key: SortKey) =>
  sortKey.value === key ? (sortDesc.value ? 'descending' : 'ascending') : ('none' as const);

function resetFilters() {
  groupsOn.value = [];
}
function resetAll() {
  resetFilters();
  query.value = '';
}

function closeFilter(refocus = false) {
  filterOpen.value = false;
  if (refocus) filterBtn.value?.focus();
}
function onDocPointer(e: PointerEvent) {
  const t = e.target as Node;
  if (!popover.value?.contains(t) && !filterBtn.value?.contains(t)) closeFilter();
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') closeFilter(true);
}
watch(filterOpen, (open) => {
  if (open) {
    document.addEventListener('pointerdown', onDocPointer);
    document.addEventListener('keydown', onKey);
  } else {
    document.removeEventListener('pointerdown', onDocPointer);
    document.removeEventListener('keydown', onKey);
  }
});
onBeforeUnmount(() => {
  filterOpen.value = false;
  io?.disconnect();
  settle.cancel();
});

// New data (another cell or area): drop filters that no longer apply.
watch(
  () => props.groups,
  (gs) => {
    const keys = new Set(gs.map((g) => g.key));
    groupsOn.value = groupsOn.value.filter((k) => keys.has(k));
    limit.value = PAGE;
    broken.value = new Set();
  },
);
watch([query, groupsOn, sortKey, sortDesc], () => {
  limit.value = PAGE;
  scroller.value?.scrollTo({ top: 0 });
});
</script>

<template>
  <div class="species-table" :class="fill ? 'flex min-h-0 flex-1 flex-col gap-2' : 'space-y-2'">
    <div class="relative flex gap-2">
      <label class="min-w-0 flex-1">
        <span class="sr-only">Find in results</span>
        <span class="relative block">
          <svg
            class="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            v-model="query"
            type="search"
            placeholder="Find in results"
            :disabled="pending"
            class="w-full rounded-md border border-border bg-surface-2 py-1.5 pl-8 pr-2 text-sm placeholder:text-subtle focus:border-accent focus:outline-none disabled:opacity-60"
          />
        </span>
      </label>
      <button
        v-if="canFilter || pending"
        ref="filterBtn"
        type="button"
        :disabled="pending"
        class="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md border px-2.5 text-sm transition-colors duration-200 disabled:cursor-default disabled:opacity-60"
        :class="activeFilters ? 'border-accent bg-accent-soft' : 'border-border enabled:hover:border-border-strong'"
        :aria-expanded="filterOpen"
        :aria-controls="`${id}-filters`"
        @click="filterOpen = !filterOpen"
      >
        <svg class="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d="M4 6h16M7 12h10M10 18h4" />
        </svg>
        Filter<span v-if="activeFilters" class="tabular-nums"> · {{ activeFilters }}</span>
      </button>

      <div
        v-if="filterOpen && canFilter"
        :id="`${id}-filters`"
        ref="popover"
        role="dialog"
        aria-label="Filter species"
        class="absolute right-0 top-full z-20 mt-1 w-64 space-y-3 rounded-lg border border-border-strong bg-surface p-3 text-sm shadow-panel"
      >
        <!-- min-w-0: a fieldset is otherwise as wide as its longest group name. -->
        <fieldset v-if="groupOptions.length > 1" class="min-w-0">
          <legend class="sr-only">Groups</legend>
          <p class="mb-1 flex justify-between px-1.5 text-xs text-subtle" aria-hidden="true">
            <span>Groups</span><span>Records</span>
          </p>
          <!-- Every group shows (at most 8 in a cell, 10 in Near me), so no scrolling. -->
          <div class="space-y-0.5">
            <label
              v-for="g in groupOptions"
              :key="g.key"
              class="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 transition-colors duration-200 hover:bg-surface-2 has-[:checked]:bg-accent-soft has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[var(--focus)]"
            >
              <input v-model="groupsOn" type="checkbox" :value="g.key" class="sr-only" />
              <span class="min-w-0 flex-1 truncate">{{ g.common ?? g.name }}</span>
              <span class="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
                <span
                  class="block h-full rounded-full"
                  :class="groupsOn.includes(g.key) ? 'bg-accent' : 'bg-border-strong'"
                  :style="{ width: `${Math.max(4, g.bar * 100)}%` }"
                ></span>
              </span>
              <span class="w-11 shrink-0 text-right text-xs tabular-nums text-muted">{{ compact(g.records) }}</span>
            </label>
          </div>
        </fieldset>
        <div class="flex justify-between border-t border-border pt-2 text-xs">
          <button type="button" class="text-muted underline hover:text-text" @click="resetFilters">Reset</button>
          <button type="button" class="font-medium" @click="closeFilter(true)">Done</button>
        </div>
      </div>
    </div>

    <ListSkeleton v-if="pending" label="Loading species" :fill="fill">
      <span class="w-[5.5rem] shrink-0"><SkeletonBlock width="3.5rem" height="0.7rem" /></span>
      <span class="flex w-[5rem] shrink-0 items-center justify-end gap-1.5">
        <SkeletonBlock width="1.5rem" height="0.25rem" rounded="full" />
        <SkeletonBlock width="2rem" height="0.8rem" />
      </span>
    </ListSkeleton>

    <template v-else-if="rows.length">
      <p class="text-xs text-subtle" aria-live="polite">
        <template v-if="filtered.length === rows.length">{{ rows.length }} species</template>
        <template v-else>{{ filtered.length }} of {{ rows.length }} species</template>
        <template v-if="note"> · {{ note }}</template>
      </p>

      <!-- Column headers sit above the scroll box; colgroups and a stable scrollbar gutter keep the columns aligned. -->
      <div v-if="filtered.length" :class="{ 'flex min-h-0 flex-1 flex-col': fill }">
        <div class="head-row -mx-4 text-xs text-subtle">
          <table class="w-full table-fixed text-sm" role="presentation">
            <colgroup>
              <col />
              <col class="w-[5.5rem]" />
              <col class="w-[6rem]" />
            </colgroup>
            <thead>
              <tr>
                <th class="py-1.5 pl-4 text-left font-normal">
                  <button type="button" class="sort" :class="{ on: sortKey === 'name' }" @click="sortBy('name')">
                    Species<span aria-hidden="true">{{ sortKey === 'name' ? (sortDesc ? ' ▼' : ' ▲') : ' ↕' }}</span>
                  </button>
                </th>
                <th class="w-[5.5rem] py-1.5 text-left font-normal">
                  <button type="button" class="sort" :class="{ on: sortKey === 'group' }" @click="sortBy('group')">
                    Group<span aria-hidden="true">{{ sortKey === 'group' ? (sortDesc ? ' ▼' : ' ▲') : ' ↕' }}</span>
                  </button>
                </th>
                <th class="py-1.5 pr-4 text-right font-normal">
                  <button type="button" class="sort" :class="{ on: sortKey === 'records' }" @click="sortBy('records')">
                    Records<span aria-hidden="true">{{ sortKey === 'records' ? (sortDesc ? ' ▼' : ' ▲') : ' ↕' }}</span>
                  </button>
                </th>
              </tr>
            </thead>
          </table>
        </div>
        <!-- Scrolls on its own so whatever follows (e.g. the seasonality chart) stays close. -->
        <div
          ref="scroller"
          class="fade-list -mx-4 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]"
          :class="[fill ? 'min-h-48 flex-1' : 'max-h-[min(23rem,65dvh)]', { 'fade-bottom': resultsFade }]"
          tabindex="0"
          aria-label="Species results"
          role="region"
          @scroll.passive="updateResultsFade"
        >
          <table class="w-full table-fixed text-sm">
            <colgroup>
              <col />
              <col class="w-[5.5rem]" />
              <col class="w-[6rem]" />
            </colgroup>
            <thead class="sr-only">
              <tr>
                <th :aria-sort="ariaSort('name')">Species</th>
                <th :aria-sort="ariaSort('group')">Group</th>
                <th :aria-sort="ariaSort('records')">Records</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="r in visible"
                :key="r.key"
                :data-key="r.key"
                class="cursor-pointer border-b border-border hover:bg-surface-2"
                :class="{ 'bg-accent-soft': selected?.includes(r.key) }"
                @click="openRow"
              >
                <td class="py-1.5 pl-4 pr-2">
                  <a :href="speciesPath(r.key, manifest)" class="group flex min-w-0 items-center gap-2">
                    <span class="size-8 shrink-0 overflow-hidden rounded bg-photo">
                      <SkeletonBlock v-if="pendingPhoto(r)" height="100%" rounded="sm" aria-hidden="true" />
                      <ThumbImage
                        v-else-if="photoOf(r) && !broken.has(r.key)"
                        :image="photoOf(r)!"
                        size="200x"
                        alt=""
                        class="size-full object-cover"
                        @broken="broken = new Set(broken).add(r.key)"
                      />
                      <span v-else class="grid size-full place-items-center font-display text-xs text-subtle">
                        {{ initials(r) }}
                      </span>
                    </span>
                    <span v-if="pendingName(r)" class="min-w-0 flex-1 space-y-1" aria-hidden="true">
                      <SkeletonBlock height="0.8rem" width="70%" />
                      <SkeletonBlock height="0.6rem" width="45%" />
                    </span>
                    <span v-if="pendingName(r)" class="sr-only">Loading name</span>
                    <span v-else class="min-w-0">
                      <span class="block truncate group-hover:underline">{{ displayName(r) }}</span>
                      <span v-if="commonName(r)" class="sci-name block truncate text-xs text-muted">{{
                        sciName(r)
                      }}</span>
                    </span>
                  </a>
                </td>
                <td class="truncate py-1.5 pr-1 text-xs text-muted">{{ groupLabel(r.classKey) }}</td>
                <td class="py-1.5 pr-4 text-right tabular-nums">
                  <span class="flex items-center justify-end gap-1.5">
                    <span class="h-1 w-6 shrink-0 overflow-hidden rounded-full bg-surface-3" aria-hidden="true">
                      <span
                        class="block h-full rounded-full bg-accent"
                        :style="{ width: `${Math.max(4, (r.records / maxRecords) * 100)}%` }"
                      ></span>
                    </span>
                    <!-- Fixed width so bars line up whether or not the count has a decimal. -->
                    <span class="w-[2.75rem] shrink-0">{{ compact(r.records) }}</span>
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
          <button
            v-if="sorted.length > limit"
            type="button"
            class="mx-4 mt-2 w-[calc(100%-2rem)] rounded-md border border-border py-1.5 text-xs text-muted hover:border-accent"
            @click="limit += PAGE"
          >
            Show {{ Math.min(PAGE, sorted.length - limit) }} more
          </button>
        </div>
      </div>

      <p v-else class="rounded-md bg-surface-2 p-3 text-sm text-muted">
        No species match.
        <button type="button" class="text-text underline" @click="resetAll">Clear search and filters</button>
      </p>
    </template>
  </div>
</template>

<style scoped>
/* Sticky header: the row border would scroll away, so draw it on the cells. */
.head-row {
  overflow-y: hidden;
  scrollbar-gutter: stable;
  box-shadow: inset 0 -1px 0 var(--border-strong);
}
.sort {
  color: inherit;
}
.sort:hover,
.sort.on {
  color: var(--text);
}
</style>
