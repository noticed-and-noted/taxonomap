<script setup lang="ts">
/**
 * Sortable species table for the cell and Near me panels. Sorting (column
 * headers) and name search work on the rows already loaded; the filter popover
 * picks a group (`v-model:group`) and the parent loads that group's rows. The
 * table's own requests are lazy, for rows scrolled into view: photos, and names
 * the baked index lacked (every row's name once you sort by name). Search matches
 * names already known, plus rows the shared name search finds by other names.
 */
import { useStore } from '@nanostores/vue';
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import SkeletonBlock from '~/components/atoms/SkeletonBlock.vue';
import ThumbImage from '~/components/atoms/ThumbImage.vue';
import UiIcon from '~/components/atoms/UiIcon.vue';
import ListSkeleton from '~/components/molecules/ListSkeleton.vue';
import SearchInput from '~/components/molecules/SearchInput.vue';
import { useCellNameSearch } from '~/composables/useCellNameSearch';
import { useRowDetails } from '~/composables/useRowDetails';
import { useScrollFade } from '~/composables/useScrollFade';
import { normalise } from '~/lib/data/name-index';
import { compact, initials } from '~/lib/format';
import type { ClassGroup, SpeciesRow } from '~/lib/species/groups';
import { $speciesManifest, speciesPath } from '~/lib/species/links';
import { debounce } from '~/lib/util/debounce';
import SpeciesTableGroupFilter from './SpeciesTableGroupFilter.vue';

const props = defineProps<{
  rows: readonly SpeciesRow[];
  groups: readonly ClassGroup[];
  loading?: boolean;
  /** Keys to highlight (taxa selected on the map). */
  selected?: readonly number[];
  /** How the list was cut, e.g. "the 200 most recorded". */
  note?: string | undefined;
  /** Fill the space left in a flex column instead of a fixed-height scroll box. */
  fill?: boolean;
}>();
/** Class the rows are narrowed to (the parent loads them), or null for all. */
const group = defineModel<number | null>('group', { default: null });

type SortKey = 'name' | 'records';
const PAGE = 50;

const manifest = useStore($speciesManifest);

const query = ref('');
const sortKey = ref<SortKey>('records');
const sortDesc = ref(true);
const limit = ref(PAGE);
const scroller = ref<HTMLElement>();
const broken = ref(new Set<number>());

// Rows currently scrolled into the results box (or just below it); see observeRows.
const inView = ref(new Set<number>());
// Photos, and names the index lacked, looked up as rows come into view.
const { commonName, sciName, pendingName, photoOf, pendingPhoto, isLoadingNames } = useRowDetails({
  rows: () => props.rows,
  dataset: () => props.groups,
  inView,
  needAllNames: () => sortKey.value === 'name',
});
const nameSearch = useCellNameSearch({ query, species: () => props.rows });
const isSearchingNames = computed(() => !!query.value.trim() && (isLoadingNames.value || nameSearch.loading.value));
const displayName = (row: SpeciesRow) => commonName(row) ?? sciName(row);

/** First load: nothing to search or filter yet. */
const pending = computed(() => props.loading && !props.rows.length);

const filtered = computed(() => {
  const needle = normalise(query.value);
  return props.rows.filter(
    (row) =>
      !needle ||
      nameSearch.matchedKeys.value.has(row.key) ||
      normalise(`${commonName(row) ?? ''} ${sciName(row)}`).includes(needle),
  );
});

const sorted = computed(() => {
  const dir = sortDesc.value ? -1 : 1;
  const byName = (left: SpeciesRow, right: SpeciesRow) => displayName(left).localeCompare(displayName(right));
  const comparators: Record<SortKey, (left: SpeciesRow, right: SpeciesRow) => number> = {
    name: (left, right) => dir * byName(left, right),
    records: (left, right) => dir * (left.records - right.records) || byName(left, right),
  };
  return [...filtered.value].sort(comparators[sortKey.value]);
});

const visible = computed(() => sorted.value.slice(0, limit.value));

// Soft fade at the bottom of the results while there's more to scroll to.
const { fadeBottom: resultsFade, update: updateResultsFade } = useScrollFade(scroller);
watch([visible, scroller], () => void nextTick(updateResultsFade), { immediate: true });

// Settles after scrolling pauses, so rows flicked past aren't looked up.
let intersectionObserver: IntersectionObserver | undefined;
let intersecting = new Set<number>();
const settle = debounce((keys: Set<number>) => (inView.value = keys), 150);
function observeRows() {
  intersectionObserver?.disconnect();
  intersecting = new Set();
  const root = scroller.value;
  if (!root) return;
  intersectionObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const key = Number((entry.target as HTMLElement).dataset['key']);
        if (entry.isIntersecting) intersecting.add(key);
        else intersecting.delete(key);
      }
      settle(new Set(intersecting));
    },
    { root, rootMargin: '0px 0px 120px 0px' },
  );
  for (const tableRow of root.querySelectorAll<HTMLElement>('tr[data-key]')) intersectionObserver.observe(tableRow);
}
watch([visible, scroller], () => void nextTick(observeRows), { immediate: true });

const maxRecords = computed(() => Math.max(1, ...props.rows.map((row) => row.records)));

/** A click anywhere on a row follows its species link (the link itself stays for keyboard and middle-click). */
function openRow(event: MouseEvent) {
  if ((event.target as HTMLElement).closest('a')) return;
  (event.currentTarget as HTMLElement).querySelector('a')?.click();
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
  group.value = null;
}
function resetAll() {
  resetFilters();
  query.value = '';
}

onBeforeUnmount(() => {
  intersectionObserver?.disconnect();
  settle.cancel();
});

// New data (another cell or area).
watch(
  () => props.groups,
  () => {
    limit.value = PAGE;
    broken.value = new Set();
  },
);
watch([query, group, sortKey, sortDesc], () => {
  limit.value = PAGE;
  scroller.value?.scrollTo({ top: 0 });
});
</script>

<template>
  <div class="species-table" :class="fill ? 'flex min-h-0 flex-1 flex-col gap-2' : 'space-y-2'">
    <div class="relative flex gap-2">
      <label class="min-w-0 flex-1">
        <span class="sr-only">Find in results</span>
        <SearchInput v-model="query" placeholder="Find in results" :disabled="pending" :loading="isSearchingNames" />
      </label>
      <SpeciesTableGroupFilter v-model="group" :groups="groups" :pending="pending" />
    </div>

    <ListSkeleton v-if="pending" label="Loading species" :fill="fill">
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
              <col class="w-[6rem]" />
            </colgroup>
            <thead>
              <tr>
                <th class="py-1.5 pl-4 text-left font-normal">
                  <button type="button" class="sort" :class="{ on: sortKey === 'name' }" @click="sortBy('name')">
                    Species<UiIcon
                      :name="sortKey === 'name' ? (sortDesc ? 'sort-desc' : 'sort-asc') : 'sort'"
                      class="ml-0.5"
                    />
                  </button>
                </th>
                <th class="py-1.5 pr-4 text-right font-normal">
                  <button type="button" class="sort" :class="{ on: sortKey === 'records' }" @click="sortBy('records')">
                    Records<UiIcon
                      :name="sortKey === 'records' ? (sortDesc ? 'sort-desc' : 'sort-asc') : 'sort'"
                      class="ml-0.5"
                    />
                  </button>
                </th>
              </tr>
            </thead>
          </table>
        </div>
        <!-- Scrolls on its own so whatever follows (e.g. the seasonality chart) stays close. -->
        <div
          ref="scroller"
          class="fade-list -mx-4 overflow-y-auto [scrollbar-gutter:stable]"
          :class="[fill ? 'min-h-48 flex-1' : 'max-h-[min(23rem,65dvh)]', { 'fade-bottom': resultsFade }]"
          tabindex="0"
          aria-label="Species results"
          role="region"
          @scroll.passive="updateResultsFade"
        >
          <table class="w-full table-fixed text-sm">
            <colgroup>
              <col />
              <col class="w-[6rem]" />
            </colgroup>
            <thead class="sr-only">
              <tr>
                <th :aria-sort="ariaSort('name')">Species</th>
                <th :aria-sort="ariaSort('records')">Records</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in visible"
                :key="row.key"
                :data-key="row.key"
                class="cursor-pointer border-b border-border hover:bg-surface-2"
                :class="{ 'bg-accent-soft': selected?.includes(row.key) }"
                @click="openRow"
              >
                <td class="py-1.5 pl-4 pr-2">
                  <a :href="speciesPath(row.key, manifest)" class="group flex min-w-0 items-center gap-2">
                    <span class="size-8 shrink-0 overflow-hidden rounded bg-photo">
                      <SkeletonBlock v-if="pendingPhoto(row)" height="100%" rounded="sm" aria-hidden="true" />
                      <ThumbImage
                        v-else-if="photoOf(row) && !broken.has(row.key)"
                        :image="photoOf(row)!"
                        size="200x"
                        alt=""
                        class="size-full object-cover"
                        @broken="broken = new Set(broken).add(row.key)"
                      />
                      <span v-else class="grid size-full place-items-center font-display text-xs text-subtle">
                        {{ initials(displayName(row)) }}
                      </span>
                    </span>
                    <!-- Two lines' height (h-9) whether loading, named or scientific only, so rows never change size. -->
                    <span
                      v-if="pendingName(row)"
                      class="flex h-9 min-w-0 flex-1 flex-col justify-center gap-1"
                      aria-hidden="true"
                    >
                      <SkeletonBlock height="0.8rem" width="70%" />
                      <SkeletonBlock height="0.65rem" width="45%" />
                    </span>
                    <span v-if="pendingName(row)" class="sr-only">Loading name</span>
                    <span v-else class="flex h-9 min-w-0 flex-col justify-center">
                      <span class="block truncate group-hover:underline">{{ displayName(row) }}</span>
                      <span v-if="commonName(row)" class="sci-name block truncate text-xs text-muted">{{
                        sciName(row)
                      }}</span>
                    </span>
                  </a>
                </td>
                <td class="py-1.5 pr-4 text-right tabular-nums">
                  <span class="flex items-center justify-end gap-1.5">
                    <span class="h-1 w-6 shrink-0 overflow-hidden rounded-full bg-surface-3" aria-hidden="true">
                      <span
                        class="block h-full rounded-full bg-accent"
                        :style="{ width: `${Math.max(4, (row.records / maxRecords) * 100)}%` }"
                      ></span>
                    </span>
                    <!-- Fixed width so bars line up whether or not the count has a decimal. -->
                    <span class="w-[2.75rem] shrink-0">{{ compact(row.records) }}</span>
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

    <!-- Records named only to genus or above have no species key, so they are counted but never listed. -->
    <p v-else class="rounded-md bg-surface-2 p-3 text-sm text-muted">
      None of these records is identified to species. See the Records tab.
    </p>
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
