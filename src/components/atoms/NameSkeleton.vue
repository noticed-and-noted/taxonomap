<script setup lang="ts">
/**
 * Holds a name's place in its line of text while the name is looked up: as tall as the text, in a
 * box as tall as the line. Top-aligned, as a middle-aligned box would stretch the line and move the row.
 */
import SkeletonBlock from './SkeletonBlock.vue';
</script>

<template>
  <span class="inline-flex h-lh max-w-full items-center align-top">
    <SkeletonBlock width="8rem" height="1em" rounded="full" label="Loading name" />
  </span>
</template>
