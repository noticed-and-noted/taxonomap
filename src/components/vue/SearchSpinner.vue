<script setup lang="ts">
/**
 * A small spinner inside a search box while species names are looked up.
 * Position it with classes (they go on the spinner); screen readers hear a status instead.
 */
defineOptions({ inheritAttrs: false });

defineProps<{ active: boolean }>();
</script>

<template>
  <span
    v-if="active"
    v-bind="$attrs"
    class="pointer-events-none absolute size-3.5 -translate-y-1/2 animate-spin rounded-full border-2 border-border-strong border-t-accent motion-reduce:animate-none"
    aria-hidden="true"
  ></span>
  <span class="sr-only" role="status">{{ active ? 'Looking up species names' : '' }}</span>
</template>
