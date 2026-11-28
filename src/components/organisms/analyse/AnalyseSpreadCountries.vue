<script setup lang="ts">
/**
 * Spread's country table: every country with records of the species, over all years whatever
 * Analyse's range, with its first year and its records, sortable by each, under a count of the countries GBIF's
 * checklists list it as introduced or invasive in. Picking a country moves the map to its records there.
 */
import { computed, nextTick, ref, watch } from 'vue';
import SkeletonBlock from '~/components/atoms/SkeletonBlock.vue';
import UiIcon from '~/components/atoms/UiIcon.vue';
import { useLatestLoad } from '~/composables/useLatestLoad';
import { useScrollFade } from '~/composables/useScrollFade';
import { loadCountryRecords, type CountryRecords } from '~/lib/analyse/spread';
import { SIDE_PANEL_QUERY } from '~/lib/breakpoints';
import { compact, countryName, full } from '~/lib/format';
import { getDistributions, type OccurrenceFilter } from '~/lib/gbif';
import { summariseDistributions, type DistributionSummary } from '~/lib/species/distribution';
import { flyToRecords } from '~/stores/fly-to-taxa';
import { $analysePanelOpen } from '~/stores/mode';

const props = defineProps<{ filter: OccurrenceFilter; speciesKey: number }>();

type SortKey = 'name' | 'firstYear' | 'count';

/** Countries listed before "Load all". */
const SHORT_LIST = 12;

const COLUMNS: { key: SortKey; label: string; align: 'left' | 'right' }[] = [
  { key: 'name', label: 'Country', align: 'left' },
  { key: 'firstYear', label: 'First record', align: 'right' },
  { key: 'count', label: 'Records', align: 'right' },
];

const DOT_COLOURS = { invasive: 'var(--range-invasive)', introduced: 'var(--range-introduced)' } as const;

const records = ref<CountryRecords[]>([]);
const summary = ref<DistributionSummary | null>(null);
const isShowingAll = ref(false);
const scroller = ref<HTMLElement>();
// Only the bottom fades: the header stays put at the top, and a fade there would cover it.
const { fadeBottom, update: updateFades } = useScrollFade(scroller);
const sortKey = ref<SortKey>('firstYear');
const isDescending = ref(false);
const { loading, error, run } = useLatestLoad();

watch(
  // Every year counts here, so Analyse's range doesn't reload the list.
  () => {
    const { year: _years, ...rest } = props.filter;
    return JSON.stringify(rest);
  },
  () =>
    void run(async (signal) => {
      records.value = [];
      const found = await loadCountryRecords(props.filter, signal);
      if (!signal.aborted) records.value = found;
    }),
  { immediate: true },
);

watch(
  () => props.speciesKey,
  async (key) => {
    summary.value = null;
    // Without the checklists the list still works, just without introduced and invasive marks.
    const page = await getDistributions(key).catch(() => undefined);
    if (page && key === props.speciesKey) summary.value = summariseDistributions(page.results);
  },
  { immediate: true },
);

const countries = computed(() => {
  const rows = records.value.map((row) => ({ ...row, name: countryName(row.code) }));
  const direction = isDescending.value ? -1 : 1;
  const byName = (left: (typeof rows)[number], right: (typeof rows)[number]) => left.name.localeCompare(right.name);
  // Countries with no dated record sort after the rest either way.
  const yearOf = (row: (typeof rows)[number]) => row.firstYear ?? (isDescending.value ? -Infinity : Infinity);
  const compare: Record<SortKey, (left: (typeof rows)[number], right: (typeof rows)[number]) => number> = {
    name: (left, right) => direction * byName(left, right),
    firstYear: (left, right) => direction * (yearOf(left) - yearOf(right)) || byName(left, right),
    count: (left, right) => direction * (left.count - right.count) || byName(left, right),
  };
  return rows.sort(compare[sortKey.value]);
});
const shown = computed(() => (isShowingAll.value ? countries.value : countries.value.slice(0, SHORT_LIST)));
watch(shown, () => nextTick(updateFades));

/** Sorts by a column, or turns the order round when it already is; records start with the most. */
function sortBy(key: SortKey) {
  if (sortKey.value === key) isDescending.value = !isDescending.value;
  else {
    sortKey.value = key;
    isDescending.value = key === 'count';
  }
}
const ariaSort = (key: SortKey) =>
  sortKey.value === key ? (isDescending.value ? 'descending' : 'ascending') : ('none' as const);
const sortIcon = (key: SortKey) => (sortKey.value === key ? (isDescending.value ? 'sort-desc' : 'sort-asc') : 'sort');

/** Moves the map to the species' records in a country; on phones the sheet goes so the map shows. */
function showCountry(code: string) {
  const { year: _years, ...allYears } = props.filter;
  void flyToRecords({ ...allYears, country: code });
  if (!window.matchMedia(SIDE_PANEL_QUERY).matches) $analysePanelOpen.set(false);
}
</script>

<template>
  <section class="flex flex-col gap-2">
    <div v-if="summary" class="flex flex-wrap gap-1.5 text-xs">
      <span
        v-if="summary.introduced.length"
        class="flex items-center gap-1.5 rounded-sm border border-border px-2 py-1"
      >
        <span class="size-2 rounded-full" :style="{ background: DOT_COLOURS.introduced }" aria-hidden="true" />
        Introduced in {{ summary.introduced.length }} {{ summary.introduced.length === 1 ? 'country' : 'countries' }}
      </span>
      <span v-if="summary.invasive.length" class="flex items-center gap-1.5 rounded-sm border border-border px-2 py-1">
        <span class="size-2 rounded-full" :style="{ background: DOT_COLOURS.invasive }" aria-hidden="true" />
        Invasive in {{ summary.invasive.length }} {{ summary.invasive.length === 1 ? 'country' : 'countries' }}
      </span>
    </div>
    <p v-if="error && !countries.length" class="text-xs text-muted">Countries are unavailable right now.</p>
    <SkeletonBlock v-else-if="loading && !countries.length" height="6rem" label="Loading countries" />
    <p v-else-if="!countries.length" class="text-xs text-muted">No records in any country.</p>
    <template v-else>
      <!-- Scrolls on its own, under a header that stays put, so a long list doesn't push the panel on. -->
      <div
        ref="scroller"
        class="fade-list max-h-80 overflow-y-auto overscroll-contain"
        :class="{ 'fade-bottom': fadeBottom }"
        @scroll.passive="updateFades"
      >
        <table class="w-full table-fixed text-sm" aria-label="First record in each country">
          <colgroup>
            <col />
            <col class="w-24" />
            <col class="w-20" />
          </colgroup>
          <thead class="sticky top-0 z-[1] bg-surface text-xs text-subtle">
            <tr>
              <th
                v-for="column in COLUMNS"
                :key="column.key"
                class="header-cell py-1.5 font-normal"
                :class="column.align === 'left' ? 'text-left' : 'text-right'"
                :aria-sort="ariaSort(column.key)"
              >
                <button
                  type="button"
                  class="sort inline-flex items-center"
                  :class="{ on: sortKey === column.key }"
                  @click="sortBy(column.key)"
                >
                  {{ column.label }}<UiIcon :name="sortIcon(column.key)" class="ml-0.5" />
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="country in shown" :key="country.code" class="border-b border-border">
              <td class="py-1.5">
                <button
                  type="button"
                  class="country flex w-full min-w-0 items-center text-left"
                  :aria-label="`Show ${country.name} on the map`"
                  @click="showCountry(country.code)"
                >
                  <span class="truncate">{{ country.name }}</span>
                </button>
              </td>
              <td class="py-1.5 text-right text-[0.8125rem] tabular-nums">{{ country.firstYear ?? '—' }}</td>
              <td class="py-1.5 text-right text-[0.8125rem] tabular-nums" :title="full(country.count)">
                {{ compact(country.count) }}
              </td>
            </tr>
          </tbody>
        </table>
        <button
          v-if="!isShowingAll && countries.length > SHORT_LIST"
          type="button"
          class="load-all mt-2 w-full rounded-sm border border-border py-1.5 text-xs text-muted hover:bg-surface-2 hover:text-text"
          @click="isShowingAll = true"
        >
          Load all {{ countries.length }}
        </button>
      </div>
    </template>
  </section>
</template>

<style scoped>
/* A sticky header's row border scrolls away with the rows, so each heading draws its own line. */
.header-cell {
  box-shadow: inset 0 -1px 0 var(--border);
}
.sort {
  color: inherit;
}
.sort:hover,
.sort.on {
  color: var(--text);
}
.country:hover span {
  text-decoration: underline;
  text-decoration-color: var(--accent);
}
@media (pointer: coarse) {
  .country,
  .load-all {
    min-height: 2.75rem;
  }
}
</style>
