<script setup lang="ts">
/**
 * Dual-handle year range with a mini histogram. Two native range inputs
 * (keyboard and screen-reader friendly) overlay the bars. The store (and
 * therefore the map tiles) only updates on commit, not on every drag step.
 */
import { useStore } from '@nanostores/vue';
import { computed, ref, watch } from 'vue';
import ChartTip from '~/components/atoms/ChartTip.vue';
import SkeletonBlock from '~/components/atoms/SkeletonBlock.vue';
import ChartFrame from '~/components/molecules/ChartFrame.vue';
import { useYearHistogram } from '~/composables/useYearHistogram';
import { MIN_YEAR, rangeYears, yearsRange } from '~/lib/dates';
import { compact, full } from '~/lib/format';
import { $dateRange } from '~/stores/explorer';

const { counts, loading, error, live } = useYearHistogram();

const MIN = MIN_YEAR;
const MAX = new Date().getFullYear();
const WIDTH = 600;
const HEIGHT = 56;

// The years the date range touches; dragging sets a whole-years range.
const dateRange = useStore($dateRange);
const range = computed(() => rangeYears(dateRange.value));
const low = ref(range.value?.[0] ?? MIN);
const high = ref(range.value?.[1] ?? MAX);

/** The visible span: zoomed to the selected range, with a little room either side to widen it. */
type Span = readonly [number, number];
function zoomTo(span: Span | null): Span {
  if (!span) return [MIN, MAX];
  const pad = Math.max(2, Math.round((span[1] - span[0]) * 0.1));
  return [Math.max(MIN, span[0] - pad), Math.min(MAX, span[1] + pad)];
}
const view = ref<Span>(zoomTo(range.value));
const zoomed = computed(() => view.value[0] > MIN || view.value[1] < MAX);
const zoomOut = () => (view.value = [MIN, MAX]);

watch(range, (span) => {
  low.value = span?.[0] ?? MIN;
  high.value = span?.[1] ?? MAX;
  view.value = zoomTo(span);
});

const years = computed(() => {
  const [firstYear, lastYear] = view.value;
  return Array.from({ length: lastYear - firstYear + 1 }, (_unused, index) => firstYear + index);
});
const max = computed(() => Math.max(1, ...years.value.map((year) => counts.value.get(year) ?? 0)));
const bars = computed(() => {
  const barWidth = WIDTH / years.value.length;
  return years.value.map((year, index) => {
    const count = counts.value.get(year) ?? 0;
    // sqrt scale keeps early decades visible next to the recent boom.
    const barHeight = count ? Math.max(1, Math.sqrt(count / max.value) * (HEIGHT - 2)) : 0;
    return {
      y: year,
      c: count,
      x: index * barWidth,
      w: Math.max(barWidth - 0.6, 0.6),
      h: barHeight,
      inRange: year >= low.value && year <= high.value,
    };
  });
});
const inRangeTotal = computed(() => bars.value.reduce((total, bar) => total + (bar.inRange ? bar.c : 0), 0));
/** True while a handle is dragged (the store only updates on release). */
const dragging = ref(false);
function commit() {
  dragging.value = false;
  if (low.value > high.value) [low.value, high.value] = [high.value, low.value];
  $dateRange.set(low.value === MIN && high.value === MAX ? null : yearsRange(low.value, high.value));
}

function onLowInput(event: Event) {
  dragging.value = true;
  low.value = Math.min(Number((event.target as HTMLInputElement).value), high.value);
}
function onHighInput(event: Event) {
  dragging.value = true;
  high.value = Math.max(Number((event.target as HTMLInputElement).value), low.value);
}

/** The bar under the pointer, and the chart's box. */
function barAt(event: PointerEvent) {
  const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const count = years.value.length;
  const index = Math.min(count - 1, Math.max(0, Math.floor(((event.clientX - box.left) / box.width) * count)));
  return { bar: bars.value[index]!, box };
}

const hover = ref<{ x: number; y: number; year: number; count: number } | null>(null);
// Touch fires pointerleave as the finger lifts; keep the tapped year's tip until ChartTip dismisses it.
const onLeave = (event: PointerEvent) => event.pointerType !== 'touch' && (hover.value = null);

function onHover(event: PointerEvent) {
  if (!counts.value.size) return;
  const { bar, box } = barAt(event);
  hover.value = { x: event.clientX, y: box.top, year: bar.y, count: bar.c };
}

/** A click on the chart moves the nearer handle to the clicked year's edge. */
function onTrack(event: PointerEvent) {
  if (event.button !== 0 || event.target instanceof HTMLInputElement) return;
  const year = barAt(event).bar.y;
  // Edge distances in bars: From marks a bar's left edge, To its right edge.
  const distanceToLow = Math.abs(year - low.value);
  const distanceToHigh = Math.abs(year - high.value);
  if (year < low.value || (year <= high.value && distanceToLow <= distanceToHigh)) low.value = year;
  else high.value = year;
  commit();
}

const label = computed(() =>
  low.value === MIN && high.value === MAX
    ? 'All years'
    : low.value === high.value
      ? `${low.value}`
      : `${low.value}–${high.value}`,
);
</script>

<template>
  <!-- Positioned so a menu in the label slot can float below it. -->
  <section class="time-slider relative" aria-label="Year range">
    <ChartFrame title="Records per year" :caption="live ? 'filtered' : undefined" compact>
      <div
        class="relative cursor-pointer"
        @pointerdown="(onTrack($event), onHover($event))"
        @pointermove="onHover"
        @pointerleave="onLeave"
      >
        <SkeletonBlock v-if="loading && !counts.size" height="56px" label="Loading year histogram" />
        <p v-else-if="error !== null && !counts.size" class="grid h-14 place-items-center text-xs text-muted">
          Year counts are unavailable right now.
        </p>
        <p v-else-if="!counts.size" class="grid h-14 place-items-center text-xs text-muted">No results</p>
        <svg
          v-else
          :viewBox="`0 0 ${WIDTH} ${HEIGHT}`"
          preserveAspectRatio="none"
          class="block h-14 w-full"
          role="img"
          :aria-label="`Histogram of records per year from ${view[0]} to ${view[1]}`"
        >
          <rect
            v-for="bar in bars"
            :key="bar.y"
            :x="bar.x"
            :y="HEIGHT - bar.h"
            :width="bar.w"
            :height="bar.h"
            :fill="bar.inRange ? 'var(--accent)' : 'var(--border-strong)'"
            :fill-opacity="bar.inRange ? 0.9 : 0.6"
          />
        </svg>
        <ChartTip v-if="hover && !dragging" :x="hover.x" :y="hover.y" class="whitespace-nowrap" @dismiss="hover = null">
          <span class="font-medium text-text">{{ hover.year }}</span>
          <span class="text-subtle"> · {{ full(hover.count) }} records</span>
        </ChartTip>
        <div class="range-wrap" :class="{ 'opacity-50': loading }" :style="{ '--n': years.length }">
          <input
            type="range"
            :min="view[0]"
            :max="view[1]"
            :value="low"
            aria-label="From year"
            :aria-valuetext="String(low)"
            @input="onLowInput"
            @change="commit"
          />
          <input
            type="range"
            :min="view[0]"
            :max="view[1]"
            :value="high"
            aria-label="To year"
            :aria-valuetext="String(high)"
            @input="onHighInput"
            @change="commit"
          />
        </div>
      </div>
    </ChartFrame>
    <div class="mt-2.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-xs">
      <!-- The live range while dragging; FilterGroup puts the date menu here. -->
      <slot name="label" :live="dragging ? label : null">
        <span class="whitespace-nowrap font-medium text-text" aria-live="polite">{{ label }}</span>
      </slot>
      <span class="whitespace-nowrap text-subtle">
        {{ compact(inRangeTotal) }} records
        <button
          v-if="zoomed"
          type="button"
          class="ml-2 text-muted underline-offset-2 hover:text-text hover:underline"
          aria-label="Zoom out to all years"
          @click="zoomOut"
        >
          Zoom out
        </button>
      </span>
    </div>
  </section>
</template>

<style scoped>
.range-wrap {
  position: absolute;
  inset: auto 0 -8px 0;
  height: 16px;
}

/* Each input spans one bar less, plus a thumb, so From sits on a bar's left edge
   and To on its right edge: one year shows a handle either side of its bar. */
.range-wrap input {
  position: absolute;
  top: 0;
  bottom: 0;
  left: -8px;
  width: calc(100% - 100% / var(--n) + 16px);
  margin: 0;
  background: none;
  pointer-events: none;
  appearance: none;
  -webkit-appearance: none;
}

.range-wrap input + input {
  left: calc(100% / var(--n) - 8px);
}

.range-wrap input::-webkit-slider-runnable-track {
  height: 2px;
  background: transparent;
}

.range-wrap input::-webkit-slider-thumb {
  pointer-events: auto;
  appearance: none;
  -webkit-appearance: none;
  width: 16px;
  height: 16px;
  margin-top: -7px;
  border-radius: 50%;
  background: var(--accent);
  border: 2px solid var(--surface);
  box-shadow: 0 0 0 1px var(--accent);
  cursor: ew-resize;
}

.range-wrap input::-moz-range-thumb {
  pointer-events: auto;
  box-sizing: border-box;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--accent);
  border: 2px solid var(--surface);
  cursor: ew-resize;
}

.range-wrap input:focus-visible::-webkit-slider-thumb {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

.range-wrap input:focus-visible::-moz-range-thumb {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}
</style>
