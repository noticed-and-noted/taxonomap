<script setup lang="ts">
/**
 * Placeholder for a species' sounds: a block the height of SoundPlayer above its credit line,
 * so the About text below stays put when the sounds arrive.
 */
import SkeletonBlock from '~/components/atoms/SkeletonBlock.vue';
import SkeletonLine from './SkeletonLine.vue';
</script>

<template>
  <div class="sounds-skeleton mt-5 -mb-2" role="status" aria-label="Loading sounds">
    <SkeletonBlock height="var(--player-height)" aria-hidden="true" />
    <SkeletonLine class="mt-2 text-[0.6875rem]" width="14rem" />
  </div>
</template>

<style scoped>
/* SoundPlayer's control height, plus its padding and border. */
.sounds-skeleton {
  --player-height: calc(2.75rem + 2px);
}
@media (max-width: 767px) {
  .sounds-skeleton {
    --player-height: calc(3.5rem + 2px);
  }
}
</style>
