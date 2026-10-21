<script setup lang="ts">
/** Settings entries for onboarding: restart the guided tour, and bring back a hidden "Try this" list. */
import { useStore } from '@nanostores/vue';
import { computed } from 'vue';
import { $checklistDone, $checklistHidden, CHECKLIST, restartTour, showChecklist } from '~/stores/onboarding';

const done = useStore($checklistDone);
const isHidden = useStore($checklistHidden);
// A finished list has nothing left to show, so only an unfinished hidden one is offered back.
const canShowChecklist = computed(() => isHidden.value && done.value.length < CHECKLIST.length);
</script>

<template>
  <div>
    <p class="mb-1 text-sm font-medium">Getting started</p>
    <p class="mb-2 text-xs text-muted">A short walk through the map, and a list of things to try.</p>
    <div class="flex flex-wrap gap-2">
      <button type="button" class="settings-btn" @click="restartTour">Restart tour</button>
      <button v-if="canShowChecklist" type="button" class="settings-btn" @click="showChecklist">Show Try this</button>
    </div>
  </div>
</template>

<style scoped>
.settings-btn {
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

.settings-btn:hover {
  background: var(--surface-2);
  border-color: var(--border-strong);
}

@media (min-width: 640px) {
  .settings-btn {
    height: 2.25rem;
  }
}
</style>
