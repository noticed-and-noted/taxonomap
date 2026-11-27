<script setup lang="ts">
/**
 * Migration: the species' records in each month (all of Analyse's years added together) as bars, one month picked
 * and drawn on the map, with play, back and on to step through the year.
 */
import { useStore } from '@nanostores/vue';
import { computed, ref, watch } from 'vue';
import SkeletonBlock from '~/components/atoms/SkeletonBlock.vue';
import UiIcon from '~/components/atoms/UiIcon.vue';
import { useLatestLoad } from '~/composables/useLatestLoad';
import { usePlayback } from '~/composables/usePlayback';
import { wrapStep } from '~/lib/analyse/timeline';
import { full, MONTH_NAMES } from '~/lib/format';
import { monthCounts, MONTHS_IN_YEAR, occurrenceFacets } from '~/lib/gbif';
import { $analyseMonth } from '~/stores/analyse';
import { $analyseFilter } from '~/stores/map-filter';
import { $mapLoad } from '~/stores/map-messages';

/** The tallest bar's height in px; every bar keeps a sliver so a month with no records still shows. */
const BAR_MAX_PX = 88;
const BAR_MIN_PX = 3;

const filter = useStore($analyseFilter);
const month = useStore($analyseMonth);
const counts = ref<number[]>([]);
const { loading, error, run } = useLatestLoad();

watch(
  () => JSON.stringify(filter.value),
  () => {
    const current = filter.value;
    if (!current) return;
    void run(async (signal) => {
      const result = await occurrenceFacets(current, ['month'], { facetLimit: MONTHS_IN_YEAR, signal });
      if (!signal.aborted) counts.value = monthCounts(result.facets['month'] ?? []);
    });
  },
  { immediate: true },
);

const peak = computed(() => Math.max(1, ...counts.value));
const bars = computed(() =>
  counts.value.map((count, index) => ({
    month: index + 1,
    count,
    height: BAR_MIN_PX + Math.round((count / peak.value) * BAR_MAX_PX),
    label: `${MONTH_NAMES[index]}, ${full(count)} record${count === 1 ? '' : 's'}`,
  })),
);
const monthCount = computed(() => counts.value[month.value - 1]);

const setMonth = (value: number) => $analyseMonth.set(value);
const stepMonth = (delta: number) => setMonth(wrapStep(month.value, delta, 1, MONTHS_IN_YEAR));
const { isPlaying, toggle } = usePlayback(
  () => stepMonth(1),
  () => !$mapLoad.get().loading,
);
</script>

<template>
  <div class="flex flex-col gap-4 text-sm">
    <p class="text-muted">Where it was recorded in each month, with all the years above added together.</p>

    <div class="flex items-baseline justify-between" aria-live="polite">
      <span class="font-display text-2xl font-semibold">{{ MONTH_NAMES[month - 1] }}</span>
      <span v-if="monthCount !== undefined" class="text-muted tabular-nums">
        <strong class="font-medium text-text">{{ full(monthCount) }}</strong> record{{ monthCount === 1 ? '' : 's' }}
      </span>
    </div>

    <p v-if="error && !counts.length" class="grid h-28 place-items-center text-xs text-muted">
      Month counts are unavailable right now.
    </p>
    <SkeletonBlock v-else-if="loading && !counts.length" height="7rem" label="Loading records by month" />
    <div v-else :class="{ 'opacity-60': loading }">
      <div role="group" aria-label="Records by month" class="grid h-24 grid-cols-12 items-end gap-1">
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
