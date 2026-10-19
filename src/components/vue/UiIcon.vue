<script setup lang="ts">
/** Small stroke icons used in place of Unicode arrows, which render differently per OS (some as emoji). */
const PATHS = {
  'sort-asc': 'm7 14 5-5 5 5',
  'sort-desc': 'm7 10 5 5 5-5',
  sort: 'm8 9 4-4 4 4m-8 6 4 4 4-4',
  external: 'M14 5h5v5m0-5-8 8m7 1v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4',
  'arrow-right': 'M5 12h14m-6-6 6 6-6 6',
  'arrow-left': 'M19 12H5m6-6-6 6 6 6',
  'arrow-up': 'M12 19V5m-6 6 6-6 6 6',
  'chevron-right': 'm9 6 6 6-6 6',
  close: 'M6 6l12 12M18 6 6 18',
} as const;

const { name, size = '1em' } = defineProps<{ name: keyof typeof PATHS; size?: string | number }>();
</script>

<template>
  <svg
    viewBox="0 0 24 24"
    :width="size"
    :height="size"
    fill="none"
    stroke="currentColor"
    stroke-width="1.7"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    class="ui-icon"
  >
    <path :d="PATHS[name]" />
  </svg>
</template>

<style scoped>
.ui-icon {
  display: inline-block;
  flex: none;
  vertical-align: -0.125em;
}
</style>
