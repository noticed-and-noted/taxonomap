<script setup lang="ts">
/** A placeholder row where a search result will land, so nothing jumps when results arrive. */
import { computed } from 'vue';
import SkeletonBlock from '~/components/atoms/SkeletonBlock.vue';

/** Line widths, in %, cycled so stacked placeholders don't look identical. */
const NAME_WIDTHS = [55, 70, 45];
const DETAIL_WIDTHS = [32, 40, 36];

const props = defineProps<{ row: number }>();
const nameWidth = computed(() => `${NAME_WIDTHS[props.row % NAME_WIDTHS.length]}%`);
const detailWidth = computed(() => `${DETAIL_WIDTHS[props.row % DETAIL_WIDTHS.length]}%`);
</script>

<template>
  <li role="none" class="flex items-center gap-3 px-3 py-2" aria-hidden="true">
    <!-- Line boxes match a result's text-sm and text-xs lines, so rows keep their height. -->
    <span class="min-w-0 flex-1">
      <span class="flex h-5 items-center">
        <SkeletonBlock :width="nameWidth" height="0.8rem" />
      </span>
      <span class="flex h-4 items-center">
        <SkeletonBlock :width="detailWidth" height="0.6rem" />
      </span>
    </span>
    <SkeletonBlock width="2.25rem" height="0.7rem" />
  </li>
</template>
