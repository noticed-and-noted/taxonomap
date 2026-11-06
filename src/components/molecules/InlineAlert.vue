<script setup lang="ts">
/**
 * A failed load inside a panel: the message (the default slot), a Try again
 * button, and a link to GBIF's status page when GBIF itself is unavailable.
 */
import GbifStatusLink from '~/components/atoms/GbifStatusLink.vue';
import type { UiErrorKind } from '~/lib/gbif';

defineProps<{
  /** What went wrong; only 'unavailable' points the viewer at GBIF's status. */
  kind: UiErrorKind;
}>();

const emit = defineEmits<{ retry: [] }>();
</script>

<template>
  <div class="rounded-md bg-surface-2 p-3 text-sm text-muted" role="alert">
    <slot />
    <button type="button" class="ml-1 text-text underline" @click="emit('retry')">Try again</button>
    <template v-if="kind === 'unavailable'"> · <GbifStatusLink /></template>
  </div>
</template>
