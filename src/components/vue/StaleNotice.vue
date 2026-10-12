<script setup lang="ts">
/**
 * Quiet notes: "data may be out of date" when a stale cache was served, and
 * an offline notice while the browser has no connection.
 */
import { useStore } from '@nanostores/vue';
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { $dataStale } from '~/stores/status';

const stale = useStore($dataStale);
const offline = ref(false);
const dismiss = () => $dataStale.set(false);
const update = () => (offline.value = !navigator.onLine);

onMounted(() => {
  update();
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
});
onBeforeUnmount(() => {
  window.removeEventListener('online', update);
  window.removeEventListener('offline', update);
});
</script>

<template>
  <Transition name="fade">
    <div
      v-if="offline"
      role="status"
      class="fixed bottom-3 left-3 z-30 flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-xs text-muted shadow-panel"
    >
      <span class="size-1.5 rounded-full bg-danger" aria-hidden="true"></span>
      You’re offline. Showing data saved on this device.
    </div>
    <div
      v-else-if="stale"
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
