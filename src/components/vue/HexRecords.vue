<script setup lang="ts">
/**
 * Individual records in the selected cell, a page at a time in GBIF's order,
 * as a table with a short record type code (FOS, SPE…; the full type on hover).
 * A row expands to its photo and details. No column sorts: GBIF's occurrence
 * search has no sort parameter. A species search (ARIA 1.2 combobox over the cell's species table) narrows the list.
 */
import { useStore } from '@nanostores/vue';
import { computed, nextTick, ref, shallowRef, useId, watch } from 'vue';
import { BASIS_LABELS, full } from '~/lib/format';
import { searchOccurrences, usableImages, type Occurrence } from '~/lib/gbif';
import LicenceBadge from './LicenceBadge.vue';
import { commonNames as lookupCommonNames, type SpeciesRow } from '~/lib/species/groups';
import { $hexGeometry, $occurrenceFilter } from '~/stores/explorer';
import ThumbImage from './ThumbImage.vue';
import { useLatestLoad } from './useLatestLoad';
import { useScrollFade } from './useScrollFade';

const PAGE = 20;
const MAX_OPTIONS = 8;

const TYPE_CODES: Record<string, string> = {
  HUMAN_OBSERVATION: 'OBS',
  MACHINE_OBSERVATION: 'MAC',
  PRESERVED_SPECIMEN: 'SPE',
  LIVING_SPECIMEN: 'LIV',
  FOSSIL_SPECIMEN: 'FOS',
  MATERIAL_SAMPLE: 'SAM',
  MATERIAL_CITATION: 'CIT',
  OCCURRENCE: 'OCC',
  OBSERVATION: 'OBS',
};

const props = defineProps<{ species: readonly SpeciesRow[] }>();

const geometry = useStore($hexGeometry);
const filter = useStore($occurrenceFilter);
const { loading, error, run } = useLatestLoad();

/** Chosen speciesKey, or '' for all species. */
const speciesKey = ref<number | ''>('');
const records = shallowRef<Occurrence[]>([]);
/** Expanded row's occurrence key. */
const expanded = ref<number | null>(null);
const total = ref<number | null>(null);
const scroller = ref<HTMLElement>();
const { fadeBottom, update: updateFade } = useScrollFade(scroller);
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

// Records rarely carry a common name: take the cell's species table's, else look it up (see load).
const commonNames = computed(
  () => new Map(props.species.filter((s) => s.commonName).map((s) => [s.key, s.commonName!])),
);
const lateNames = shallowRef(new Map<number, string>());
const common = (o: Occurrence) =>
  o.vernacularName ??
  (o.speciesKey ? (commonNames.value.get(o.speciesKey) ?? lateNames.value.get(o.speciesKey)) : undefined);
const sci = (o: Occurrence) => o.species ?? o.scientificName;
const name = (o: Occurrence) => common(o) ?? sci(o) ?? 'Unnamed record';

/** Names for a page's species the table hasn't named (cached, as on species pages); rows show meanwhile. */
async function nameSpecies(page: readonly Occurrence[], signal: AbortSignal) {
  const missing = [...new Set(page.map((o) => o.speciesKey))].filter(
    (k): k is number => k !== undefined && !commonNames.value.has(k) && !lateNames.value.has(k),
  );
  if (!missing.length) return;
  const found = await lookupCommonNames(missing, signal);
  if (!signal.aborted && found.size) lateNames.value = new Map([...lateNames.value, ...found]);
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
    if (!more) expanded.value = null;
    void nameSpecies(r.results, signal);
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

const date = (o: Occurrence) => o.eventDate?.slice(0, 10) ?? (o.year ? String(o.year) : undefined);
const typeLabel = (o: Occurrence) =>
  (o.basisOfRecord && (BASIS_LABELS[o.basisOfRecord] ?? o.basisOfRecord)) || 'Unknown';
const image = (o: Occurrence) => usableImages(o)[0];
const broken = ref(new Set<number>());
const initials = (o: Occurrence) =>
  name(o)
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');

const toggle = (o: Occurrence) => (expanded.value = expanded.value === o.key ? null : o.key);

const institution = (o: Occurrence) => [o.institutionCode, o.catalogNumber].filter(Boolean).join(' ');
</script>

<template>
  <div class="space-y-2">
    <div class="relative text-sm">
      <label :for="`${uid}-input`" class="sr-only">Filter records by species</label>
      <svg
        class="pointer-events-none absolute left-2.5 top-[1.0625rem] size-3.5 -translate-y-1/2 text-subtle"
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
        :id="`${uid}-input`"
        v-model="query"
        type="search"
        class="w-full rounded-md border border-border bg-surface-2 py-1.5 pl-8 pr-2 text-sm placeholder:text-subtle focus:border-accent focus:outline-none"
        role="combobox"
        autocomplete="off"
        placeholder="Filter by species"
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
    <p v-else-if="total !== null" class="text-xs text-subtle" aria-live="polite">
      {{ full(records.length) }} of {{ full(total) }} record{{ total === 1 ? '' : 's' }}
    </p>

    <!-- Column headers sit above the scroll box; colgroups and a stable scrollbar gutter keep the columns aligned. -->
    <div>
      <div v-if="records.length" class="head-row -mx-4 text-xs text-subtle" aria-hidden="true">
        <table class="w-full table-fixed text-sm">
          <colgroup>
            <col class="w-14" />
            <col />
            <col class="w-[3.25rem]" />
            <col class="w-[6.5rem]" />
          </colgroup>
          <tbody>
            <tr>
              <td colspan="2" class="py-1.5 pl-4">Species</td>
              <td class="py-1.5">Type</td>
              <td class="py-1.5 pr-4">Date</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div
        ref="scroller"
        class="fade-list -mx-4 max-h-[min(23rem,65dvh)] overflow-y-auto overscroll-contain [scrollbar-gutter:stable]"
        :class="{ 'fade-bottom': fadeBottom }"
        @scroll.passive="updateFade"
      >
        <table v-if="records.length" class="w-full table-fixed text-sm" aria-label="Records">
          <colgroup>
            <col class="w-14" />
            <col />
            <col class="w-[3.25rem]" />
            <col class="w-[6.5rem]" />
          </colgroup>
          <thead class="sr-only">
            <tr>
              <th scope="col">Photo</th>
              <th scope="col">Species</th>
              <th scope="col">Type</th>
              <th scope="col">Date</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="o in records" :key="o.key">
              <tr
                class="record cursor-pointer border-b border-border hover:bg-surface-2"
                :data-type="o.basisOfRecord"
                @click="toggle(o)"
              >
                <td class="py-1.5 pl-4 pr-2">
                  <span class="block size-8 overflow-hidden rounded bg-photo">
                    <ThumbImage
                      v-if="image(o) && !broken.has(o.key)"
                      :image="image(o)!"
                      size="200x"
                      class="size-full object-cover"
                      @broken="broken = new Set(broken).add(o.key)"
                    />
                    <span v-else class="grid size-full place-items-center font-display text-xs text-subtle">
                      {{ initials(o) }}
                    </span>
                  </span>
                </td>
                <td class="py-1.5 pr-2">
                  <button
                    type="button"
                    class="block w-full min-w-0 cursor-pointer text-left"
                    :aria-expanded="expanded === o.key"
                    :aria-controls="`${uid}-rec-${o.key}`"
                    @click.stop="toggle(o)"
                  >
                    <span class="block truncate" :class="{ 'sci-name': !common(o) }">{{ name(o) }}</span>
                    <span v-if="common(o) && sci(o)" class="sci-name block truncate text-xs text-muted">{{
                      sci(o)
                    }}</span>
                  </button>
                </td>
                <td class="py-1.5">
                  <span class="type-code" tabindex="0" :data-tip="typeLabel(o)" :aria-label="typeLabel(o)">{{
                    TYPE_CODES[o.basisOfRecord ?? ''] ?? '—'
                  }}</span>
                </td>
                <td class="truncate py-1.5 pr-4 text-xs tabular-nums">{{ date(o) ?? '—' }}</td>
              </tr>
              <tr v-if="expanded === o.key" :id="`${uid}-rec-${o.key}`" class="border-b border-border">
                <td colspan="4" class="bg-surface-2 px-4 py-3">
                  <div class="grid grid-cols-2 items-start gap-3">
                    <div class="relative aspect-square overflow-hidden rounded bg-photo">
                      <template v-if="image(o) && !broken.has(o.key)">
                        <!-- The row's 200x thumbnail is already cached: show it at once, and fade the sharper 400x in over it. -->
                        <ThumbImage :image="image(o)!" size="200x" class="absolute inset-0 size-full object-cover" />
                        <ThumbImage :image="image(o)!" size="400x" class="relative size-full object-cover" />
                        <LicenceBadge
                          class="absolute bottom-1 left-1 max-w-[calc(100%-0.5rem)]"
                          :licence="image(o)!.licence"
                          :creator="image(o)!.creator"
                          :rights-holder="image(o)!.rightsHolder"
                        />
                      </template>
                      <span v-else class="grid size-full place-items-center font-display text-xl text-subtle">
                        {{ initials(o) }}
                      </span>
                    </div>
                    <dl class="min-w-0 space-y-1 text-xs [overflow-wrap:anywhere]">
                      <div v-if="o.recordedBy">
                        <dt class="text-subtle">Recorded by</dt>
                        <dd>{{ o.recordedBy }}</dd>
                      </div>
                      <div v-if="institution(o)">
                        <dt class="text-subtle">Institution</dt>
                        <dd>{{ institution(o) }}</dd>
                      </div>
                      <div v-if="o.datasetName ?? o.publisher">
                        <dt class="text-subtle">Source</dt>
                        <dd>{{ o.datasetName ?? o.publisher }}</dd>
                      </div>
                      <dd>
                        <a
                          :href="`https://www.gbif.org/occurrence/${o.key}`"
                          target="_blank"
                          rel="noopener"
                          class="underline"
                          >View on GBIF</a
                        >
                      </dd>
                    </dl>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>

        <p v-if="loading" class="mx-4 mt-2 text-xs text-subtle" role="status">Loading records…</p>
        <button
          v-else-if="total !== null && records.length < total"
          type="button"
          class="mx-4 mt-2 w-[calc(100%-2rem)] rounded-md border border-border py-1 text-sm hover:bg-surface-2"
          @click="load(true)"
        >
          Show more ({{ full(records.length) }} of {{ full(total) }})
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Type colours: ≥4.5:1 on the code's tint in each theme. */
.record {
  --type: var(--text-muted);
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
.type-code {
  position: relative;
  display: inline-block;
  padding: 0.0625rem 0.25rem;
  border-radius: var(--radius-sm);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.02em;
  color: var(--type);
  background: color-mix(in srgb, var(--type) 16%, transparent);
}
/* Tooltip to the left, so the scroll box never clips it above or below. */
.type-code::after {
  content: attr(data-tip);
  position: absolute;
  right: calc(100% + 0.375rem);
  top: 50%;
  translate: 0 -50%;
  z-index: 2;
  padding: 0.125rem 0.375rem;
  border-radius: var(--radius-sm);
  background: var(--text);
  color: var(--bg);
  font-weight: 400;
  letter-spacing: 0;
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  transition: opacity 120ms;
}
.type-code:hover::after,
.type-code:focus-visible::after {
  opacity: 1;
}
.head-row {
  overflow-y: hidden;
  scrollbar-gutter: stable;
  box-shadow: inset 0 -1px 0 var(--border-strong);
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
