<script setup lang="ts">
/**
 * Quiet notes: "data may be out of date" when a stale cache was served, and a
 * reload offer when a new version has been deployed. Offline, the service
 * worker shows the offline page instead (BaseLayout).
 */
import { useStore } from '@nanostores/vue';
import { $gbifStale } from '~/lib/gbif';
import { $applyUpdate } from '~/stores/app-update';

const stale = useStore($gbifStale);
const applyUpdate = useStore($applyUpdate);
const dismiss = () => $gbifStale.set(false);
</script>

<template>
  <Transition name="fade">
    <div
      v-if="applyUpdate"
      role="status"
      class="update-notice fixed inset-x-3 z-30 flex items-center gap-2 rounded-md border border-border bg-surface py-1.5 pr-1.5 pl-3 text-xs text-muted shadow-panel sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2"
    >
      <span class="size-1.5 rounded-full bg-accent" aria-hidden="true"></span>
      A new version of Taxonomap is available.
      <!-- The ::after stretches the hit area to 44px on phones without making the button look bigger. -->
      <button
        type="button"
        class="relative ml-auto shrink-0 rounded-sm border border-border-strong bg-surface-2 px-2.5 py-1 font-medium text-text transition-colors duration-(--dur-fast) ease-field after:absolute after:-inset-x-1.5 after:-inset-y-[9px] hover:bg-surface-3 sm:ml-2 sm:after:hidden"
        @click="applyUpdate()"
      >
        Reload
      </button>
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
/* Phones: below the 2rem Near me / Filters row, one header gap clear of it, as that row is of the header. */
.update-notice {
  top: calc(var(--header-offset) + 2rem + 2 * var(--header-gap));
}
@media (min-width: 640px) {
  .update-notice {
    top: calc(var(--header-offset) + var(--header-gap));
  }
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity var(--dur) var(--ease);
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
