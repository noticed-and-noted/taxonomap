<script setup lang="ts">
/** Map settings: the density ramp, shown as a swatch strip per option. */
import { useStore } from '@nanostores/vue';
import { onBeforeUnmount, onMounted, ref, useId } from 'vue';
import { RAMPS, type RampId } from '~/lib/ramp';
import { $ramp, setRamp } from '~/stores/ramp';
import { useScrollFade } from './useScrollFade';

const current = useStore($ramp);
// Unique per instance: the rail flyout and the phone sheet can both render one.
const group = `ramp-${useId()}`;

// Soft fades on whichever edges have more options beyond them.
const list = ref<HTMLElement>();
const { fadeTop, fadeBottom, update } = useScrollFade(list);
let resize: ResizeObserver | undefined;
onMounted(() => {
  update();
  resize = new ResizeObserver(update);
  if (list.value) resize.observe(list.value);
});
onBeforeUnmount(() => resize?.disconnect());
</script>

<!--
  In a height-bounded parent (the rail flyout) only the option list scrolls;
  the heading and description stay put. Elsewhere the list just grows.
-->
<template>
  <div class="flex min-h-0 flex-1 flex-col" role="radiogroup" :aria-labelledby="`${group}-title`">
    <p :id="`${group}-title`" class="mb-2 text-sm font-medium">Map colours</p>
    <p class="mb-3 text-xs text-muted">How the hexagons are shaded by record count. Saved in this browser.</p>
    <div
      ref="list"
      class="fade-list -mx-1 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain px-1 pb-3"
      :class="{ 'fade-top': fadeTop, 'fade-bottom': fadeBottom }"
      @scroll.passive="update"
    >
      <label v-for="r in RAMPS" :key="r.id" class="ramp-option">
        <input
          type="radio"
          :name="group"
          class="sr-only"
          :aria-label="`${r.name}: ${r.note}`"
          :value="r.id"
          :checked="current === r.id"
          @change="setRamp(r.id as RampId)"
        />
        <span class="flex h-3 w-full overflow-hidden rounded-sm" aria-hidden="true">
          <span v-for="c in r.colors.slice(1)" :key="c" class="flex-1" :style="{ background: c }"></span>
        </span>
        <span class="flex items-baseline justify-between gap-2">
          <span class="text-sm text-text">{{ r.name }}</span>
          <span v-if="current === r.id" class="text-xs text-accent">Selected</span>
        </span>
        <span class="text-xs text-muted">{{ r.note }}</span>
      </label>
    </div>
  </div>
</template>

<style scoped>
/*
 * Positioned so the visually hidden radio sits inside its option: focusing it
 * then scrolls only the list, not the page.
 */
.ramp-option {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.5rem 0.625rem;
  border: 1px solid transparent;
  border-radius: var(--radius);
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease),
    border-color var(--dur-fast) var(--ease);
}
.ramp-option:hover {
  background: var(--surface-2);
}
.ramp-option:has(:checked) {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.ramp-option:has(:focus-visible) {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}
</style>
