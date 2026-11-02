<script setup lang="ts">
/** Holds a name's place in its line of text while the name is looked up. */
import SkeletonBlock from './SkeletonBlock.vue';
</script>

<template>
  <span class="inline-flex h-lh max-w-full items-center align-middle">
    <SkeletonBlock width="8rem" height="0.75rem" rounded="full" label="Loading name" />
  </span>
</template>
