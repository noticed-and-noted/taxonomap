<script setup lang="ts">
/**
 * Spread: where the species was recorded for the first time, cell by cell, year by year across Analyse's range.
 * Bars count the cells first recorded each year above those recorded before; the map draws the year picked, which
 * a click or a drag along the bars chooses. Adjusted for how much is recorded, the bars show new cells per million
 * records of every species that year, so a year when recording boomed doesn't look like a leap in range.
 */
import { useStore } from '@nanostores/vue';
import { computed, ref, watch } from 'vue';
import SkeletonBlock from '~/components/atoms/SkeletonBlock.vue';
import UiIcon from '~/components/atoms/UiIcon.vue';
import InfoTip from '~/components/molecules/InfoTip.vue';
import { useLatestLoad } from '~/composables/useLatestLoad';
import { usePlayback } from '~/composables/usePlayback';
import { formatRate, perMillion } from '~/lib/analyse/effort';
import type { UiErrorKind } from '~/lib/gbif';
import { MIN_RECORDS, yearlyArrivals } from '~/lib/analyse/spread';
import { wrapStep } from '~/lib/analyse/timeline';
import { allRecordsByYear } from '~/lib/analyse/years';
import { full } from '~/lib/format';
import { $analyseTaxon, $analyseYear, $spreadEffort } from '~/stores/analyse';
import { $analyseFilter } from '~/stores/map-filter';
import { $spreadCells, $spreadRange, $spreadYear } from '~/stores/spread';
import AnalyseEffortSetting from './AnalyseEffortSetting.vue';
import AnalyseSpreadCountries from './AnalyseSpreadCountries.vue';

/** The tallest bar's height in px. */
const BAR_MAX_PX = 88;
/** Most bars that keep a 2px gap, and a 1px one. */
const FULL_GAP_BARS = 40;
const THIN_GAP_BARS = 100;

/** The cells' load, which the panel runs (see useSpreadCells). */
defineProps<{ loading: boolean; error: UiErrorKind | null }>();

const analyseFilter = useStore($analyseFilter);
const speciesKey = useStore($analyseTaxon);
const year = useStore($spreadYear);
const cells = useStore($spreadCells);

/** The years Spread steps through: those included, from the first year a cell appears. */
const range = useStore($spreadRange);
/** The records to look through: Spread asks year by year itself. */
const filter = computed(() => {
  const { year: _years, ...rest } = analyseFilter.value ?? {};
  return rest;
});

const effortStore = useStore($spreadEffort);
const isAdjusted = computed({ get: () => effortStore.value, set: (value: boolean) => $spreadEffort.set(value) });
/** Records of every species each year, for the adjusted bars; empty until asked for. */
const allRecords = ref(new Map<number, number>());
const totalsLoad = useLatestLoad();
watch(
  () => JSON.stringify([isAdjusted.value && filter.value, range.value]),
  () => {
    allRecords.value = new Map();
    if (!isAdjusted.value) return;
    void totalsLoad.run(async (signal) => {
      const found = await allRecordsByYear(filter.value, range.value, signal);
      if (!signal.aborted) allRecords.value = found;
    });
  },
  { immediate: true },
);
const isShowingRates = computed(() => isAdjusted.value && allRecords.value.size > 0);

const arrivals = computed(() =>
  (cells.value ? yearlyArrivals(cells.value.firstYears, ...range.value) : []).map((entry) => ({
    ...entry,
    rate: perMillion(entry.added, allRecords.value.get(entry.year) ?? 0),
  })),
);
const current = computed(() => arrivals.value[year.value - range.value[0]]);
const bars = computed(() => (isShowingRates.value ? rateBars() : cellBars()));

/** New cells stacked on those recorded before, to scale with the most cells in any year. */
function cellBars() {
  const peak = Math.max(1, ...arrivals.value.map((entry) => entry.before + entry.added));
  return arrivals.value.map((entry) => ({
    year: entry.year,
    newHeight: Math.max(entry.added ? 2 : 0, Math.round((entry.added / peak) * BAR_MAX_PX)),
    oldHeight: Math.round((entry.before / peak) * BAR_MAX_PX),
    label: `${entry.year}, ${full(entry.added)} new cell${entry.added === 1 ? '' : 's'}`,
  }));
}

/** New cells per million records that year, to scale with the highest rate. */
function rateBars() {
  const peak = Math.max(Number.MIN_VALUE, ...arrivals.value.map((entry) => entry.rate));
  return arrivals.value.map((entry) => ({
    year: entry.year,
    newHeight: Math.max(entry.rate ? 2 : 0, Math.round((entry.rate / peak) * BAR_MAX_PX)),
    oldHeight: 0,
    label: `${entry.year}, ${formatRate(entry.rate)} new cells per million records`,
  }));
}
/**
 * The gap between bars: 2px for a few decades, 1px for more, none past a century, so a long range (back to the
 * 1800s) keeps its bars instead of spending the chart's width on gaps.
 */
const barGap = computed(() => {
  const count = bars.value.length;
  if (count <= FULL_GAP_BARS) return 2;
  return count <= THIN_GAP_BARS ? 1 : 0;
});

const axis = computed(() => {
  const [first, last] = range.value;
  return [first, Math.round((first + last) / 2), last];
});

const setYear = (value: number) => $analyseYear.set(value);

/** The bars, for working out which year a drag is over. */
const barGroup = ref<HTMLElement>();
const isDragging = ref(false);

/** The year of the bar under a pointer's x position, the end bars for anywhere past them. */
function yearAt(clientX: number): number {
  const box = barGroup.value!.getBoundingClientRect();
  const count = bars.value.length;
  const index = Math.min(count - 1, Math.max(0, Math.floor(((clientX - box.left) / box.width) * count)));
  return range.value[0] + index;
}

/** Pressing on the bars picks the year under the pointer, and keeps picking as it drags along them. */
function startDrag(event: PointerEvent) {
  if (event.button !== 0) return;
  isDragging.value = true;
  barGroup.value!.setPointerCapture(event.pointerId);
  setYear(yearAt(event.clientX));
}

function drag(event: PointerEvent) {
  if (isDragging.value) setYear(yearAt(event.clientX));
}

const endDrag = () => (isDragging.value = false);
const stepYear = (delta: number) => setYear(wrapStep(year.value, delta, ...range.value));
const { isPlaying, toggle } = usePlayback(
  () => stepYear(1),
  () => $spreadCells.get() !== null,
);
</script>

<template>
  <div class="flex flex-col gap-4 text-sm">
    <div class="flex items-baseline justify-between">
      <span class="flex items-center gap-1">
        <span class="font-display text-2xl font-semibold tabular-nums" aria-live="polite">{{ year }}</span>
        <InfoTip label="About Spread">
          Where it was recorded for the first time, cell by cell, as the years go by. A cell counts once it has
          {{ MIN_RECORDS }} records. Drag along the bars to move through the years.
        </InfoTip>
      </span>
      <span v-if="current" class="text-muted tabular-nums" aria-live="polite">
        <strong class="font-medium text-text">+{{ full(current.added) }}</strong> new cells ·
        <template v-if="isShowingRates">{{ formatRate(current.rate) }} per million records</template>
        <template v-else>{{ full(current.before + current.added) }} in all</template>
      </span>
    </div>

    <p v-if="error && !cells" class="grid h-28 place-items-center text-xs text-muted">
      The spread is unavailable right now.
    </p>
    <SkeletonBlock v-else-if="loading || !cells" height="7rem" label="Loading the spread" />
    <div v-else>
      <div
        ref="barGroup"
        role="group"
        aria-label="Cells first recorded, by year"
        class="bar-group grid h-24 cursor-ew-resize items-end"
        :style="{ gridTemplateColumns: `repeat(${bars.length}, minmax(0, 1fr))`, columnGap: `${barGap}px` }"
        @pointerdown="startDrag"
        @pointermove="drag"
        @pointerup="endDrag"
        @pointercancel="endDrag"
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
          <!-- One box round both parts, so the picked year's outline covers the whole bar. -->
          <span
            class="flex flex-col overflow-hidden rounded-t-[2px]"
            :class="{ 'outline-2 outline-offset-1 outline-accent': bar.year === year }"
          >
            <span class="block bg-[var(--ramp-7)]" :style="{ height: `${bar.newHeight}px` }" />
            <span class="block bg-[var(--ramp-2)]" :style="{ height: `${bar.oldHeight}px` }" />
          </span>
        </button>
      </div>
      <div class="mt-1 flex justify-between text-[0.6875rem] text-subtle tabular-nums" aria-hidden="true">
        <span v-for="label in axis" :key="label">{{ label }}</span>
      </div>
      <div class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span class="flex items-center gap-1.5">
          <span class="hex-dot bg-[var(--ramp-7)]" aria-hidden="true" />New records
        </span>
        <span class="flex items-center gap-1.5">
          <span class="hex-dot bg-[var(--ramp-2)]" aria-hidden="true" />Existing records
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
    </div>

    <AnalyseEffortSetting v-model="isAdjusted" label="Adjust for how much is recorded">
      Far more is recorded now than decades ago, so new cells can mean more people looking. This shows the bars as new
      cells per million records of every species that year. The map is unchanged.
    </AnalyseEffortSetting>

    <AnalyseSpreadCountries v-if="speciesKey !== null" :filter="filter" :species-key="speciesKey" />
  </div>
</template>

<style scoped>
/* A sideways drag picks years; an up and down one still scrolls the panel. */
.bar-group {
  touch-action: pan-y;
}
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
