<script setup lang="ts">
/**
 * Migration: the species' records in each month (all of Analyse's years added together) as bars, one month picked
 * and drawn on the map, with play, back and on to step through the year. Adjusted for how many people record, the
 * bars and the map show the species' share of its group's records instead (all birds, say).
 */
import { useStore } from '@nanostores/vue';
import { computed, ref, watch } from 'vue';
import SkeletonBlock from '~/components/atoms/SkeletonBlock.vue';
import UiIcon from '~/components/atoms/UiIcon.vue';
import InfoTip from '~/components/molecules/InfoTip.vue';
import { useLatestLoad } from '~/composables/useLatestLoad';
import { usePlayback } from '~/composables/usePlayback';
import { formatShare, shareOf } from '~/lib/analyse/effort';
import { wrapStep } from '~/lib/analyse/timeline';
import { full, MONTH_NAMES } from '~/lib/format';
import { monthCounts, MONTHS_IN_YEAR, occurrenceFacets, type OccurrenceFilter } from '~/lib/gbif';
import { $analyseGroup, $analyseMonth, $migrationEffort } from '~/stores/analyse';
import { $analyseFilter } from '~/stores/map-filter';
import { $mapLoad } from '~/stores/map-messages';
import AnalyseEffortSetting from './AnalyseEffortSetting.vue';

/** The tallest bar's height in px; every bar keeps a sliver so a month with no records still shows. */
const BAR_MAX_PX = 88;
const BAR_MIN_PX = 3;

const filter = useStore($analyseFilter);
const month = useStore($analyseMonth);
const group = useStore($analyseGroup);
const effortStore = useStore($migrationEffort);
const isAdjusted = computed({
  get: () => effortStore.value && group.value !== null,
  set: (value: boolean) => $migrationEffort.set(value),
});

const counts = ref<number[]>([]);
/** The group's records each month, for the adjusted bars; empty until asked for. */
const groupCounts = ref<number[]>([]);
const { loading, error, run } = useLatestLoad();

/** Records per month for a filter, January first. */
async function countByMonth(monthFilter: OccurrenceFilter, signal: AbortSignal) {
  const result = await occurrenceFacets(monthFilter, ['month'], { facetLimit: MONTHS_IN_YEAR, signal });
  return monthCounts(result.facets['month'] ?? []);
}

watch(
  () => JSON.stringify([filter.value, isAdjusted.value && group.value?.key]),
  () => {
    const current = filter.value;
    if (!current) return;
    const groupKey = isAdjusted.value ? group.value?.key : undefined;
    void run(async (signal) => {
      const [species, everything] = await Promise.all([
        countByMonth(current, signal),
        groupKey === undefined ? [] : countByMonth({ ...current, taxonKey: groupKey }, signal),
      ]);
      if (signal.aborted) return;
      counts.value = species;
      groupCounts.value = everything;
    });
  },
  { immediate: true },
);

/** What each bar stands for: records, or the share of the group's records when adjusted. */
const values = computed(() =>
  isAdjusted.value && groupCounts.value.length
    ? counts.value.map((count, index) => shareOf(count, groupCounts.value[index] ?? 0))
    : counts.value,
);
const isShowingShares = computed(() => isAdjusted.value && groupCounts.value.length > 0);
const peak = computed(() => Math.max(Number.MIN_VALUE, ...values.value));
const bars = computed(() =>
  values.value.map((value, index) => ({
    month: index + 1,
    height: BAR_MIN_PX + Math.round((value / peak.value) * BAR_MAX_PX),
    label: `${MONTH_NAMES[index]}, ${valueText(value)}`,
  })),
);
const monthValue = computed(() => values.value[month.value - 1]);

/** A bar's value in words: its records, or its share of the group's. */
function valueText(value: number): string {
  if (isShowingShares.value) return `${formatShare(value)} of ${group.value!.name} records`;
  return `${full(value)} record${value === 1 ? '' : 's'}`;
}

const setMonth = (value: number) => $analyseMonth.set(value);
const stepMonth = (delta: number) => setMonth(wrapStep(month.value, delta, 1, MONTHS_IN_YEAR));
const { isPlaying, toggle } = usePlayback(
  () => stepMonth(1),
  () => !$mapLoad.get().loading,
);
</script>

<template>
  <div class="flex flex-col gap-4 text-sm">
    <div class="flex items-baseline justify-between">
      <span class="flex items-center gap-1">
        <span class="font-display text-2xl font-semibold" aria-live="polite">{{ MONTH_NAMES[month - 1] }}</span>
        <InfoTip label="About Migration">
          Where it was recorded in each month, with all the years above added together.
        </InfoTip>
      </span>
      <span v-if="monthValue !== undefined" class="text-muted tabular-nums" aria-live="polite">
        <template v-if="isShowingShares">
          <strong class="font-medium text-text">{{ formatShare(monthValue) }}</strong> of {{ group!.name }} records
        </template>
        <template v-else>
          <strong class="font-medium text-text">{{ full(monthValue) }}</strong> record{{ monthValue === 1 ? '' : 's' }}
        </template>
      </span>
    </div>

    <p v-if="error && !counts.length" class="grid h-28 place-items-center text-xs text-muted">
      Month counts are unavailable right now.
    </p>
    <SkeletonBlock v-else-if="loading && !counts.length" height="7rem" label="Loading records by month" />
    <div v-else :class="{ 'opacity-60': loading }">
      <div
        role="group"
        :aria-label="isShowingShares ? 'Share of records by month' : 'Records by month'"
        class="grid h-24 grid-cols-12 items-end gap-1"
      >
        <button
          v-for="bar in bars"
          :key="bar.month"
          type="button"
          class="month-bar flex h-full items-end"
          :aria-label="bar.label"
          :aria-pressed="bar.month === month"
          @click="setMonth(bar.month)"
        >
          <span
            class="block w-full rounded-t-[3px]"
            :class="bar.month === month ? 'bg-accent' : 'bg-[var(--ramp-4)]'"
            :style="{ height: `${bar.height}px` }"
          />
        </button>
      </div>
      <div class="mt-1 grid grid-cols-12 gap-1 text-center text-[0.6875rem]" aria-hidden="true">
        <span v-for="bar in bars" :key="bar.month" :class="bar.month === month ? 'text-accent' : 'text-subtle'">
          {{ MONTH_NAMES[bar.month - 1]![0] }}
        </span>
      </div>
    </div>

    <div class="flex items-center gap-2">
      <button
        type="button"
        class="grid size-11 place-items-center rounded-md bg-accent text-accent-contrast"
        :aria-label="isPlaying ? 'Pause' : 'Play'"
        @click="toggle"
      >
        <UiIcon :name="isPlaying ? 'pause' : 'play'" class="size-5" />
      </button>
      <button
        type="button"
        class="step-button grid size-10 place-items-center rounded-md border border-border hover:bg-surface-2"
        aria-label="Previous month"
        @click="stepMonth(-1)"
      >
        <UiIcon name="chevron-left" />
      </button>
      <button
        type="button"
        class="step-button grid size-10 place-items-center rounded-md border border-border hover:bg-surface-2"
        aria-label="Next month"
        @click="stepMonth(1)"
      >
        <UiIcon name="chevron-right" />
      </button>
      <span class="ml-auto text-xs text-subtle">Plays a month a second, on a loop</span>
    </div>

    <AnalyseEffortSetting v-model="isAdjusted" label="Adjust for how many people record" :disabled="!group">
      More records can mean more people looking, not more of the species. This shows it as a share of all
      {{ group?.name ?? 'its group’s' }} records each month, on the bars and the map.
    </AnalyseEffortSetting>
  </div>
</template>

<style scoped>
.month-bar:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}
@media (pointer: coarse) {
  .step-button {
    width: 2.75rem;
    height: 2.75rem;
  }
}
</style>
