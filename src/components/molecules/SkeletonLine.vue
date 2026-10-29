<script setup lang="ts">
/**
 * One line of placeholder text. Give it the real text's classes (font, size,
 * margins): it takes that line's exact height, so nothing moves when the text arrives.
 */
import SkeletonBlock from '~/components/atoms/SkeletonBlock.vue';

defineProps<{ width: string }>();
</script>

<template>
  <!-- The zero-width space gives the line its real line-box height; the slot can wrap it in the real inline font. -->
  <span class="relative block"
    ><slot>&#8203;</slot
    ><SkeletonBlock
      class="absolute inset-y-[22%] left-0 max-w-full"
      :width="width"
      height="auto"
      rounded="sm"
      aria-hidden="true"
  /></span>
</template>
