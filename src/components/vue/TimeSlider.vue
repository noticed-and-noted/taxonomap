<script setup lang="ts">
/**
 * Dual-handle year range with a mini histogram. Two native range inputs
 * (keyboard and screen-reader friendly) overlay the bars. The store (and
 * therefore the map tiles) only updates on commit, not on every drag step.
 */
import { useStore } from '@nanostores/vue';
import { computed, ref, watch } from 'vue';
import { compact } from '~/lib/format';
import { $yearRange } from '~/stores/explorer';
import ChartFrame from './ChartFrame.vue';
import SkeletonBlock from './SkeletonBlock.vue';
import { useYearHistogram } from './useYearHistogram';

const { counts, loading, error, live } = useYearHistogram();

// GBIF rejects interpreted dates before 1500.
const MIN = 1500;
const MAX = new Date().getFullYear();
const W = 600;
const H = 56;

const range = useStore($yearRange);
const lo = ref(range.value?.[0] ?? MIN);
const hi = ref(range.value?.[1] ?? MAX);

/** The visible span: zoomed to the selected range, with a little room either side to widen it. */
type Span = readonly [number, number];
function zoomTo(r: Span | null): Span {
  if (!r) return [MIN, MAX];
  const pad = Math.max(2, Math.round((r[1] - r[0]) * 0.1));
  return [Math.max(MIN, r[0] - pad), Math.min(MAX, r[1] + pad)];
}
const view = ref<Span>(zoomTo(range.value));
const zoomed = computed(() => view.value[0] > MIN || view.value[1] < MAX);
const zoomOut = () => (view.value = [MIN, MAX]);

watch(range, (r) => {
  lo.value = r?.[0] ?? MIN;
  hi.value = r?.[1] ?? MAX;
  view.value = zoomTo(r);
});

const years = computed(() => {
  const [a, b] = view.value;
  return Array.from({ length: b - a + 1 }, (_, i) => a + i);
});
const max = computed(() => Math.max(1, ...years.value.map((y) => counts.value.get(y) ?? 0)));
const bars = computed(() => {
  const bw = W / years.value.length;
  return years.value.map((y, i) => {
    const c = counts.value.get(y) ?? 0;
    // sqrt scale keeps early decades visible next to the recent boom.
    const h = c ? Math.max(1, Math.sqrt(c / max.value) * (H - 2)) : 0;
    return { y, c, x: i * bw, w: Math.max(bw - 0.6, 0.6), h, inRange: y >= lo.value && y <= hi.value };
  });
});
const inRangeTotal = computed(() => bars.value.reduce((s, b) => s + (b.inRange ? b.c : 0), 0));
function commit() {
  if (lo.value > hi.value) [lo.value, hi.value] = [hi.value, lo.value];
  $yearRange.set(lo.value === MIN && hi.value === MAX ? null : [lo.value, hi.value]);
}

function onLo(e: Event) {
  lo.value = Math.min(Number((e.target as HTMLInputElement).value), hi.value);
}
function onHi(e: Event) {
  hi.value = Math.max(Number((e.target as HTMLInputElement).value), lo.value);
}

const label = computed(() =>
  lo.value === MIN && hi.value === MAX
    ? 'All years'
    : lo.value === hi.value
      ? `${lo.value}`
      : `${lo.value}–${hi.value}`,
);
</script>

<template>
  <section class="time-slider" aria-label="Year range">
    <ChartFrame title="Records per year" :caption="live ? 'filtered' : undefined" compact>
      <div class="relative">
        <SkeletonBlock v-if="loading && !counts.size" height="56px" label="Loading year histogram" />
        <p v-else-if="error !== null && !counts.size" class="grid h-14 place-items-center text-xs text-muted">
          Year counts are unavailable right now.
        </p>
        <svg
          v-else
          :viewBox="`0 0 ${W} ${H}`"
          preserveAspectRatio="none"
          class="block h-14 w-full"
          role="img"
          :aria-label="`Histogram of records per year from ${view[0]} to ${view[1]}`"
        >
          <rect
            v-for="b in bars"
            :key="b.y"
            :x="b.x"
            :y="H - b.h"
            :width="b.w"
            :height="b.h"
            :fill="b.inRange ? 'var(--accent)' : 'var(--border-strong)'"
            :fill-opacity="b.inRange ? 0.9 : 0.6"
          />
        </svg>
        <div class="range-wrap" :class="{ 'opacity-50': loading }">
          <input
            type="range"
            :min="view[0]"
            :max="view[1]"
            :value="lo"
            aria-label="From year"
            :aria-valuetext="String(lo)"
            @input="onLo"
            @change="commit"
          />
          <input
            type="range"
            :min="view[0]"
            :max="view[1]"
            :value="hi"
            aria-label="To year"
            :aria-valuetext="String(hi)"
            @input="onHi"
            @change="commit"
          />
        </div>
      </div>
    </ChartFrame>
    <div class="mt-1.5 flex items-center justify-between gap-2 text-xs">
      <span class="whitespace-nowrap font-medium text-text" aria-live="polite">{{ label }}</span>
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

.range-wrap input {
  position: absolute;
  inset: 0;
  width: 100%;
  margin: 0;
  background: none;
  pointer-events: none;
  appearance: none;
  -webkit-appearance: none;
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
  width: 14px;
  height: 14px;
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
