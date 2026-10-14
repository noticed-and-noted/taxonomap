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
import { $checklist, toggleSeen } from '~/lib/near/checklist';
import type { UsableImage } from '~/lib/gbif';
import { photosForKeys, resolveNames, type ClassGroup, type SpeciesRow } from '~/lib/species/groups';
import { $speciesManifest, speciesPath } from '~/lib/species/links';
import SkeletonBlock from './SkeletonBlock.vue';
import ThumbImage from './ThumbImage.vue';

const props = defineProps<{
  rows: readonly SpeciesRow[];
  groups: readonly ClassGroup[];
  loading?: boolean;
  /** Keys to highlight (taxa selected on the map). */
  selected?: readonly number[];
  /** Show the "Seen" checklist column and the "Hide seen" filter. */
  checklist?: boolean;
  /** How the list was cut, e.g. "Top 25 species in each group". */
  note?: string;
}>();

type SortKey = 'name' | 'group' | 'records';
const PAGE = 50;
const MIN_RECORDS = [0, 10, 100] as const;

const manifest = useStore($speciesManifest);
const seen = useStore($checklist);
const id = useId();

const query = ref('');
const sortKey = ref<SortKey>('records');
const sortDesc = ref(true);
const groupsOn = ref<number[]>([]);
const minRecords = ref<(typeof MIN_RECORDS)[number]>(0);
const hideSeen = ref(false);
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
/** Names looked up after load, for rows the index and batch search missed. */
const lateNames = ref(new Map<number, string>());
const sciName = (r: SpeciesRow) => (r.unnamed ? lateNames.value.get(r.key) : undefined) ?? r.scientificName;
/** Lookups that came back empty: show the "Species N" fallback, not a skeleton. */
const noName = ref(new Set<number>());
const pendingName = (r: SpeciesRow) => !!r.unnamed && !lateNames.value.has(r.key) && !noName.value.has(r.key);
const displayName = (r: SpeciesRow) => r.commonName ?? sciName(r);
/** Photos found after load; `photoDone` marks keys searched (found or not). */
const latePhotos = ref(new Map<number, UsableImage>());
const photoDone = ref(new Set<number>());
const photoOf = (r: SpeciesRow) => r.image ?? latePhotos.value.get(r.key);
const pendingPhoto = (r: SpeciesRow) => !photoOf(r) && !photoDone.value.has(r.key);
const initials = (r: SpeciesRow) =>
  displayName(r)
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');

/** Groups that have rows, with how many species each contributes. */
const groupOptions = computed(() => {
  const n = new Map<number, number>();
  for (const r of props.rows) n.set(r.classKey, (n.get(r.classKey) ?? 0) + 1);
  return props.groups.filter((g) => n.has(g.key)).map((g) => ({ ...g, species: n.get(g.key) ?? 0 }));
});

const activeFilters = computed(
  () => (groupsOn.value.length ? 1 : 0) + (minRecords.value ? 1 : 0) + (hideSeen.value ? 1 : 0),
);

const filtered = computed(() => {
  const q = normalise(query.value);
  const on = new Set(groupsOn.value);
  return props.rows.filter(
    (r) =>
      (!on.size || on.has(r.classKey)) &&
      r.records >= minRecords.value &&
      !(props.checklist && hideSeen.value && seen.value[String(r.key)]) &&
      (!q || normalise(`${r.commonName ?? ''} ${sciName(r)}`).includes(q)),
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

// Rows currently scrolled into the results box (or just below it). Settles
// after scrolling pauses, so rows flicked past aren't looked up.
const inView = ref(new Set<number>());
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

// Lazy lookups. Photos: rows in view. Names: rows in view, unless sorting by
// name or searching needs them all. Photos go first because their records
// carry names too. Each key is asked for once per data set.
let photoAsked = new Set<number>();
let nameAsked = new Set<number>();
let lazyCtrl: AbortController | undefined;
let lazyFor: readonly ClassGroup[] | undefined;
const inViewRows = computed(() => props.rows.filter((r) => inView.value.has(r.key)));
const needPhotos = computed(() => inViewRows.value.filter((r) => !r.image).map((r) => r.key));
const needNames = computed(() =>
  (sortKey.value === 'name' || query.value.trim() ? props.rows : inViewRows.value)
    .filter((r) => r.unnamed)
    .map((r) => r.key),
);
watch(
  [needPhotos, needNames],
  async ([photoKeys, nameKeys]) => {
    if (lazyFor !== props.groups) {
      // New cell or area: forget the last one's lookups and stop them.
      lazyCtrl?.abort();
      lazyCtrl = new AbortController();
      lazyFor = props.groups;
      photoAsked = new Set();
      nameAsked = new Set();
      lateNames.value = new Map();
      noName.value = new Set();
      latePhotos.value = new Map();
      photoDone.value = new Set();
    }
    const ctrl = lazyCtrl;
    const photos = photoKeys.filter((k) => !photoAsked.has(k));
    let names = nameKeys.filter((k) => !nameAsked.has(k));
    for (const k of photos) photoAsked.add(k);
    for (const k of names) nameAsked.add(k);

    if (photos.length) {
      const found = await photosForKeys(photos, ctrl?.signal);
      if (ctrl !== lazyCtrl) return;
      if (found.images.size) latePhotos.value = new Map([...latePhotos.value, ...found.images]);
      photoDone.value = new Set([...photoDone.value, ...photos]);
      if (found.names.size) lateNames.value = new Map([...lateNames.value, ...found.names]);
      names = names.filter((k) => !found.names.has(k));
    }
    if (names.length) {
      const found = await resolveNames(names, ctrl?.signal);
      if (ctrl !== lazyCtrl) return;
      if (found.size) lateNames.value = new Map([...lateNames.value, ...found]);
      const missed = names.filter((k) => !found.has(k));
      if (missed.length) noName.value = new Set([...noName.value, ...missed]);
    }
  },
  { immediate: true },
);
const maxRecords = computed(() => Math.max(1, ...props.rows.map((r) => r.records)));

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
  minRecords.value = 0;
  hideSeen.value = false;
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
  lazyCtrl?.abort();
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
watch([query, groupsOn, minRecords, hideSeen, sortKey, sortDesc], () => {
  limit.value = PAGE;
  scroller.value?.scrollTo({ top: 0 });
});

function toggleRowSeen(r: SpeciesRow) {
  toggleSeen({ key: r.key, scientificName: sciName(r), ...(r.commonName && { commonName: r.commonName }) });
}
</script>

<template>
  <div class="species-table space-y-2">
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
            class="w-full rounded-md border border-border bg-surface-2 py-1.5 pl-8 pr-2 text-sm placeholder:text-subtle focus:border-accent focus:outline-none"
          />
        </span>
      </label>
      <button
        ref="filterBtn"
        type="button"
        class="flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-sm transition-colors duration-200"
        :class="activeFilters ? 'border-accent bg-accent-soft' : 'border-border hover:border-border-strong'"
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
        v-if="filterOpen"
        :id="`${id}-filters`"
        ref="popover"
        role="dialog"
        aria-label="Filter species"
        class="absolute right-0 top-full z-20 mt-1 w-64 space-y-3 rounded-lg border border-border-strong bg-surface-3 p-3 text-sm shadow-panel"
      >
        <fieldset v-if="groupOptions.length > 1">
          <legend class="mb-1 text-xs text-subtle">Groups</legend>
          <div class="max-h-48 space-y-0.5 overflow-y-auto">
            <label v-for="g in groupOptions" :key="g.key" class="flex cursor-pointer items-center gap-2 py-0.5">
              <input v-model="groupsOn" type="checkbox" :value="g.key" class="accent-[var(--accent)]" />
              <span class="min-w-0 flex-1 truncate">{{ g.common ?? g.name }}</span>
              <span class="text-xs tabular-nums text-subtle">{{ g.species }}</span>
            </label>
          </div>
        </fieldset>
        <fieldset>
          <legend class="mb-1 text-xs text-subtle">Records</legend>
          <div class="flex rounded-md border border-border p-0.5">
            <label
              v-for="m in MIN_RECORDS"
              :key="m"
              class="flex-1 cursor-pointer rounded-sm py-0.5 text-center text-xs text-muted has-[:checked]:bg-accent has-[:checked]:text-accent-contrast has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[var(--focus)]"
            >
              <input v-model="minRecords" type="radio" :name="`${id}-min`" :value="m" class="sr-only" />
              {{ m ? `${m}+` : 'Any' }}
            </label>
          </div>
        </fieldset>
        <label v-if="checklist" class="flex cursor-pointer items-center gap-2">
          <input v-model="hideSeen" type="checkbox" class="accent-[var(--accent)]" />
          Hide species I’ve seen
        </label>
        <div class="flex justify-between border-t border-border pt-2 text-xs">
          <button type="button" class="text-muted underline hover:text-text" @click="resetFilters">Reset</button>
          <button type="button" class="font-medium" @click="closeFilter(true)">Done</button>
        </div>
      </div>
    </div>

    <div v-if="loading && !rows.length" class="space-y-1.5" role="status" aria-label="Loading species">
      <SkeletonBlock v-for="i in 6" :key="i" height="2.25rem" />
    </div>

    <template v-else-if="rows.length">
      <p class="text-xs text-subtle" aria-live="polite">
        <template v-if="filtered.length === rows.length">{{ rows.length }} species</template>
        <template v-else>{{ filtered.length }} of {{ rows.length }} species</template>
        <template v-if="note"> · {{ note }}</template>
      </p>

      <!-- Scrolls on its own so whatever follows (e.g. the seasonality chart) stays close. -->
      <div
        v-if="filtered.length"
        ref="scroller"
        class="max-h-[min(22rem,45dvh)] overflow-y-auto overscroll-contain"
        tabindex="0"
        aria-label="Species results"
        role="region"
      >
        <table class="w-full table-fixed text-sm">
          <thead class="text-xs text-subtle">
            <tr>
              <th class="th py-1.5 text-left font-normal" :aria-sort="ariaSort('name')">
                <button type="button" class="sort" :class="{ on: sortKey === 'name' }" @click="sortBy('name')">
                  Species<span aria-hidden="true">{{ sortKey === 'name' ? (sortDesc ? ' ▼' : ' ▲') : ' ↕' }}</span>
                </button>
              </th>
              <th class="th w-[5.5rem] py-1.5 text-left font-normal" :aria-sort="ariaSort('group')">
                <button type="button" class="sort" :class="{ on: sortKey === 'group' }" @click="sortBy('group')">
                  Group<span aria-hidden="true">{{ sortKey === 'group' ? (sortDesc ? ' ▼' : ' ▲') : ' ↕' }}</span>
                </button>
              </th>
              <th class="th w-[5rem] py-1.5 text-right font-normal" :aria-sort="ariaSort('records')">
                <button type="button" class="sort" :class="{ on: sortKey === 'records' }" @click="sortBy('records')">
                  Records<span aria-hidden="true">{{ sortKey === 'records' ? (sortDesc ? ' ▼' : ' ▲') : ' ↕' }}</span>
                </button>
              </th>
              <th v-if="checklist" class="th w-9 py-1.5 text-right font-normal">Seen</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="r in visible"
              :key="r.key"
              :data-key="r.key"
              class="border-b border-border"
              :class="{ 'bg-accent-soft': selected?.includes(r.key) }"
            >
              <td class="py-1.5 pr-2">
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
                    <span v-if="r.commonName" class="sci-name block truncate text-xs text-muted">{{
                      r.scientificName
                    }}</span>
                  </span>
                </a>
              </td>
              <td class="truncate py-1.5 pr-1 text-xs text-muted">{{ groupLabel(r.classKey) }}</td>
              <td class="py-1.5 text-right tabular-nums">
                <span class="flex items-center justify-end gap-1.5">
                  <span class="h-1 w-6 overflow-hidden rounded-full bg-surface-3" aria-hidden="true">
                    <span
                      class="block h-full rounded-full bg-accent"
                      :style="{ width: `${Math.max(4, (r.records / maxRecords) * 100)}%` }"
                    ></span>
                  </span>
                  {{ compact(r.records) }}
                </span>
              </td>
              <td v-if="checklist" class="py-1.5 text-right">
                <input
                  type="checkbox"
                  class="accent-[var(--accent)]"
                  :checked="!!seen[String(r.key)]"
                  :aria-label="`Seen ${displayName(r)}`"
                  @change="toggleRowSeen(r)"
                />
              </td>
            </tr>
          </tbody>
        </table>
        <button
          v-if="sorted.length > limit"
          type="button"
          class="mt-2 w-full rounded-md border border-border py-1.5 text-xs text-muted hover:border-accent"
          @click="limit += PAGE"
        >
          Show {{ Math.min(PAGE, sorted.length - limit) }} more
        </button>
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
.th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--surface);
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
