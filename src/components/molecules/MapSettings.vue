<script setup lang="ts">
/** Map settings: the density ramp, shown as a swatch strip per option. */
import { useStore } from '@nanostores/vue';
import { useId } from 'vue';
import { RAMPS, type RampId } from '~/lib/ramp';
import { $ramp, setRamp } from '~/stores/ramp';

const current = useStore($ramp);
// Unique per instance: the rail flyout and the phone sheet can both render one.
const group = `ramp-${useId()}`;
</script>

<!-- The list grows with its parent's scroll, so swipes on a phone always reach the sheet. -->
<template>
  <div role="radiogroup" :aria-labelledby="`${group}-title`">
    <p :id="`${group}-title`" class="mb-2 text-sm font-medium">Map colours</p>
    <p class="mb-3 text-xs text-muted">How the hexagons are shaded by record count. Saved in this browser.</p>
    <div class="-mx-1 flex flex-col gap-1 px-1 pb-3">
      <label v-for="ramp in RAMPS" :key="ramp.id" class="ramp-option">
        <input
          type="radio"
          :name="group"
          class="sr-only"
          :aria-label="`${ramp.name}: ${ramp.note}`"
          :value="ramp.id"
          :checked="current === ramp.id"
          @change="setRamp(ramp.id as RampId)"
        />
        <span class="flex h-3 w-full overflow-hidden rounded-sm" aria-hidden="true">
          <span
            v-for="colour in ramp.colors.slice(1)"
            :key="colour"
            class="flex-1"
            :style="{ background: colour }"
          ></span>
        </span>
        <span class="flex items-baseline justify-between gap-2">
          <span class="text-sm text-text">{{ ramp.name }}</span>
          <span v-if="current === ramp.id" class="text-xs text-accent">Selected</span>
        </span>
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
