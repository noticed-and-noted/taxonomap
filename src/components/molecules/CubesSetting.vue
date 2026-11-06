<script setup lang="ts">
/** Map setting: cube mode, where every count comes from the pre-counted cubes (pipeline/README.md). */
import { useStore } from '@nanostores/vue';
import { $cubesOn, CUBES_BASE, setCubesOn } from '~/stores/cubes';

const isOn = useStore($cubesOn);
</script>

<template>
  <div v-if="CUBES_BASE">
    <label class="check-row">
      <input type="checkbox" :checked="isOn" @change="setCubesOn(($event.target as HTMLInputElement).checked)" />
      <span class="text-sm font-medium">Cube demo (sample data)</span>
    </label>
    <p class="mt-1 text-xs text-muted">
      Every map, count, chart and list comes from pre-counted sample files instead of GBIF. Filters the files don't hold
      are greyed out. Counts are scaled up from a sample, so treat them as estimates.
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
