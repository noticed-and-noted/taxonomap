<script setup lang="ts">
/**
 * Placeholder for a species' Wikipedia intro: SpeciesPage's intro classes with
 * a typical first paragraph, the "Read more" toggle and the credit line.
 */
import SkeletonLine from './SkeletonLine.vue';

const PARAGRAPH_LINES = ['100%', '100%', '100%', '100%', '55%'];
</script>

<template>
  <div class="mt-5 max-w-prose space-y-3 leading-relaxed" role="status" aria-label="Loading introduction">
    <div>
      <SkeletonLine v-for="(width, index) in PARAGRAPH_LINES" :key="index" :width="width" />
    </div>
    <SkeletonLine class="text-sm" width="6rem" />
    <SkeletonLine class="text-xs" width="16rem" />
  </div>
</template>
