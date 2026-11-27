<script setup lang="ts">
/**
 * Spread's "First record in each country": each country's first year in Analyse's range, oldest first, with GBIF's
 * checklists marking where the species was introduced or is invasive. Countries not reached by the year shown are
 * dimmed.
 */
import { computed, ref, watch } from 'vue';
import SkeletonBlock from '~/components/atoms/SkeletonBlock.vue';
import { useLatestLoad } from '~/composables/useLatestLoad';
import { loadCountryFirstYears } from '~/lib/analyse/spread';
import { countryName } from '~/lib/format';
import { getDistributions, type OccurrenceFilter } from '~/lib/gbif';
import { summariseDistributions, type DistributionSummary } from '~/lib/species/distribution';

const props = defineProps<{
  filter: OccurrenceFilter;
  speciesKey: number;
  range: readonly [number, number];
  year: number;
}>();

/** Countries listed before "Show all". */
const SHORT_LIST = 12;

const firstYears = ref(new Map<string, number>());
const summary = ref<DistributionSummary | null>(null);
const isShowingAll = ref(false);
const { loading, error, run } = useLatestLoad();

watch(
  () => JSON.stringify([props.filter, props.range]),
  () =>
    void run(async (signal) => {
      firstYears.value = new Map();
      const found = await loadCountryFirstYears(props.filter, props.range, signal);
      if (!signal.aborted) firstYears.value = found;
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

/** How GBIF's checklists list the species in a country, if at all. */
function statusOf(code: string): 'invasive' | 'introduced' | undefined {
  if (summary.value?.invasive.includes(code)) return 'invasive';
  return summary.value?.introduced.includes(code) ? 'introduced' : undefined;
}

const countries = computed(() =>
  [...firstYears.value]
    .map(([code, firstYear]) => ({ code, name: countryName(code), firstYear, status: statusOf(code) }))
    .sort((left, right) => left.firstYear - right.firstYear || left.name.localeCompare(right.name)),
);
const shown = computed(() => (isShowingAll.value ? countries.value : countries.value.slice(0, SHORT_LIST)));

/** When a country was first recorded, as the list shows it. */
function whenText(firstYear: number): string {
  if (firstYear < props.range[0]) return `Before ${props.range[0]}`;
  return firstYear <= props.year ? String(firstYear) : 'Not yet';
}

const DOT_COLOURS = { invasive: 'var(--range-invasive)', introduced: 'var(--range-introduced)' } as const;
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

    <h3 class="text-xs font-medium text-muted">First record in each country</h3>
    <p v-if="error && !countries.length" class="text-xs text-muted">Countries are unavailable right now.</p>
    <SkeletonBlock v-else-if="loading && !countries.length" height="6rem" label="Loading countries" />
    <p v-else-if="!countries.length" class="text-xs text-muted">No country has two records in these years.</p>
    <template v-else>
      <ul class="text-sm">
        <li
          v-for="country in shown"
          :key="country.code"
          class="flex items-center gap-2 border-b border-border py-1.5"
          :class="{ 'text-subtle': country.firstYear > year }"
        >
          <span
            class="size-2 rounded-full"
            :class="{ 'border border-border-strong': !country.status }"
            :style="country.status ? { background: DOT_COLOURS[country.status] } : undefined"
            aria-hidden="true"
          />
          <span class="flex-1">
            {{ country.name }}
            <span v-if="country.status" class="sr-only">({{ country.status }})</span>
          </span>
          <span class="text-[0.8125rem] tabular-nums">{{ whenText(country.firstYear) }}</span>
        </li>
      </ul>
      <button
        v-if="countries.length > SHORT_LIST"
        type="button"
        class="self-start text-xs text-muted underline hover:text-text"
        @click="isShowingAll = !isShowingAll"
      >
        {{ isShowingAll ? 'Show fewer' : `Show all ${countries.length}` }}
      </button>
    </template>
  </section>
</template>
