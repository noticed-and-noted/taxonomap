<script setup lang="ts">
/**
 * Spread: where the species was recorded for the first time, cell by cell, year by year across Analyse's range.
 * Bars count the cells first recorded each year above those recorded before; the map draws the year picked.
 */
import { useStore } from '@nanostores/vue';
import { computed } from 'vue';
import SegmentedControl from '~/components/atoms/SegmentedControl.vue';
import SkeletonBlock from '~/components/atoms/SkeletonBlock.vue';
import UiIcon from '~/components/atoms/UiIcon.vue';
import { usePlayback } from '~/composables/usePlayback';
import type { UiErrorKind } from '~/lib/gbif';
import { MIN_RECORDS, yearlyArrivals } from '~/lib/analyse/spread';
import { wrapStep } from '~/lib/analyse/timeline';
import { full } from '~/lib/format';
import { $analyseTaxon, $analyseYear, $analyseYears, yearsIncluded } from '~/stores/analyse';
import { $analyseFilter } from '~/stores/map-filter';
import { $spreadCells, $spreadOnlyNew, $spreadYear } from '~/stores/spread';
import AnalyseSpreadCountries from './AnalyseSpreadCountries.vue';

/** The tallest bar's height in px. */
const BAR_MAX_PX = 88;

/** The cells' load, which the panel runs (see useSpreadCells). */
defineProps<{ loading: boolean; error: UiErrorKind | null }>();

const SHOW_OPTIONS = [
  { value: 'all', label: 'All to date' },
  { value: 'new', label: 'New only' },
] as const;

const analyseFilter = useStore($analyseFilter);
const speciesKey = useStore($analyseTaxon);
const years = useStore($analyseYears);
const year = useStore($spreadYear);
const cells = useStore($spreadCells);
const onlyNew = useStore($spreadOnlyNew);

const range = computed(() => yearsIncluded(years.value));
/** The records to look through: Spread asks year by year itself. */
const filter = computed(() => {
  const { year: _years, ...rest } = analyseFilter.value ?? {};
  return rest;
});

const arrivals = computed(() => (cells.value ? yearlyArrivals(cells.value.firstYears, ...range.value) : []));
const current = computed(() => arrivals.value[year.value - range.value[0]]);
const peak = computed(() => Math.max(1, ...arrivals.value.map((entry) => entry.before + entry.added)));
const bars = computed(() =>
  arrivals.value.map((entry) => ({
    ...entry,
    newHeight: Math.max(entry.added ? 2 : 0, Math.round((entry.added / peak.value) * BAR_MAX_PX)),
    oldHeight: Math.round((entry.before / peak.value) * BAR_MAX_PX),
    label: `${entry.year}, ${full(entry.added)} new cell${entry.added === 1 ? '' : 's'}`,
  })),
);
const axis = computed(() => {
  const [first, last] = range.value;
  return [first, Math.round((first + last) / 2), last];
});

const show = computed({
  get: () => (onlyNew.value ? 'new' : 'all'),
  set: (value: 'all' | 'new') => $spreadOnlyNew.set(value === 'new'),
});

const setYear = (value: number) => $analyseYear.set(value);
const stepYear = (delta: number) => setYear(wrapStep(year.value, delta, ...range.value));
const { isPlaying, toggle } = usePlayback(
  () => stepYear(1),
  () => $spreadCells.get() !== null,
);
</script>

<template>
  <div class="flex flex-col gap-4 text-sm">
    <p class="text-muted">
      Where it was recorded for the first time, cell by cell, as the years go by. A cell counts once it has
      {{ MIN_RECORDS }} records.
    </p>

    <div class="flex items-baseline justify-between" aria-live="polite">
      <span class="font-display text-2xl font-semibold tabular-nums">{{ year }}</span>
      <span v-if="current" class="text-muted tabular-nums">
        <strong class="font-medium text-text">+{{ full(current.added) }}</strong> new cells ·
        {{ full(current.before + current.added) }} in all
      </span>
    </div>

    <p v-if="error && !cells" class="grid h-28 place-items-center text-xs text-muted">
      The spread is unavailable right now.
    </p>
    <SkeletonBlock v-else-if="loading || !cells" height="7rem" label="Loading the spread" />
    <div v-else>
      <div
        role="group"
        aria-label="Cells first recorded, by year"
        class="grid h-24 items-end gap-0.5"
        :style="{ gridTemplateColumns: `repeat(${bars.length}, minmax(0, 1fr))` }"
      >
        <button
          v-for="bar in bars"
          :key="bar.year"
          type="button"
          class="year-bar flex h-full flex-col justify-end"
          :class="{ 'opacity-35': bar.year > year }"
          :aria-label="bar.label"
          :aria-pressed="bar.year === year"
          @click="setYear(bar.year)"
        >
          <span
            class="block rounded-t-[2px] bg-[var(--ramp-7)]"
            :class="{ 'outline-2 outline-offset-1 outline-accent': bar.year === year }"
            :style="{ height: `${bar.newHeight}px` }"
          />
          <span class="block bg-[var(--ramp-2)]" :style="{ height: `${bar.oldHeight}px` }" />
        </button>
      </div>
      <div class="mt-1 flex justify-between text-[0.6875rem] text-subtle tabular-nums" aria-hidden="true">
        <span v-for="label in axis" :key="label">{{ label }}</span>
      </div>
      <div class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span class="flex items-center gap-1.5">
          <span class="hex-dot bg-[var(--ramp-7)]" aria-hidden="true" />First recorded in {{ year }}
        </span>
        <span v-if="!onlyNew" class="flex items-center gap-1.5">
          <span class="hex-dot bg-[var(--ramp-2)]" aria-hidden="true" />Recorded before {{ year }}
        </span>
      </div>
    </div>

    <input
      type="range"
      class="w-full accent-[var(--accent)]"
      :min="range[0]"
      :max="range[1]"
      step="1"
      :value="year"
      aria-label="Year"
      @input="setYear(Number(($event.target as HTMLInputElement).value))"
    />

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
        aria-label="Previous year"
        @click="stepYear(-1)"
      >
        <UiIcon name="chevron-left" />
      </button>
      <button
        type="button"
        class="step-button grid size-10 place-items-center rounded-md border border-border hover:bg-surface-2"
        aria-label="Next year"
        @click="stepYear(1)"
      >
        <UiIcon name="chevron-right" />
      </button>
      <SegmentedControl v-model="show" legend="Show" :options="SHOW_OPTIONS" class="ml-auto text-[0.8125rem]" />
    </div>

    <AnalyseSpreadCountries
      v-if="speciesKey !== null"
      :filter="filter"
      :species-key="speciesKey"
      :range="range"
      :year="year"
    />
  </div>
</template>

<style scoped>
.year-bar:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}
.hex-dot {
  display: inline-block;
  width: 0.75rem;
  height: 0.875rem;
  clip-path: polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%);
}
@media (pointer: coarse) {
  .step-button {
    width: 2.75rem;
    height: 2.75rem;
  }
}
</style>
