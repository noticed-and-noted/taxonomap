<script setup lang="ts">
/** A small tag on a control cube mode greys out: the cubes don't hold that filter (lib/cubes/filters.ts). */
import { NOT_IN_DEMO } from '~/lib/cubes/filters';
</script>

<template>
  <span class="not-in-demo">{{ NOT_IN_DEMO }}</span>
</template>

<style scoped>
.not-in-demo {
  display: inline-block;
  margin-left: 0.375rem;
  padding: 0 0.375rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-subtle);
  font-size: 0.6875rem;
  font-weight: 400;
  line-height: 1.125rem;
  white-space: nowrap;
}
</style>
