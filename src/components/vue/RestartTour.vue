<script setup lang="ts">
/** Settings entry that shows the guided tour again. */
import { restartTour } from '~/stores/onboarding';
</script>

<template>
  <div>
    <p class="mb-1 text-sm font-medium">Guided tour</p>
    <p class="mb-2 text-xs text-muted">A short walk through the map, its panels and filters.</p>
    <button type="button" class="restart-btn" @click="restartTour">Restart tour</button>
  </div>
</template>

<style scoped>
.restart-btn {
  height: 2.75rem;
  padding: 0 0.875rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text);
  font-size: 0.875rem;
  transition:
    background var(--dur-fast) var(--ease),
    border-color var(--dur-fast) var(--ease);
}

.restart-btn:hover {
  background: var(--surface-2);
  border-color: var(--border-strong);
}

@media (min-width: 640px) {
  .restart-btn {
    height: 2.25rem;
  }
}
</style>
