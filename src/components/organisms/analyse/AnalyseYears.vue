<script setup lang="ts">
/**
 * Analyse's "Years" setting: a closed summary row that opens to a two-handle slider and presets.
 * It is Analyse's own range, apart from the When filter.
 */
import { useStore } from '@nanostores/vue';
import { computed, ref, useId } from 'vue';
import UiIcon from '~/components/atoms/UiIcon.vue';
import { $analyseYears, ANALYSE_FIRST_YEAR, analyseLastYear, clampYears } from '~/stores/analyse';

const LAST_YEAR = analyseLastYear();
const SPAN = LAST_YEAR - ANALYSE_FIRST_YEAR;

const PRESETS = [
  { label: 'All years', first: ANALYSE_FIRST_YEAR },
  { label: 'Last 10 years', first: LAST_YEAR - 9 },
  { label: 'Last 5 years', first: LAST_YEAR - 4 },
] as const;

const years = useStore($analyseYears);
const first = computed(() => years.value?.[0] ?? ANALYSE_FIRST_YEAR);
const last = computed(() => years.value?.[1] ?? LAST_YEAR);

const isOpen = ref(false);
const bodyId = useId();

const trackStyle = computed(() => ({
  left: `${((first.value - ANALYSE_FIRST_YEAR) * 100) / SPAN}%`,
  width: `${((last.value - first.value) * 100) / SPAN}%`,
}));

/** Stores a new span (null when it covers every year, so it stays out of the URL). */
const setYears = (from: number, to: number) => $analyseYears.set(clampYears(from, to));

const onFirst = (event: Event) =>
  setYears(Math.min(Number((event.target as HTMLInputElement).value), last.value), last.value);
const onLast = (event: Event) =>
  setYears(first.value, Math.max(Number((event.target as HTMLInputElement).value), first.value));

const isPreset = (presetFirst: number) => first.value === presetFirst && last.value === LAST_YEAR;
</script>

<template>
  <div class="rounded-md border border-border">
    <button
      type="button"
      class="flex h-10 w-full items-center gap-2 px-3 text-[0.8125rem]"
      :aria-expanded="isOpen"
      :aria-controls="bodyId"
      @click="isOpen = !isOpen"
    >
      <UiIcon name="calendar" class="text-muted" />
      <span class="text-muted">Years</span>
      <span class="font-medium tabular-nums">{{ first }} to {{ last }}</span>
      <span class="ml-auto text-muted">{{ isOpen ? 'Done' : 'Change' }}</span>
      <UiIcon name="chevron-down" class="chevron text-muted" :class="{ 'is-open': isOpen }" />
    </button>

    <div v-show="isOpen" :id="bodyId" class="flex flex-col gap-2.5 border-t border-border px-3 pt-1 pb-3">
      <div class="dual-range relative mt-2 h-[22px]">
        <span class="absolute inset-x-0 top-[9px] h-1 rounded-full bg-border" aria-hidden="true" />
        <span class="absolute top-[9px] h-1 rounded-full bg-accent" :style="trackStyle" aria-hidden="true" />
        <input
          type="range"
          :min="ANALYSE_FIRST_YEAR"
          :max="LAST_YEAR"
          step="1"
          :value="first"
          aria-label="First year included"
          @change="onFirst"
        />
        <input
          type="range"
          :min="ANALYSE_FIRST_YEAR"
          :max="LAST_YEAR"
          step="1"
          :value="last"
          aria-label="Last year included"
          @change="onLast"
        />
      </div>
      <div class="flex flex-wrap gap-1.5">
        <button
          v-for="preset in PRESETS"
          :key="preset.label"
          type="button"
          class="h-7 rounded-sm border px-2.5 text-xs"
          :class="isPreset(preset.first) ? 'border-accent bg-accent-soft' : 'border-border hover:bg-surface-2'"
          :aria-pressed="isPreset(preset.first)"
          @click="setYears(preset.first, LAST_YEAR)"
        >
          {{ preset.label }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.chevron {
  transition: transform var(--dur) var(--ease);
}
.chevron.is-open {
  transform: rotate(180deg);
}

/* Two native range inputs share one track; only their thumbs take the pointer. */
.dual-range input {
  position: absolute;
  inset: 0;
  width: 100%;
  margin: 0;
  background: none;
  pointer-events: none;
  appearance: none;
  -webkit-appearance: none;
}
.dual-range input::-webkit-slider-runnable-track {
  background: transparent;
}
.dual-range input::-webkit-slider-thumb {
  pointer-events: auto;
  appearance: none;
  -webkit-appearance: none;
  width: 18px;
  height: 18px;
  margin-top: 2px;
  border: 2px solid var(--surface);
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 0 1px var(--accent);
  cursor: ew-resize;
}
.dual-range input::-moz-range-thumb {
  pointer-events: auto;
  box-sizing: border-box;
  width: 18px;
  height: 18px;
  border: 2px solid var(--surface);
  border-radius: 50%;
  background: var(--accent);
  cursor: ew-resize;
}
.dual-range input:focus-visible::-webkit-slider-thumb {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}
.dual-range input:focus-visible::-moz-range-thumb {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}
</style>
