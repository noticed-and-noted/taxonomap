<script setup lang="ts">
/**
 * Individual records in the selected cell, a page at a time in GBIF's order,
 * each badged with its record type (fossil, preserved specimen…). A species
 * search (ARIA 1.2 combobox over the cell's species table) narrows the list.
 */
import { useStore } from '@nanostores/vue';
import { computed, nextTick, ref, shallowRef, useId, watch } from 'vue';
import { BASIS_LABELS, full } from '~/lib/format';
import { searchOccurrences, usableImages, type Occurrence } from '~/lib/gbif';
import type { SpeciesRow } from '~/lib/species/groups';
import { $hexGeometry, $occurrenceFilter } from '~/stores/explorer';
import ThumbImage from './ThumbImage.vue';
import { useLatestLoad } from './useLatestLoad';
import { useScrollFade } from './useScrollFade';

const PAGE = 20;
const MAX_OPTIONS = 8;

const props = defineProps<{ species: readonly SpeciesRow[] }>();

const geometry = useStore($hexGeometry);
const filter = useStore($occurrenceFilter);
const { loading, error, run } = useLatestLoad();

/** Chosen speciesKey, or '' for all species. */
const speciesKey = ref<number | ''>('');
const records = shallowRef<Occurrence[]>([]);
const total = ref<number | null>(null);
const scroller = ref<HTMLElement>();
const { fadeTop, fadeBottom, update: updateFade } = useScrollFade(scroller);
watch(records, () => void nextTick(updateFade));

const uid = useId();
const query = ref('');
const open = ref(false);
const active = ref(-1);
const label = (s: SpeciesRow) => s.commonName ?? s.scientificName;
const options = computed(() => {
  const q = query.value.trim().toLowerCase();
  return [...props.species]
    .filter((s) => !q || label(s).toLowerCase().includes(q) || s.scientificName.toLowerCase().includes(q))
    .sort((a, b) => b.records - a.records)
    .slice(0, MAX_OPTIONS);
});
const activeId = computed(() => (active.value >= 0 ? `${uid}-opt-${active.value}` : undefined));

function pick(s: SpeciesRow | undefined) {
  speciesKey.value = s?.key ?? '';
  query.value = s ? label(s) : '';
  open.value = false;
  active.value = -1;
}

function onInput() {
  open.value = true;
  active.value = -1;
  // Emptying the box goes back to all species.
  if (!query.value.trim() && speciesKey.value !== '') speciesKey.value = '';
}

function onKey(e: KeyboardEvent) {
  const n = options.value.length;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    open.value = true;
    if (n) active.value = (active.value + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
  } else if (e.key === 'Enter' && open.value) {
    const s = options.value[active.value] ?? (n === 1 ? options.value[0] : undefined);
    if (s) {
      e.preventDefault();
      pick(s);
    }
  } else if (e.key === 'Escape' && open.value) {
    e.stopPropagation();
    open.value = false;
  }
}

async function load(more = false) {
  const g = geometry.value;
  if (!more) records.value = [];
  if (!g) return;
  await run(async (signal) => {
    const f = { ...filter.value, geometry: g.wkt, ...(speciesKey.value !== '' && { speciesKeys: [speciesKey.value] }) };
    const r = await searchOccurrences(f, { limit: PAGE, offset: more ? records.value.length : 0 }, signal);
    if (signal.aborted) return;
    records.value = more ? [...records.value, ...r.results] : r.results;
    total.value = r.count;
  });
}

// Another cell or filter: the picked species may not be there any more.
watch(
  [geometry, () => JSON.stringify(filter.value)],
  () => {
    query.value = '';
    if (speciesKey.value === '') void load();
    else speciesKey.value = ''; // the watch below reloads
  },
  { immediate: true },
);
watch(speciesKey, () => void load());

const name = (o: Occurrence) => o.vernacularName ?? o.species ?? o.scientificName ?? 'Unnamed record';
const source = (o: Occurrence) =>
  o.recordedBy ?? ([o.institutionCode, o.catalogNumber].filter(Boolean).join(' ') || o.datasetName || o.publisher);
const date = (o: Occurrence) => o.eventDate?.slice(0, 10) ?? (o.year ? String(o.year) : undefined);
const image = (o: Occurrence) => usableImages(o)[0];
</script>

<template>
  <div class="space-y-2">
    <div class="relative text-sm">
      <label :for="`${uid}-input`" class="sr-only">Filter records by species</label>
      <input
        :id="`${uid}-input`"
        v-model="query"
        type="search"
        class="picker-input"
        role="combobox"
        autocomplete="off"
        placeholder="All species — search to filter"
        :aria-expanded="open && options.length > 0"
        :aria-controls="`${uid}-list`"
        aria-autocomplete="list"
        :aria-activedescendant="activeId"
        @focus="open = true"
        @blur="open = false"
        @input="onInput"
        @keydown="onKey"
      />
      <ul
        v-show="open && options.length"
        :id="`${uid}-list`"
        role="listbox"
        class="options absolute inset-x-0 z-10 shadow"
        aria-label="Species in this cell"
      >
        <li
          v-for="(s, i) in options"
          :id="`${uid}-opt-${i}`"
          :key="s.key"
          role="option"
          class="option"
          :class="{ active: i === active }"
          :aria-selected="s.key === speciesKey"
          @mousedown.prevent="pick(s)"
        >
          <span class="min-w-0 truncate" :class="{ 'sci-name': !s.commonName }">{{ label(s) }}</span>
          <span class="shrink-0 text-[11px] text-subtle tabular-nums">{{ full(s.records) }}</span>
        </li>
      </ul>
    </div>

    <div v-if="error" class="rounded-md bg-surface-2 p-3 text-sm text-muted" role="alert">
      Records could not be loaded.
      <button type="button" class="ml-1 text-text underline" @click="load()">Try again</button>
    </div>

    <p v-else-if="!loading && !records.length" class="text-sm text-muted">No records to show.</p>

    <div
      ref="scroller"
      class="fade-list max-h-[min(22rem,45dvh)] overflow-y-auto overscroll-contain"
      :class="{ 'fade-top': fadeTop, 'fade-bottom': fadeBottom }"
      @scroll.passive="updateFade"
    >
      <ul class="space-y-2" aria-label="Records">
        <li v-for="o in records" :key="o.key">
          <a
            :href="`https://www.gbif.org/occurrence/${o.key}`"
            target="_blank"
            rel="noopener"
            class="record flex gap-3 rounded-md border border-border p-2 hover:bg-surface-2"
            :data-type="o.basisOfRecord"
          >
            <div class="size-14 shrink-0 overflow-hidden rounded bg-surface-2">
              <ThumbImage v-if="image(o)" :image="image(o)!" size="200x" class="size-full object-cover" />
            </div>
            <div class="min-w-0 text-sm">
              <span
                v-if="o.basisOfRecord"
                class="record-type inline-block rounded-sm bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium"
                >{{ BASIS_LABELS[o.basisOfRecord] ?? o.basisOfRecord }}</span
              >
              <p class="truncate" :class="{ 'sci-name': !o.vernacularName }">{{ name(o) }}</p>
              <p class="truncate text-xs text-muted">
                {{ [date(o), source(o)].filter(Boolean).join(' · ') }}
              </p>
            </div>
          </a>
        </li>
      </ul>

      <p v-if="loading" class="mt-2 text-xs text-subtle" role="status">Loading records…</p>
      <button
        v-else-if="total !== null && records.length < total"
        type="button"
        class="mt-2 w-full rounded-md border border-border py-1 text-sm hover:bg-surface-2"
        @click="load(true)"
      >
        Show more ({{ full(records.length) }} of {{ full(total) }})
      </button>
    </div>
  </div>
</template>

<style scoped>
/* Record type stripe: ≥3:1 on --surface in each theme (non-text contrast). */
.record {
  --type: var(--border-strong);
  border-left: 3px solid var(--type);
}
.record[data-type='HUMAN_OBSERVATION'] {
  --type: #5dcaa5;
}
.record[data-type='FOSSIL_SPECIMEN'] {
  --type: #f0997b;
}
.record[data-type='PRESERVED_SPECIMEN'],
.record[data-type='LIVING_SPECIMEN'] {
  --type: #afa9ec;
}
.record[data-type='MACHINE_OBSERVATION'] {
  --type: #b4b2a9;
}
.record[data-type='MATERIAL_SAMPLE'],
.record[data-type='MATERIAL_CITATION'] {
  --type: #85b7eb;
}
:root[data-theme='light'] .record[data-type='HUMAN_OBSERVATION'] {
  --type: #0f6e56;
}
:root[data-theme='light'] .record[data-type='FOSSIL_SPECIMEN'] {
  --type: #993c1d;
}
:root[data-theme='light'] .record[data-type='PRESERVED_SPECIMEN'],
:root[data-theme='light'] .record[data-type='LIVING_SPECIMEN'] {
  --type: #534ab7;
}
:root[data-theme='light'] .record[data-type='MACHINE_OBSERVATION'] {
  --type: #5f5e5a;
}
:root[data-theme='light'] .record[data-type='MATERIAL_SAMPLE'],
:root[data-theme='light'] .record[data-type='MATERIAL_CITATION'] {
  --type: #185fa5;
}
.record-type {
  color: var(--type);
}

.picker-input {
  width: 100%;
  height: 2rem;
  padding: 0 0.625rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
}
.options {
  margin-top: 0.25rem;
  padding: 0.25rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--surface);
}
.option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.375rem 0.5rem;
  border-radius: var(--radius-sm);
  cursor: pointer;
}
.option.active,
.option:hover {
  background: var(--surface-2);
}
</style>
