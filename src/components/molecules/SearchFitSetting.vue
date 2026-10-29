<script setup lang="ts">
/** Map setting: whether picking a species or group in search moves the map to its records. */
import { useStore } from '@nanostores/vue';
import { $fitOnSearch, setFitOnSearch } from '~/stores/fit-search';

const isOn = useStore($fitOnSearch);
</script>

<template>
  <div>
    <label class="check-row">
      <input type="checkbox" :checked="isOn" @change="setFitOnSearch(($event.target as HTMLInputElement).checked)" />
      <span class="text-sm font-medium">Go to search results</span>
    </label>
    <p class="mt-1 text-xs text-muted">
      Picking a species or group zooms out to all its records, centred where it has the most.
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
