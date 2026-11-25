<script setup lang="ts">
/**
 * Quiet notes: "data may be out of date" when a stale cache was served, and a
 * reload offer when a new version has been deployed. Offline, the service
 * worker shows the offline page instead (BaseLayout).
 */
import { useStore } from '@nanostores/vue';
import { $gbifStale } from '~/lib/gbif';
import { $applyUpdate } from '~/stores/app-update';
import BusyNotice from './BusyNotice.vue';
import UpdateNotice from './UpdateNotice.vue';

const { onMap = false } = defineProps<{
  /** The map shows both notes itself, above its loading ring (MapProgress). */
  onMap?: boolean;
}>();

const stale = useStore($gbifStale);
const applyUpdate = useStore($applyUpdate);
</script>

<template>
  <Transition name="fade">
    <UpdateNotice
      v-if="applyUpdate && !onMap"
      class="update-notice fixed inset-x-3 z-30 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2"
    />
    <BusyNotice v-else-if="stale && !onMap" class="fixed bottom-3 left-3 z-30" />
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
