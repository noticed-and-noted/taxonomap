<script setup lang="ts">
/** Quiet "data may be out of date" note shown when a stale cache was served. */
import { useStore } from '@nanostores/vue';
import { $dataStale } from '~/stores/status';

const stale = useStore($dataStale);
const dismiss = () => $dataStale.set(false);
</script>

<template>
  <Transition name="fade">
    <div
      v-if="stale"
      role="status"
      class="fixed bottom-3 left-3 z-30 flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-xs text-muted shadow-panel"
    >
      <span class="size-1.5 rounded-full bg-accent" aria-hidden="true"></span>
      GBIF is busy. Some data may be out of date.
      <button type="button" class="ml-1 underline-offset-2 hover:underline" @click="dismiss">Dismiss</button>
    </div>
  </Transition>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity var(--dur) var(--ease);
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
