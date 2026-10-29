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
  // Double-headed, for swipe hints.
  'arrows-horizontal': 'M4 12h16M8 8l-4 4 4 4m8-8 4 4-4 4',
  'arrows-vertical': 'M12 4v16M8 8l4-4 4 4m-8 8 4 4 4-4',
  'arrows-all': 'M12 3v18M3 12h18M9 6l3-3 3 3m-6 12 3 3 3-3M6 9l-3 3 3 3m12-6 3 3-3 3',
  'chevron-right': 'm9 6 6 6-6 6',
  'chevron-down': 'm6 9 6 6 6-6',
  close: 'M6 6l12 12M18 6 6 18',
  filter: 'M4 7h16M7 12h10M10 17h4',
  // The header's Tree of life sprout.
  tree: 'M12 21V11M12 11c0-4 3-6 7-6 0 4-3 6-7 6zM12 14c0-3-2.5-5-6-5 0 3 2.5 5 6 5z',
  info: 'M12 3a9 9 0 1 1 0 18 9 9 0 1 1 0-18zM12 11v5M12 8h.01',
  // A picture frame: mountain and sun.
  photo: 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM4 16l5-5 6 6m-1-3 2-2 4 4M15 8h.01',
  // Split into buttons; FILLS highlights the left one, for click hints.
  mouse: 'M10 3h4a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4zM12 3v8M6 11h12',
  // A pointing finger, for tap hints.
  touch:
    'M8 13V4.5a1.5 1.5 0 0 1 3 0V12m0-.5v-2a1.5 1.5 0 0 1 3 0V12m0-1.5a1.5 1.5 0 0 1 3 0V12m0-.5a1.5 1.5 0 0 1 3 0V16a6 6 0 0 1-6 6h-2a6 6 0 0 1-5-2.7L5 19c-.3-.5-1.4-2.4-3.3-5.7a1.5 1.5 0 0 1 .5-2 1.9 1.9 0 0 1 2.3.3L6 13',
} as const;

/** Solid parts drawn under an icon's strokes. */
const FILLS: Partial<Record<keyof typeof PATHS, string>> = {
  mouse: 'M12 3h-2a4 4 0 0 0-4 4v4h6z',
};

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
    <path v-if="FILLS[name]" :d="FILLS[name]" fill="currentColor" stroke="none" />
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
