<script setup lang="ts">
/**
 * Dual-handle year range with a mini histogram. Two native range inputs
 * (keyboard and screen-reader friendly) overlay the bars. The store (and
 * therefore the map tiles) only updates on commit, not on every drag step.
 */
import { useStore } from '@nanostores/vue';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { compact, full } from '~/lib/format';
import { $yearRange } from '~/stores/explorer';
import { withHistoryMode } from '~/stores/url-sync';
import ChartFrame from './ChartFrame.vue';
import SkeletonBlock from './SkeletonBlock.vue';
import type { YearCounts } from './useYearHistogram';

const props = defineProps<{ counts: YearCounts; loading: boolean; failed: boolean; live: boolean }>();

const MIN = 1900;
const MAX = new Date().getFullYear();
const W = 600;
const H = 56;

const range = useStore($yearRange);
const lo = ref(range.value?.[0] ?? MIN);
const hi = ref(range.value?.[1] ?? MAX);

watch(range, (r) => {
  lo.value = r?.[0] ?? MIN;
  hi.value = r?.[1] ?? MAX;
});

const years = computed(() => Array.from({ length: MAX - MIN + 1 }, (_, i) => MIN + i));
const earlier = computed(() => {
  let n = 0;
  for (const [y, c] of props.counts) if (y < MIN) n += c;
  return n;
});
const max = computed(() => Math.max(1, ...years.value.map((y) => props.counts.get(y) ?? 0)));
const bars = computed(() => {
  const bw = W / years.value.length;
  return years.value.map((y, i) => {
    const c = props.counts.get(y) ?? 0;
    // sqrt scale keeps early decades visible next to the recent boom.
    const h = c ? Math.max(1, Math.sqrt(c / max.value) * (H - 2)) : 0;
    return { y, c, x: i * bw, w: Math.max(bw - 0.6, 0.6), h, inRange: y >= lo.value && y <= hi.value };
  });
});
const inRangeTotal = computed(() => bars.value.reduce((s, b) => s + (b.inRange ? b.c : 0), 0));
const decades = computed(() => {
  const out: { label: string; c: number }[] = [];
  for (let d = Math.floor(MIN / 10) * 10; d <= MAX; d += 10) {
    let c = 0;
    for (let y = d; y < d + 10; y++) c += props.counts.get(y) ?? 0;
    out.push({ label: `${d}s`, c });
  }
  return out;
});

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
function reset() {
  lo.value = MIN;
  hi.value = MAX;
  commit();
}

/* ---- Decade animation ---- */
const DECADE_MS = 1600;
const playing = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;

function step(start: number) {
  const end = Math.min(start + 9, MAX);
  // Replace history while animating so Back isn't flooded with decades.
  withHistoryMode('replace', () => $yearRange.set([start, end]));
  if (start + 10 > MAX) {
    playing.value = false;
    return;
  }
  timer = setTimeout(() => step(start + 10), DECADE_MS);
}

function togglePlay() {
  if (playing.value) {
    playing.value = false;
    clearTimeout(timer);
    return;
  }
  playing.value = true;
  // Continue from the current decade if one is showing, otherwise start at 1900.
  const r = range.value;
  const from = r && r[1] - r[0] === 9 && r[0] % 10 === 0 && r[0] + 10 <= MAX ? r[0] + 10 : MIN;
  step(from);
}

onBeforeUnmount(() => clearTimeout(timer));

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
        <p v-else-if="failed && !counts.size" class="grid h-14 place-items-center text-xs text-muted">
          Year counts are unavailable right now.
        </p>
        <svg
          v-else
          :viewBox="`0 0 ${W} ${H}`"
          preserveAspectRatio="none"
          class="block h-14 w-full"
          role="img"
          :aria-label="`Histogram of records per year from ${MIN} to ${MAX}`"
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
            :min="MIN"
            :max="MAX"
            :value="lo"
            aria-label="From year"
            :aria-valuetext="String(lo)"
            @input="onLo"
            @change="commit"
          />
          <input
            type="range"
            :min="MIN"
            :max="MAX"
            :value="hi"
            aria-label="To year"
            :aria-valuetext="String(hi)"
            @input="onHi"
            @change="commit"
          />
        </div>
      </div>
      <template #table>
        <table>
          <thead>
            <tr>
              <th scope="col">Decade</th>
              <th scope="col">Records</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="earlier">
              <td>Before {{ MIN }}</td>
              <td>{{ full(earlier) }}</td>
            </tr>
            <tr v-for="d in decades" :key="d.label">
              <td>{{ d.label }}</td>
              <td>{{ full(d.c) }}</td>
            </tr>
          </tbody>
        </table>
      </template>
    </ChartFrame>
    <div class="mt-1.5 flex items-center justify-between text-xs">
      <span class="flex items-center gap-2">
        <button
          type="button"
          class="grid size-6 place-items-center rounded-full border border-border text-text hover:border-accent"
          :aria-pressed="playing"
          :aria-label="playing ? 'Pause the decade animation' : 'Play through the decades'"
          @click="togglePlay"
        >
          <svg v-if="!playing" viewBox="0 0 12 12" class="size-3" aria-hidden="true">
            <path d="M3 2l7 4-7 4z" fill="currentColor" />
          </svg>
          <svg v-else viewBox="0 0 12 12" class="size-3" aria-hidden="true">
            <path d="M3 2h2v8H3zM7 2h2v8H7z" fill="currentColor" />
          </svg>
        </button>
        <span class="font-medium text-text" aria-live="polite">{{ label }}</span>
      </span>
      <span class="text-subtle">
        {{ compact(inRangeTotal) }} dated records
        <button
          v-if="range"
          type="button"
          class="ml-2 text-muted underline-offset-2 hover:text-text hover:underline"
          @click="reset"
        >
          Reset
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
