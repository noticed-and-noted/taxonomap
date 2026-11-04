<script setup lang="ts">
/** Map setting (experimental): draw hexes from the pre-counted cubes where they can serve the view. */
import { useStore } from '@nanostores/vue';
import { $cubesOn, CUBES_BASE, setCubesOn } from '~/stores/cubes';

const isOn = useStore($cubesOn);
</script>

<template>
  <div v-if="CUBES_BASE">
    <label class="check-row">
      <input type="checkbox" :checked="isOn" @change="setCubesOn(($event.target as HTMLInputElement).checked)" />
      <span class="text-sm font-medium">Sample cube data (experimental)</span>
    </label>
    <p class="mt-1 text-xs text-muted">
      Draws the hexagons from pre-counted sample files instead of GBIF where they can: one taxon or all records, with or
      without a year range. Counts are estimated from a sample, so treat them as rough.
    </p>
  </div>
</template>

<style scoped>
.check-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0 -0.5rem;
  padding: 0.3125rem 0.5rem;
  min-height: 2.75rem;
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.check-row:hover {
  background: var(--surface-2);
}

.check-row input {
  accent-color: var(--accent);
}

@media (min-width: 640px) {
  .check-row {
    min-height: 2.25rem;
  }
}
</style>
